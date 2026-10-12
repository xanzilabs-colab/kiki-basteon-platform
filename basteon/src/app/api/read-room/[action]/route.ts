import { z } from "zod";
import {
  admin,
  authenticated,
  fail,
  generatedIdentity,
  getMember,
  rateLimit,
} from "@/app/api/teach/_shared";
import { EMOTIONS, RESPONSES, SCENARIOS, isReadRoomChoice, scenarioForRound } from "@/lib/games/read-room/engine";

export const runtime = "nodejs";

type Context = { params: Promise<{ action: string }> };
const uuidSchema = z.string().uuid();
const startSchema = z.object({
  mode: z.enum(["pair", "bot"]),
  roomId: uuidSchema.optional(),
});
const profileSchema = z.object({ ageBand: z.enum(["teen", "adult"]) });
const answerSchema = z.object({
  sessionId: uuidSchema,
  emotion: z.number().int().min(0).max(4),
  response: z.number().int().min(0).max(4),
});
const sessionSchema = z.object({ sessionId: uuidSchema });
const reportSchema = sessionSchema.extend({
  reason: z.enum(["uncomfortable", "inappropriate", "other"]),
});

type ReadRoomSession = {
  id: string;
  room_id: string | null;
  mode: "pair" | "bot";
  age_band: "teen" | "adult";
  status: "active" | "finished" | "abandoned";
  p1: string;
  p2: string | null;
  p1_alias: string;
  p1_avatar: string;
  p2_alias: string;
  p2_avatar: string;
  round_no: number;
  rounds_total: number;
};

