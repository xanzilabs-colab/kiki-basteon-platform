import { z } from "zod";
import { createHash } from "node:crypto";
import {
  ensureRound, fail, getMember, getProgress, getSession, isVerifiedAuthor, admin,
  authenticated, allowedTopics, generatedIdentity, rateLimit, safeCard,
} from "../_shared";
import { normalizeText, promotionEligible, validateCard } from "@/lib/games/teach/engine";

export const runtime = "nodejs";

type Context = { params: Promise<{ action: string }> };
const sessionIdSchema = z.string().uuid();
const topicIdSchema = z.string().regex(/^[a-z_]+$/).max(48);
const ageBandSchema = z.enum(["teen", "adult"]);
const profileSchema = z.object({ ageBand: ageBandSchema });
const startSchema = z.object({
  category: topicIdSchema.nullable().optional(),
  mode: z.enum(["pair", "bot"]).default("pair"),
  roomId: sessionIdSchema.optional(),
});
const cardSchema = z.object({
  sessionId: sessionIdSchema,
  problem: z.string().max(120),
  tip: z.string().max(400),
  example: z.string().max(240).optional(),
  checkQ: z.string().max(140),
  checkOptions: z.array(z.string().max(80)).length(3),
  checkAnswer: z.number().int().min(0).max(2),
});
const rateSchema = z.object({
  sessionId: sessionIdSchema,
  rating: z.enum(["helpful", "try", "not_for_me"]),
  quizChoice: z.number().int().min(0).max(2),
});
const sessionSchema = z.object({ sessionId: sessionIdSchema });
const reportSchema = sessionSchema.extend({
  target: z.enum(["tip", "partner"]),
  reason: z.string().trim().max(240).optional(),
});
const TEACH_PHASE_DURATION_MS = 5 * 60_000;
const toolboxSchema = z.object({
  cardId: sessionIdSchema,
  operation: z.enum(["save", "remove"]),
  sessionId: sessionIdSchema.optional(),
});
const helpfulSchema = z.object({ cardId: sessionIdSchema });

async function limited(userId: string, action: string, limit = 20) {
  if (!(await rateLimit(userId, action, limit, 60))) return fail("rate_limited", 429);
  return null;
}

function sessionResponse(session: Record<string, any>, memberId: string) {
  return {
    id: session.id,
    mode: session.mode,
    ageBand: session.age_band,
    status: session.status,
    roundNo: session.round_no,
    roundsTotal: session.rounds_total,
    createdAt: session.created_at,
    startedAt: session.started_at,
    participant: session.p1 === memberId
      ? { alias: session.p1_alias, avatar: session.p1_avatar, you: true }
      : { alias: session.p2_alias, avatar: session.p2_avatar, you: true },
    partner: session.mode === "bot"
      ? { alias: "Kiki", avatar: "🐦" }
      : session.p1 === memberId
        ? session.p2 ? { alias: session.p2_alias, avatar: session.p2_avatar } : null
        : { alias: session.p1_alias, avatar: session.p1_avatar },
  };
}

async function eligibleSeed(ageBand: "teen" | "adult", verified: boolean, category?: string | null) {
  const topics = await allowedTopics(ageBand, verified);
  const allowed = topics.filter((topic) => !category || topic.id === category).map((topic) => topic.id);
  if (!allowed.length) return null;
  const { data, error } = await admin().from("teach_cards")
    .select("id,topic_id").in("topic_id", allowed).eq("tier", "seed").eq("status", "approved").eq("flagged", false)
    .limit(1).maybeSingle();
  if (error) throw new Error("teach_bot_seed_lookup_failed");
  return data;
}

async function activateBot(session: Record<string, any>) {
  const verified = await isVerifiedAuthor(session.p1);
  const seed = await eligibleSeed(session.age_band, verified, session.category);
  if (!seed) {
    const { error } = await admin().from("teach_sessions").update({
      status: "abandoned",
      finished_at: new Date().toISOString(),
    }).eq("id", session.id).eq("status", "waiting");
    if (error) throw new Error("teach_wait_expire_failed");
    return null;
  }
  const identity = generatedIdentity(`${session.id}:kiki`);
  const { data, error } = await admin().from("teach_sessions").update({
    mode: "bot",
    category: seed.topic_id,
    status: "active",
    p2: null,
    p2_alias: identity.alias,
    p2_avatar: identity.avatar,
    round_no: 1,
    started_at: new Date().toISOString(),
  }).eq("id", session.id).eq("status", "waiting").select("*").maybeSingle();
  if (error) throw new Error("teach_bot_start_failed");
  return data;
}