function logDatabaseFailure(operation: string, error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null) {
  if (!error) return;
  console.error("read_room_database_failure", {
    operation,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

async function getSession(sessionId: string, userId: string) {
  const { data, error } = await admin().from("read_room_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) {
    logDatabaseFailure("session_lookup", error);
    throw new Error("read_room_session_lookup_failed");
  }
  const session = data as ReadRoomSession | null;
  if (!session || (session.p1 !== userId && session.p2 !== userId)) return null;
  return session;
}

async function ensureRound(session: ReadRoomSession) {
  const scenario = scenarioForRound(session.id, session.round_no);
  const scenarioId = SCENARIOS.indexOf(scenario);
  const db = admin();
  const { error: insertError } = await db.from("read_room_rounds").upsert({
    session_id: session.id,
    round_no: session.round_no,
    scenario_id: scenarioId,
  }, { onConflict: "session_id,round_no", ignoreDuplicates: true });
  if (insertError) {
    logDatabaseFailure("round_create", insertError);
    throw new Error("read_room_round_create_failed");
  }
  const { data, error } = await db.from("read_room_rounds").select("*")
    .eq("session_id", session.id).eq("round_no", session.round_no).single();
  if (error) {
    logDatabaseFailure("round_lookup", error);
    throw new Error("read_room_round_lookup_failed");
  }
  return data;
}

function participant(session: ReadRoomSession, userId: string) {
  return session.p1 === userId
    ? { alias: session.p1_alias, avatar: session.p1_avatar }
    : { alias: session.p2_alias, avatar: session.p2_avatar };
}

async function state(session: ReadRoomSession, userId: string) {
  let round = null;
  if (session.status === "active") round = await ensureRound(session);
  const isP1 = session.p1 === userId;
  const scenario = round ? SCENARIOS[round.scenario_id] : null;
  const reveal = round?.phase === "reveal" || round?.phase === "done";
  const ownEmotion = round ? (isP1 ? round.p1_emotion : round.p2_emotion) : null;
  const ownResponse = round ? (isP1 ? round.p1_response : round.p2_response) : null;
  const partnerEmotion = round && reveal ? (isP1 ? round.p2_emotion : round.p1_emotion) : null;
  const partnerResponse = round && reveal ? (isP1 ? round.p2_response : round.p1_response) : null;
  return {
    session: {
      id: session.id,
      mode: session.mode,
      status: session.status,
      ageBand: session.age_band,
      roundNo: session.round_no,
      roundsTotal: session.rounds_total,
      participant: { ...participant(session, userId), you: true },
      partner: session.mode === "bot"
        ? { alias: "Kiki", avatar: "🐦" }
        : isP1
          ? { alias: session.p2_alias, avatar: session.p2_avatar }
          : { alias: session.p1_alias, avatar: session.p1_avatar },
    },
    round: round && scenario ? {
      phase: round.phase,
      prompt: scenario.prompt,
      contentNote: scenario.contentNote,
      emotionOptions: scenario.emotionOptions ?? EMOTIONS,
      responseOptions: scenario.responseOptions ?? RESPONSES,
      ownEmotion,
      ownResponse,
      partnerEmotion,
      partnerResponse,
      ownReady: isP1 ? round.p1_ready : round.p2_ready,
      partnerReady: reveal ? (isP1 ? round.p2_ready : round.p1_ready) : false,
    } : null,
  };
}

async function startSession(userId: string, input: z.infer<typeof startSchema>) {
  const db = admin();
  const member = await getMember(userId);
  if (!member) return fail("age_band_required", 409);
  if (input.mode === "pair") {
    if (!input.roomId) return fail("room_required", 400);
    const { data: room, error: roomError } = await db.from("game_rooms")
      .select("id,game,status,invite_status,host_id,guest_id")
      .eq("id", input.roomId).eq("game", "read_room").maybeSingle();
    if (roomError) {
      logDatabaseFailure("room_lookup", roomError);
      throw new Error("read_room_room_lookup_failed");
    }
    if (!room || (room.host_id !== userId && room.guest_id !== userId)) return fail("room_unavailable", 404);
    if (!room.guest_id || room.invite_status !== "accepted" || !["ready_check", "playing"].includes(room.status)) {
      return fail("room_not_ready", 409);
    }
    if (room.host_id !== userId) return fail("host_starts_game", 409);
    const [hostMember, guestMember] = await Promise.all([getMember(room.host_id), getMember(room.guest_id)]);
    if (!hostMember || !guestMember) return fail("buddy_age_group_required", 409);
    if (hostMember.age_band !== guestMember.age_band) return fail("buddy_age_group_mismatch", 409);
    const { data: sessionId, error } = await db.rpc("read_room_start", {
      p_room_id: room.id,
      p_user: userId,
      p_session_id: crypto.randomUUID(),
      p_age_band: hostMember.age_band,
      p_p1_alias: hostMember.alias,
      p_p1_avatar: hostMember.avatar,
      p_p2_alias: guestMember.alias,
      p_p2_avatar: guestMember.avatar,
    });
    if (error) {
      logDatabaseFailure("pair_start", error);
      if (error.message.includes("room_unavailable")) return fail("room_unavailable", 404);
      throw new Error("read_room_start_failed");
    }
    if (typeof sessionId !== "string") throw new Error("read_room_start_missing_session_id");
    const session = await getSession(sessionId, userId);
    if (!session) throw new Error("read_room_session_create_failed");
    return Response.json(await state(session, userId));
  }

  const { data: existing, error: existingError } = await db.from("read_room_sessions").select("*")
    .eq("p1", userId).eq("mode", "bot").eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existingError) {
    logDatabaseFailure("active_session_lookup", existingError);
    throw new Error("read_room_active_session_lookup_failed");
  }
  if (existing) return Response.json(await state(existing as ReadRoomSession, userId));

  const identity = generatedIdentity(`${userId}:read-room`);
  const { data: sessionId, error } = await db.rpc("read_room_start", {
    p_room_id: null,
    p_user: userId,
    p_session_id: crypto.randomUUID(),
    p_age_band: member.age_band,
    p_p1_alias: identity.alias,
    p_p1_avatar: identity.avatar,
    p_p2_alias: "Kiki",
    p_p2_avatar: "🐦",
  });
  if (error) {
    logDatabaseFailure("bot_start", error);
    throw new Error("read_room_bot_start_failed");
  }
  if (typeof sessionId !== "string") throw new Error("read_room_bot_start_missing_session_id");
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error("read_room_bot_session_create_failed");
  return Response.json(await state(session, userId));
}

export async function GET(request: Request, context: Context) {
  const user = await authenticated();
  if (!user) return fail("not_authenticated", 401);
  const { action } = await context.params;
  if (action !== "state") return fail("not_found", 404);
  try {
    if (!(await rateLimit(user.id, "read_room:state", 90, 60))) return fail("rate_limited", 429);
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const roomId = url.searchParams.get("roomId");
    const member = await getMember(user.id);
    if (sessionId) {
      if (!uuidSchema.safeParse(sessionId).success) return fail("invalid_session", 400);
      const session = await getSession(sessionId, user.id);
      if (!session) return fail("session_not_found", 404);
      return Response.json(await state(session, user.id));
    }
    if (roomId) {
      if (!uuidSchema.safeParse(roomId).success) return fail("invalid_room", 400);
      const db = admin();
      const { data: room, error: roomError } = await db.from("game_rooms")
        .select("id,host_id,guest_id,status,invite_status").eq("id", roomId).eq("game", "read_room").maybeSingle();
      if (roomError) throw new Error("read_room_room_lookup_failed");
      if (!room || (room.host_id !== user.id && room.guest_id !== user.id)) return fail("room_unavailable", 404);
      const { data: session, error } = await db.from("read_room_sessions").select("*").eq("room_id", roomId).maybeSingle();
      if (error) throw new Error("read_room_room_session_lookup_failed");
      return Response.json({
        ageBand: member?.age_band ?? null,
        canStart: room.host_id === user.id && room.invite_status === "accepted",
        roomReady: room.status === "ready_check" || room.status === "playing",
        ...(session ? await state(session as ReadRoomSession, user.id) : { session: null, round: null }),
      });
    }
    return Response.json({ ageBand: member?.age_band ?? null, session: null, round: null });
  } catch (error) {
    console.error("read_room_state_failed", error);
    return fail("state_unavailable", 500);
  }
}

export async function POST(request: Request, context: Context) {
  const user = await authenticated();
  if (!user) return fail("not_authenticated", 401);
  const { action } = await context.params;
  try {
    if (!(await rateLimit(user.id, `read_room:${action}`, action === "state" ? 90 : 30, 60))) {
      return fail("rate_limited", 429);
    }
    const body: unknown = await request.json().catch(() => null);
    if (action === "profile") {
      const parsed = profileSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_profile");
      const db = admin();
      const existing = await getMember(user.id);
      if (existing && existing.age_band !== parsed.data.ageBand) {
        const { count, error } = await db.from("read_room_sessions").select("id", { count: "exact", head: true })
          .eq("status", "active").or(`p1.eq.${user.id},p2.eq.${user.id}`);
        if (error) throw new Error("read_room_active_session_lookup_failed");
        if (count) return fail("age_band_locked", 409);
      }
      const identity = existing ?? generatedIdentity(`${user.id}:read-room`);
      const { error } = await db.from("teach_members").upsert({
        user_id: user.id,
        age_band: parsed.data.ageBand,
        alias: identity.alias,
        avatar: identity.avatar,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw new Error("read_room_profile_save_failed");
      return Response.json({ ok: true });
    }
    if (action === "start") {
      const parsed = startSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_start");
      return await startSession(user.id, parsed.data);
    }
    if (action === "answer") {
      const parsed = answerSchema.safeParse(body);
      if (!parsed.success || !isReadRoomChoice(parsed.data?.emotion, parsed.data?.response)) return fail("invalid_answer");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session || session.status !== "active") return fail("session_unavailable", 409);
      const round = await ensureRound(session);
      const scenario = SCENARIOS[round.scenario_id];
      const { error } = await admin().rpc("read_room_submit", {
        p_session_id: session.id,
        p_user: user.id,
        p_emotion: parsed.data.emotion,
        p_response: parsed.data.response,
        p_bot_emotion: session.mode === "bot" ? scenario.kikiEmotion : null,
        p_bot_response: session.mode === "bot" ? scenario.kikiResponse : null,
      });
      if (error) {
        if (error.message.includes("answer_closed")) return fail("answer_closed", 409);
        if (error.message.includes("session_unavailable")) return fail("session_unavailable", 409);
        throw new Error("read_room_answer_save_failed");
      }
      const updated = await getSession(session.id, user.id);
      if (!updated) throw new Error("read_room_session_refresh_failed");
      return Response.json(await state(updated, user.id));
    }
    if (action === "next") {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_session");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session || session.status !== "active") return fail("session_unavailable", 409);
      const nextRound = session.round_no >= session.rounds_total ? 1 : session.round_no + 1;
      const scenarioId = SCENARIOS.indexOf(scenarioForRound(session.id, nextRound));
      const { data, error } = await admin().rpc("read_room_advance", {
        p_session_id: session.id,
        p_user: user.id,
        p_next_scenario_id: scenarioId,
      });
      if (error) {
        if (error.message.includes("reveal_closed")) return fail("reveal_closed", 409);
        if (error.message.includes("session_unavailable")) return fail("session_unavailable", 409);
        throw new Error("read_room_advance_failed");
      }
      const updated = await getSession(session.id, user.id);
      if (!updated) throw new Error("read_room_session_refresh_failed");
      return Response.json({ ...(await state(updated, user.id)), advance: data });
    }
    if (action === "report") {
      const parsed = reportSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_report");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session || session.mode !== "pair" || !session.p2) return fail("report_unavailable", 409);
      const targetId = session.p1 === user.id ? session.p2 : session.p1;
      const db = admin();
      const { error } = await db.from("read_room_reports").insert({
        session_id: session.id,
        reporter_id: user.id,
        target_id: targetId,
        reason: parsed.data.reason,
      });
      if (error) throw new Error("read_room_report_save_failed");
      const { error: blockError } = await db.from("teach_blocks").upsert({
        user_id: user.id,
        blocked_id: targetId,
      }, { onConflict: "user_id,blocked_id", ignoreDuplicates: true });
      if (blockError) throw new Error("read_room_block_save_failed");
      const { error: gameBlockError } = await db.from("game_blocks").upsert({
        blocker_id: user.id,
        blocked_id: targetId,
      }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
      if (gameBlockError) throw new Error("read_room_game_block_save_failed");
      const { error: leaveError } = await db.rpc("read_room_leave", { p_session_id: session.id, p_user: user.id });
      if (leaveError) throw new Error("read_room_report_exit_failed");
      return Response.json({ ok: true });
    }
    if (action === "leave") {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_session");
      const session = await getSession(parsed.data.sessionId, user.id);
      if (!session) return fail("session_not_found", 404);
      const { error } = await admin().rpc("read_room_leave", { p_session_id: session.id, p_user: user.id });
      if (error) throw new Error("read_room_leave_failed");
      return Response.json({ ok: true });
    }
    return fail("not_found", 404);
  } catch (error) {
    console.error("read_room_action_failed", { action, error });
    return fail("action_unavailable", 500, { action });
  }
}