async function startSession(userId: string, input: z.infer<typeof startSchema>) {
  const db = admin();
  const member = await getMember(userId);
  if (!member) return fail("age_band_required", 409);
  const verified = await isVerifiedAuthor(userId);
  if (input.mode === "pair") {
    if (!input.roomId) return fail("room_required", 400);
    const { data: room, error: roomError } = await db.from("game_rooms")
      .select("id,game,status,invite_status,host_id,guest_id")
      .eq("id", input.roomId).eq("game", "teach_one").maybeSingle();
    if (roomError) throw new Error("teach_room_lookup_failed");
    if (!room || (room.host_id !== userId && room.guest_id !== userId)) return fail("room_unavailable", 404);
    if (!room.guest_id || room.invite_status !== "accepted" || !["ready_check", "playing"].includes(room.status)) {
      return fail("room_not_ready", 409);
    }
    const [hostMember, guestMember] = await Promise.all([getMember(room.host_id), getMember(room.guest_id)]);
    if (!hostMember || !guestMember) return fail("buddy_age_group_required", 409);
    if (hostMember.age_band !== guestMember.age_band) return fail("buddy_age_group_mismatch", 409);
    const [hostVerified, guestVerified] = await Promise.all([
      isVerifiedAuthor(room.host_id), isVerifiedAuthor(room.guest_id),
    ]);
    const hostTopics = await allowedTopics(hostMember.age_band, hostVerified);
    const guestTopics = await allowedTopics(guestMember.age_band, guestVerified);
    const commonTopicIds = new Set(guestTopics.map((topic) => topic.id));
    const allowed = hostTopics.filter((topic) => commonTopicIds.has(topic.id));
    if (input.category && !allowed.some((topic) => topic.id === input.category)) return fail("topic_unavailable", 403);
    const sessionId = crypto.randomUUID();
    const { data: resolvedId, error: createError } = await db.rpc("teach_start_room_session", {
      p_room_id: room.id,
      p_user: userId,
      p_session_id: sessionId,
      p_age_band: hostMember.age_band,
      p_category: input.category ?? null,
      p_p1_alias: hostMember.alias,
      p_p1_avatar: hostMember.avatar,
      p_p2_alias: guestMember.alias,
      p_p2_avatar: guestMember.avatar,
    });
    if (createError) {
      if (createError.message.includes("room_not_ready")) return fail("room_not_ready", 409);
      if (createError.message.includes("room_unavailable")) return fail("room_unavailable", 404);
      throw new Error("teach_room_session_create_failed");
    }
    const { data: created, error: sessionError } = await db.from("teach_sessions")
      .select("*").eq("id", resolvedId).single();
    if (sessionError) throw new Error("teach_room_session_lookup_failed");
    await ensureRound(created, 1);
    return Response.json({ session: sessionResponse(created, userId) }, { status: 200 });
  }

  const topics = await allowedTopics(member.age_band, verified);
  if (input.category && !topics.some((topic) => topic.id === input.category)) return fail("topic_unavailable", 403);
  const identity = generatedIdentity(`${userId}:${crypto.randomUUID()}`);
  const id = crypto.randomUUID();
  if (input.mode === "bot") {
    const seed = await eligibleSeed(member.age_band as "teen" | "adult", verified, input.category);
    if (!seed) return fail("bot_seed_unavailable", 409);
    const kiki = generatedIdentity(`${id}:kiki`);
    const { data: created, error } = await db.from("teach_sessions").insert({
      id,
      mode: "bot",
      age_band: member.age_band,
      category: input.category ?? null,
      status: "active",
      p1: userId,
      p1_alias: identity.alias,
      p1_avatar: identity.avatar,
      p2_alias: kiki.alias,
      p2_avatar: kiki.avatar,
      round_no: 1,
      started_at: new Date().toISOString(),
    }).select("*").single();
    if (error) throw new Error("teach_bot_session_create_failed");
    await ensureRound(created, 1);
    return Response.json({ session: sessionResponse(created, userId) }, { status: 201 });
  }

  return fail("invalid_mode", 400);
}

async function stateFor(userId: string, sessionId: string) {
  let session = await getSession(sessionId, userId);
  if (!session) return fail("session_not_found", 404);
  if (session.status === "waiting" && Date.now() - Date.parse(session.created_at) >= 20_000) {
    const activated = await activateBot(session);
    if (activated) session = activated;
    else return Response.json({
      session: sessionResponse({ ...session, status: "abandoned" }, userId),
      notice: "Kiki's reviewed tip cards are not ready yet. Please try again later.",
    });
  }
  if (session.status === "active" && session.round_no === 0) {
    await ensureRound(session, 1);
    session = (await getSession(sessionId, userId))!;
  }
  if (session.status !== "active" && session.status !== "finished") {
    const progress = session.status === "finished" ? await getProgress(userId) : null;
    return Response.json({ session: sessionResponse(session, userId), progress });
  }

  const db = admin();
  let round = await ensureRound(session);
  const viewerIsP1 = session.p1 === userId;
  const ownCardId = viewerIsP1 ? round.card_p1 : round.card_p2;
  const otherCardId = viewerIsP1 ? round.card_p2 : round.card_p1;
  const { data: ownCard, error: ownError } = ownCardId
    ? await db.from("teach_cards").select("id,problem,tip,example,check_q,check_options,tier,status").eq("id", ownCardId).single()
    : { data: null, error: null };
  if (ownError) throw new Error("teach_own_card_lookup_failed");
  const { data: otherCard, error: otherError } = otherCardId && (round.phase === "read" || round.phase === "done")
    ? await db.from("teach_cards").select("id,topic_id,problem,tip,example,check_q,check_options,check_answer,tier,status,flagged").eq("id", otherCardId).single()
    : { data: null, error: null };
  if (otherError) throw new Error("teach_partner_card_lookup_failed");
  if (otherCard && (otherCard.status === "removed" || otherCard.flagged)) return fail("tip_unavailable", 410);
  const { data: topic, error: topicError } = await db.from("teach_topics")
    .select("id,title,blurb,content_note").eq("id", round.topic_id).single();
  if (topicError) throw new Error("teach_topic_lookup_failed");
  const { data: ownRating, error: ownRatingError } = ownCardId
    ? await (session.mode === "bot"
      ? db.from("teach_ratings").select("rating").eq("card_id", ownCardId).eq("rater_id", userId).limit(1).maybeSingle()
      : db.from("teach_ratings").select("rating").eq("card_id", ownCardId).neq("rater_id", userId).limit(1).maybeSingle())
    : { data: null, error: null };
  if (ownRatingError) throw new Error("teach_feedback_lookup_failed");
  const { data: myRating, error: myRatingError } = otherCardId
    ? await db.from("teach_ratings").select("rating,quiz_correct").eq("card_id", otherCardId).eq("rater_id", userId).maybeSingle()
    : { data: null, error: null };
  if (myRatingError) throw new Error("teach_my_rating_lookup_failed");
  if (round.phase === "read" && ownRating && myRating) {
    const { error: finishError } = await db.from("teach_rounds").update({ phase: "done" })
      .eq("id", round.id).eq("phase", "read");
    if (finishError) throw new Error("teach_round_finish_failed");
    round = { ...round, phase: "done" };
  }
  const durationMs = round.phase === "write" || round.phase === "read" ? TEACH_PHASE_DURATION_MS : 0;
  const deadlineAt = new Date(Date.parse(round.phase_started_at) + durationMs).toISOString();
  const now = Date.now();
  if (durationMs && now >= Date.parse(deadlineAt)) {
    if (round.phase === "write" && (!round.card_p1 || !round.card_p2)) {
      const { error } = await db.from("teach_sessions").update({
        status: "abandoned", finished_at: new Date().toISOString(),
      }).eq("id", session.id).eq("status", "active");
      if (error) throw new Error("teach_write_timeout_failed");
      if (session.room_id) {
        const { error: roomError } = await db.from("game_rooms").update({
          status: "ended", updated_at: new Date().toISOString(),
        }).eq("id", session.room_id).eq("teach_session_id", session.id);
        if (roomError) throw new Error("teach_room_timeout_close_failed");
      }
      session = { ...session, status: "abandoned" };
    } else if (round.phase === "read") {
      const { error } = await db.from("teach_rounds").update({ phase: "done" })
        .eq("id", round.id).eq("phase", "read");
      if (error) throw new Error("teach_read_timeout_failed");
      round = { ...round, phase: "done" };
    }
  }

  const progress = session.status === "finished" ? await getProgress(userId) : null;
  const payload = {
    session: sessionResponse(session, userId),
    round: {
      roundNo: round.round_no,
      phase: round.phase,
      topic: { id: topic.id, title: topic.title, blurb: topic.blurb, contentNote: topic.content_note },
      deadlineAt,
      ownCard: ownCard ? {
        problem: ownCard.problem, tip: ownCard.tip, example: ownCard.example,
        checkQ: ownCard.check_q, checkOptions: ownCard.check_options,
        source: ownCard.tier === "seed" ? "Seed tip" : ownCard.tier === "verified" ? "Verified" : "Community tip",
      } : null,
      partnerCard: otherCard && (round.phase === "read" || round.phase === "done")
        ? (({ correctChoice: _neverSend, ...privateSafe }) => privateSafe)(safeCard(otherCard, userId))
        : null,
      ratingOnYourTip: ownRating?.rating ?? null,
      myRating: myRating?.rating ?? null,
      quizCorrect: myRating?.quiz_correct ?? null,
    },
    notice: null,
    progress,
  };
  const body = JSON.stringify(payload);
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-cache",
      etag,
    },
  });
}

export async function GET(request: Request, context: Context) {
  const user = await authenticated();
  if (!user) return fail("not_authenticated", 401);
  const { action } = await context.params;
  try {
    const limit = await limited(user.id, `get:${action}`, action === "state" ? 90 : action === "room" ? 40 : 30);
    if (limit) return limit;
    if (action === "topics") {
      const member = await getMember(user.id);
      if (!member) return Response.json({ needsAgeBand: true, topics: [] });
      const topics = await allowedTopics(member.age_band as "teen" | "adult", await isVerifiedAuthor(user.id));
      return Response.json({
        needsAgeBand: false,
        ageBand: member.age_band,
        topics: topics.map(({ id, title, blurb, content_note: contentNote }) => ({ id, title, blurb, contentNote })),
      }, { headers: { "cache-control": "private, no-store" } });
    }
    if (action === "state") {
      const parsed = sessionIdSchema.safeParse(new URL(request.url).searchParams.get("sessionId"));
      if (!parsed.success) return fail("invalid_session_id");
      const response = await stateFor(user.id, parsed.data);
      if (response.status !== 200) return response;
      const etag = response.headers.get("etag");
      if (etag && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
      return response;
    }
    if (action === "room") {
      const parsed = sessionIdSchema.safeParse(new URL(request.url).searchParams.get("roomId"));
      if (!parsed.success) return fail("invalid_room_id");
      const { data: room, error } = await admin().from("game_rooms")
        .select("teach_session_id,host_id,guest_id,game,status")
        .eq("id", parsed.data).eq("game", "teach_one").maybeSingle();
      if (error) throw new Error("teach_room_lookup_failed");
      if (!room || (room.host_id !== user.id && room.guest_id !== user.id)) return fail("room_unavailable", 404);
      if (room.status === "ended") return Response.json({ closed: true }, { headers: { "cache-control": "private, no-store" } });
      if (!room.teach_session_id) return Response.json({ pending: true }, { headers: { "cache-control": "private, no-store" } });
      return await stateFor(user.id, room.teach_session_id);
    }
    if (action === "library") {
      const member = await getMember(user.id);
      if (!member) return fail("age_band_required", 409);
      const params = new URL(request.url).searchParams;
      const topicId = params.get("topic");
      const query = (params.get("q") ?? "").trim().slice(0, 80);
      const topics = await allowedTopics(member.age_band as "teen" | "adult", await isVerifiedAuthor(user.id));
      if (topicId && !topics.some((topic) => topic.id === topicId)) return fail("topic_unavailable", 403);
      let lookup = admin().from("teach_cards")
        .select("id,topic_id,problem,tip,example,check_q,check_options,tier,helpful_distinct")
        .eq("status", "approved").eq("flagged", false).in("topic_id", topics.map((topic) => topic.id))
        .order("helpful_distinct", { ascending: false }).limit(50);
      if (topicId) lookup = lookup.eq("topic_id", topicId);
      if (query) lookup = lookup.ilike("problem", `%${query}%`);
      const { data, error } = await lookup;
      if (error) throw new Error("teach_library_lookup_failed");
      return Response.json({
        cards: (data ?? []).map((card) => ({
          id: card.id, topicId: card.topic_id, problem: card.problem, tip: card.tip,
          example: card.example, checkQ: card.check_q, checkOptions: card.check_options,
          source: card.tier === "seed" ? "Seed tip" : card.tier === "verified" ? "Verified" : "Community tip",
          helpful: card.helpful_distinct,
        })),
        topics: topics.map(({ id, title }) => ({ id, title })),
      }, { headers: { "cache-control": "private, no-store" } });
    }
    if (action === "toolbox") {
      const { data, error } = await admin().from("teach_toolbox")
        .select("saved_at,teach_cards!inner(id,topic_id,problem,tip,example,check_q,check_options,tier,status,flagged)")
        .eq("user_id", user.id).order("saved_at", { ascending: false }).limit(100);
      if (error) throw new Error("teach_toolbox_lookup_failed");
      const cards = (data ?? []).flatMap((row) => {
        const card = row.teach_cards[0];
        if (!card || card.status === "removed" || card.flagged) return [];
        return [{
          id: card.id, topicId: card.topic_id, problem: card.problem, tip: card.tip, example: card.example,
          checkQ: card.check_q, checkOptions: card.check_options,
          source: card.tier === "seed" ? "Seed tip" : card.tier === "verified" ? "Verified" : "Community tip",
          savedAt: row.saved_at,
        }];
      });
      return Response.json({ cards });
    }
    return fail("not_found", 404);
  } catch (error) {
    console.error("teach GET failed", { action, error });
    return fail("teach_request_failed", 500);
  }
}

export async function POST(request: Request, context: Context) {
  const user = await authenticated();
  if (!user) return fail("not_authenticated", 401);
  const { action } = await context.params;
  try {
    const limit = await limited(user.id, `post:${action}`, action === "state" ? 90 : 20);
    if (limit) return limit;
    const body = await request.json().catch(() => null);

    if (action === "profile") {
      const parsed = profileSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_profile");
      const db = admin();
      const existing = await getMember(user.id);
      if (existing && existing.age_band !== parsed.data.ageBand) {
        const { count, error: activeError } = await db.from("teach_sessions").select("id", { count: "exact", head: true })
          .in("status", ["waiting", "active"]).or(`p1.eq.${user.id},p2.eq.${user.id}`);
        if (activeError) throw new Error("teach_active_session_lookup_failed");
        const { count: readRoomCount, error: readRoomError } = await db.from("read_room_sessions")
          .select("id", { count: "exact", head: true })
          .eq("status", "active").or(`p1.eq.${user.id},p2.eq.${user.id}`);
        if (readRoomError) throw new Error("read_room_active_session_lookup_failed");
        if (count || readRoomCount) return fail("age_band_locked", 409);
      }
      const identity = existing ?? generatedIdentity(`${user.id}:${crypto.randomUUID()}`);
      const { error } = await db.from("teach_members").upsert({
        user_id: user.id, age_band: parsed.data.ageBand,
        alias: identity.alias, avatar: identity.avatar, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw new Error("teach_profile_save_failed");
      return Response.json({ ok: true });
    }
    if (action === "start") {
      const parsed = startSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_start");
      return await startSession(user.id, parsed.data);
    }
    if (action === "card") {
      const parsed = cardSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_card_shape", 400, { fields: parsed.error.issues.map((issue) => issue.path[0]) });
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session || session.status !== "active") return fail("session_unavailable", 409);
      const round = await ensureRound(session);
      if (round.phase !== "write") return fail("write_phase_closed", 409);
      if (Date.now() - Date.parse(round.phase_started_at) > TEACH_PHASE_DURATION_MS) return fail("write_phase_closed", 409);
      const isP1 = session.p1 === user.id;
      if ((isP1 ? round.card_p1 : round.card_p2) || (session.mode === "bot" && !isP1)) return fail("card_already_submitted", 409);
      const topic = await admin().from("teach_topics").select("id,verified_only,teen_ok").eq("id", round.topic_id).single();
      if (topic.error) throw new Error("teach_topic_lookup_failed");
      const verified = await isVerifiedAuthor(user.id);
      const member = await getMember(user.id);
      if (!member || (member.age_band === "teen" && !topic.data.teen_ok) || (topic.data.verified_only && !verified)) {
        return fail("topic_unavailable", 403);
      }
      const normalized = {
        problem: normalizeText(parsed.data.problem),
        tip: normalizeText(parsed.data.tip),
        example: normalizeText(parsed.data.example ?? ""),
        checkQ: normalizeText(parsed.data.checkQ),
        checkOptions: parsed.data.checkOptions.map(normalizeText),
        checkAnswer: parsed.data.checkAnswer,
      };
      const verdict = validateCard(normalized, { verified });
      if (!verdict.ok) {
        if (verdict.code === "pii") return fail("pii", 400, { findings: verdict.findings });
        if (verdict.code === "professional") return fail("professional", 400, { categories: verdict.categories });
        if (verdict.code === "self_harm") return fail("self_harm", 400, {
          message: "We're sorry you're carrying this. This game can't publish this kind of text. Please pause and reach out to someone you trust; if you may be in immediate danger, contact local emergency support.",
          helpUrl: "/account/guardians",
        });
        return fail("invalid_card", 400, { fields: verdict.fields });
      }
      const card = {
        author_id: user.id,
        topic_id: round.topic_id,
        problem: normalized.problem,
        tip: normalized.tip,
        example: normalized.example || null,
        check_q: normalized.checkQ,
        check_options: normalized.checkOptions,
        check_answer: normalized.checkAnswer,
        tier: verified ? "verified" : "community",
        status: "pending",
      };
      const { data: createdCard, error: createError } = await admin().from("teach_cards").insert(card).select("id").single();
      if (createError) throw new Error("teach_card_save_failed");
      const column = isP1 ? "card_p1" : "card_p2";
      const { data: updatedRound, error: attachError } = await admin().from("teach_rounds").update({ [column]: createdCard.id })
        .eq("id", round.id).eq("phase", "write").is(column, null).select("*").maybeSingle();
      if (attachError) throw new Error("teach_card_attach_failed");
      if (!updatedRound) {
        const { error } = await admin().from("teach_cards").delete().eq("id", createdCard.id);
        if (error) throw new Error("teach_orphan_card_cleanup_failed");
        return fail("card_already_submitted", 409);
      }
      const after = await admin().from("teach_rounds").select("*").eq("id", round.id).single();
      if (after.error) throw new Error("teach_round_refresh_failed");
      if (after.data.card_p1 && after.data.card_p2) {
        const { error } = await admin().from("teach_rounds").update({
          phase: "read", phase_started_at: new Date().toISOString(),
        }).eq("id", round.id).eq("phase", "write");
        if (error) throw new Error("teach_read_phase_start_failed");
      }
      if (session.mode === "bot") {
        const { error } = await admin().from("teach_ratings").upsert({
          card_id: createdCard.id, rater_id: session.p1,
          rating: "try", quiz_correct: true,
        }, { onConflict: "card_id,rater_id" });
        if (error) throw new Error("teach_bot_rating_failed");
        const { error: phaseError } = await admin().from("teach_rounds").update({
          phase: "read", phase_started_at: new Date().toISOString(),
        }).eq("id", round.id).eq("phase", "write");
        if (phaseError) throw new Error("teach_read_phase_start_failed");
      }
      return Response.json({ ok: true });
    }
    if (action === "rate") {
      const parsed = rateSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_rating");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session || session.status !== "active") return fail("session_unavailable", 409);
      const round = await ensureRound(session);
      if (round.phase !== "read" || Date.now() - Date.parse(round.phase_started_at) > TEACH_PHASE_DURATION_MS) {
        return fail("read_phase_closed", 409);
      }
      const isP1 = session.p1 === user.id;
      const otherCardId = isP1 ? round.card_p2 : round.card_p1;
      if (!otherCardId) return fail("partner_tip_not_ready", 409);
      const { data: card, error: cardError } = await admin().from("teach_cards")
        .select("id,topic_id,problem,tip,example,check_q,check_options,check_answer,tier,flagged,status")
        .eq("id", otherCardId).single();
      if (cardError) throw new Error("teach_card_lookup_failed");
      if (card.flagged || card.status === "removed") return fail("tip_unavailable", 410);
      const safe = safeCard(card, user.id);
      const { error } = await admin().from("teach_ratings").insert({
        card_id: otherCardId,
        rater_id: user.id,
        rating: parsed.data.rating,
        quiz_correct: parsed.data.quizChoice === safe.correctChoice,
      });
      if (error?.code === "23505") return fail("already_rated", 409);
      if (error) throw new Error("teach_rating_save_failed");
      const { error: refreshError } = await admin().rpc("teach_refresh_card", { p_card: otherCardId });
      if (refreshError) throw new Error("teach_card_promotion_refresh_failed");
      const { data: refreshed, error: refreshedError } = await admin().from("teach_cards")
        .select("tier,helpful_distinct,report_count,flagged,status").eq("id", otherCardId).single();
      if (refreshedError) throw new Error("teach_card_promotion_lookup_failed");
      if (promotionEligible({
        tier: refreshed.tier,
        distinctHelpful: refreshed.helpful_distinct,
        openReports: refreshed.report_count,
        flagged: refreshed.flagged,
      })) {
        const { error: promoteError } = await admin().from("teach_cards").update({ status: "approved" })
          .eq("id", otherCardId).eq("tier", "community").eq("status", "pending").eq("flagged", false);
        if (promoteError) throw new Error("teach_card_promotion_failed");
      }
      const cardIds = [round.card_p1, round.card_p2].filter((id): id is string => Boolean(id));
      const { data: submittedRatings, error: ratingsError } = await admin().from("teach_ratings")
        .select("card_id").in("card_id", cardIds);
      if (ratingsError) throw new Error("teach_round_rating_lookup_failed");
      const bothRated = cardIds.every((cardId) => submittedRatings?.some((row) => row.card_id === cardId));
      if (bothRated) {
        const { error: doneError } = await admin().from("teach_rounds").update({ phase: "done" })
          .eq("id", round.id).eq("phase", "read");
        if (doneError) throw new Error("teach_round_finish_failed");
      }
      return Response.json({ ok: true, quizCorrect: parsed.data.quizChoice === safe.correctChoice });
    }
    if (action === "next") {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_session_id");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session || session.status !== "active") return fail("session_unavailable", 409);
      const round = await ensureRound(session);
      if (round.phase !== "done") return fail("round_not_finished", 409);
      if (round.round_no >= session.rounds_total) {
        const { error } = await admin().from("teach_sessions").update({
          status: "finished", finished_at: new Date().toISOString(),
        }).eq("id", session.id).eq("status", "active");
        if (error) throw new Error("teach_session_finish_failed");
        if (session.room_id) {
          const { error: roomError } = await admin().from("game_rooms").update({
            status: "post_game", updated_at: new Date().toISOString(),
          }).eq("id", session.room_id).eq("teach_session_id", session.id);
          if (roomError) throw new Error("teach_room_finish_failed");
        }
        return Response.json({ finished: true, progress: await getProgress(user.id) });
      }
      const next = await ensureRound(session, round.round_no + 1);
      return Response.json({ roundNo: next.round_no });
    }
    if (action === "skip") {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_session_id");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session || session.status !== "active") return fail("session_unavailable", 409);
      const round = await ensureRound(session);
      const { error } = await admin().from("teach_rounds").update({ phase: "done" })
        .eq("id", round.id).in("phase", ["write", "read"]);
      if (error) throw new Error("teach_topic_skip_failed");
      return Response.json({ ok: true });
    }
    if (action === "leave" || action === "break") {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_session_id");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session) return fail("session_not_found", 404);
      const { error } = await admin().from("teach_sessions").update({
        status: "abandoned", finished_at: new Date().toISOString(),
      }).eq("id", session.id).in("status", ["waiting", "active"]);
      if (error) throw new Error("teach_session_leave_failed");
      if (session.room_id) {
        const { error: roomError } = await admin().from("game_rooms").update({
          status: "ended", updated_at: new Date().toISOString(),
        }).eq("id", session.room_id).eq("teach_session_id", session.id);
        if (roomError) throw new Error("teach_room_leave_failed");
      }
      return Response.json({ ok: true });
    }
    if (action === "report") {
      const parsed = reportSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_report");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session || session.status !== "active") return fail("session_unavailable", 409);
      const isP1 = session.p1 === user.id;
      const otherId = isP1 ? session.p2 : session.p1;
      const round = await ensureRound(session);
      const reportedCard = isP1 ? round.card_p2 : round.card_p1;
      if (reportedCard) {
        const { error: flagError } = await admin().from("teach_cards").update({ flagged: true })
          .eq("id", reportedCard);
        if (flagError) throw new Error("teach_tip_flag_failed");
      }
      const { error: reportError } = await admin().from("teach_reports").insert({
        card_id: reportedCard ?? null,
        session_id: session.id,
        reporter_id: user.id,
        reason: `${parsed.data.target}${parsed.data.reason ? `: ${parsed.data.reason}` : ""}`,
      });
      if (reportError) throw new Error("teach_report_save_failed");
      if (reportedCard) {
        const { error: refreshError } = await admin().rpc("teach_refresh_card", { p_card: reportedCard });
        if (refreshError) throw new Error("teach_report_count_refresh_failed");
      }
      if (parsed.data.target === "partner" && otherId && session.mode === "pair") {
        const { error: blockError } = await admin().from("teach_blocks").upsert({
          user_id: user.id, blocked_id: otherId,
        }, { onConflict: "user_id,blocked_id" });
        if (blockError) throw new Error("teach_partner_block_failed");
      }
      const { error: endError } = await admin().from("teach_sessions").update({
        status: "abandoned", finished_at: new Date().toISOString(),
      }).eq("id", session.id).eq("status", "active");
      if (endError) throw new Error("teach_report_session_end_failed");
      if (session.room_id) {
        const { error: roomError } = await admin().from("game_rooms").update({
          status: "ended", updated_at: new Date().toISOString(),
        }).eq("id", session.room_id).eq("teach_session_id", session.id);
        if (roomError) throw new Error("teach_room_report_close_failed");
      }
      return Response.json({ ok: true });
    }
    if (action === "toolbox") {
      const parsed = toolboxSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_toolbox_action");
      const db = admin();
      if (parsed.data.operation === "remove") {
        const { error } = await db.from("teach_toolbox").delete()
          .eq("user_id", user.id).eq("card_id", parsed.data.cardId);
        if (error) throw new Error("teach_toolbox_remove_failed");
        return Response.json({ ok: true });
      }
      const { data: card, error: cardError } = await db.from("teach_cards")
        .select("id,status,flagged").eq("id", parsed.data.cardId).maybeSingle();
      if (cardError) throw new Error("teach_toolbox_card_lookup_failed");
      if (!card || card.status === "removed" || card.flagged) return fail("tip_unavailable", 404);
      if (card.status !== "approved") {
        if (!parsed.data.sessionId) return fail("tip_not_savable", 403);
        const session = await getSession(parsed.data.sessionId, user.id);
        if (!session) return fail("session_not_found", 404);
        const { data: round, error } = await db.from("teach_rounds").select("card_p1,card_p2")
          .eq("session_id", session.id).eq("card_p1", card.id).limit(1).maybeSingle();
        const { data: secondRound, error: secondError } = !round
          ? await db.from("teach_rounds").select("card_p1,card_p2")
            .eq("session_id", session.id).eq("card_p2", card.id).limit(1).maybeSingle()
          : { data: null, error: null };
        if (error || secondError) throw new Error("teach_toolbox_session_lookup_failed");
        if (!round && !secondRound) return fail("tip_not_savable", 403);
      }
      const { error } = await db.from("teach_toolbox").upsert({
        user_id: user.id, card_id: parsed.data.cardId,
      }, { onConflict: "user_id,card_id" });
      if (error) throw new Error("teach_toolbox_save_failed");
      return Response.json({ ok: true });
    }
    if (action === "helpful") {
      const parsed = helpfulSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_card_id");
      const { data: card, error: lookupError } = await admin().from("teach_cards")
        .select("id,author_id,tier,status,flagged").eq("id", parsed.data.cardId).maybeSingle();
      if (lookupError) throw new Error("teach_library_card_lookup_failed");
      if (!card || card.status !== "approved" || card.flagged) return fail("tip_unavailable", 404);
      if (card.author_id === user.id) return fail("cannot_rate_own_tip", 403);
      const { error } = await admin().from("teach_ratings").insert({
        card_id: card.id, rater_id: user.id, rating: "helpful", quiz_correct: null,
      });
      if (error?.code === "23505") return fail("already_rated", 409);
      if (error) throw new Error("teach_helpful_rating_failed");
      const { error: refreshError } = await admin().rpc("teach_refresh_card", { p_card: card.id });
      if (refreshError) throw new Error("teach_card_promotion_refresh_failed");
      return Response.json({ ok: true });
    }
    return fail("not_found", 404);
  } catch (error) {
    console.error("teach POST failed", { action, error });
    return fail("teach_request_failed", 500);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const user = await authenticated();
  if (!user) return fail("not_authenticated", 401);
  const { action } = await context.params;
  if (action !== "my-data") return fail("not_found", 404);
  try {
    const limit = await limited(user.id, "delete-my-data", 3);
    if (limit) return limit;
    const db = admin();
    const { error: preserveError } = await db.from("teach_cards").update({ author_id: null, status: "removed" })
      .eq("author_id", user.id).neq("status", "approved");
    if (preserveError) throw new Error("teach_data_cards_remove_failed");
    const { error: preserveApprovedError } = await db.from("teach_cards").update({ author_id: null })
      .eq("author_id", user.id).eq("status", "approved");
    if (preserveApprovedError) throw new Error("teach_data_cards_anonymize_failed");
    const { data: linkedRooms, error: roomLookupError } = await db.from("teach_sessions").select("room_id")
      .or(`p1.eq.${user.id},p2.eq.${user.id}`).not("room_id", "is", null);
    if (roomLookupError) throw new Error("teach_data_room_lookup_failed");
    const roomIds = (linkedRooms ?? []).map((row) => row.room_id).filter((id): id is string => Boolean(id));
    if (roomIds.length) {
      const { error: roomEndError } = await db.from("game_rooms").update({ status: "ended", updated_at: new Date().toISOString() })
        .in("id", roomIds);
      if (roomEndError) throw new Error("teach_data_room_close_failed");
    }
    const { error } = await db.from("teach_sessions").delete()
      .or(`p1.eq.${user.id},p2.eq.${user.id}`);
    if (error) throw new Error("teach_data_sessions_delete_failed");
    for (const table of ["teach_ratings", "teach_toolbox", "teach_progress", "teach_reports", "teach_blocks", "teach_verified_authors", "teach_members", "teach_rate_limits"] as const) {
      const column = table === "teach_ratings" ? "rater_id" : table === "teach_reports" ? "reporter_id" : table === "teach_blocks" ? "user_id" : "user_id";
      const { error: deleteError } = await db.from(table).delete().eq(column, user.id);
      if (deleteError) throw new Error(`teach_data_${table}_delete_failed`);
    }
    const { error: blockedRowsError } = await db.from("teach_blocks").delete().eq("blocked_id", user.id);
    if (blockedRowsError) throw new Error("teach_data_blocks_delete_failed");
    return Response.json({ ok: true });
  } catch (error) {
    console.error("teach data deletion failed", error);
    return fail("teach_data_delete_failed", 500);
  }
}
