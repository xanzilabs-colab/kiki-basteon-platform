import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BADGES, shuffledOptions } from "@/lib/games/teach/engine";

export const admin = () => createAdminClient();
export const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status });

export async function authenticated() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function rateLimit(userId: string, action: string, limit: number, seconds: number) {
  const { data, error } = await admin().rpc("teach_rate_limit", {
    p_user: userId,
    p_action: action,
    p_limit: limit,
    p_window_seconds: seconds,
  });
  if (error) throw new Error("teach_rate_limit_unavailable");
  return data === true;
}

export async function getMember(userId: string) {
  const { data, error } = await admin().from("teach_members")
    .select("age_band,alias,avatar").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("teach_member_lookup_failed");
  return data;
}

export async function getSession(sessionId: string, userId: string) {
  const { data, error } = await admin().from("teach_sessions")
    .select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error("teach_session_lookup_failed");
  if (!data || (data.p1 !== userId && data.p2 !== userId)) return null;
  return data;
}

export async function isVerifiedAuthor(userId: string) {
  const { data, error } = await admin().from("teach_verified_authors")
    .select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("teach_author_verification_lookup_failed");
  return Boolean(data);
}

export async function allowedTopics(ageBand: "teen" | "adult", verified: boolean) {
  const { data, error } = await admin().from("teach_topics")
    .select("id,title,blurb,teen_ok,verified_only,content_note,sort")
    .eq("active", true)
    .order("sort");
  if (error) throw new Error("teach_topics_lookup_failed");
  return (data ?? []).filter((topic) =>
    (ageBand !== "teen" || topic.teen_ok) && (!topic.verified_only || verified),
  );
}

export function generatedIdentity(seed: string) {
  const adjectives = ["Bright", "Calm", "Clever", "Kind", "Sunny", "Steady", "Curious", "Gentle"];
  const avatars = ["🌿", "🐝", "🦋", "🌼", "🐦", "🍀", "🌻", "🪷"];
  const hash = createHash("sha256").update(seed).digest();
  return {
    alias: `${adjectives[hash[0] % adjectives.length]} ${adjectives[hash[1] % adjectives.length]}`,
    avatar: avatars[hash[2] % avatars.length],
  };
}

export function safeCard(card: {
  id: string;
  topic_id: string;
  problem: string;
  tip: string;
  example: string | null;
  check_q: string;
  check_options: string[];
  check_answer: number;
  tier: string;
}, readerId: string) {
  const seed = createHash("sha256").update(`${card.id}:${readerId}`).digest().readUInt32BE(0);
  const { options, answer } = shuffledOptions(card.check_options, card.check_answer, seed);
  return {
    id: card.id,
    topicId: card.topic_id,
    problem: card.problem,
    tip: card.tip,
    example: card.example,
    checkQ: card.check_q,
    checkOptions: options,
    source: card.tier === "seed" ? "Seed tip" : card.tier === "verified" ? "Verified" : "Community tip",
    correctChoice: answer,
  };
}

export async function getProgress(userId: string) {
  const db = admin();
  const [{ data: authored, error: authoredError }, { data: ownRatings, error: ratingsError }] = await Promise.all([
    db.from("teach_cards").select("id").eq("author_id", userId),
    db.from("teach_ratings").select("rating,quiz_correct").eq("rater_id", userId),
  ]);
  if (authoredError || ratingsError) throw new Error("teach_progress_lookup_failed");
  let teacherRows: { rating: string }[] = [];
  if (authored?.length) {
    const { data, error } = await db.from("teach_ratings").select("rating")
      .in("card_id", authored.map((card) => card.id)).neq("rater_id", userId);
    if (error) throw new Error("teach_teacher_xp_lookup_failed");
    teacherRows = data ?? [];
  }
  const teacherRatings = teacherRows.map((rating) => rating.rating as "helpful" | "try" | "not_for_me");
  const learnerResults = (ownRatings ?? [])
    .filter((rating) => rating.quiz_correct !== null)
    .map((rating) => Boolean(rating.quiz_correct));
  const helpful = teacherRatings.filter((rating) => rating === "helpful").length;
  const badges = BADGES.filter((badge) => badge.test({ cards: authored?.length ?? 0, helpful })).map((badge) => badge.id);
  const { data: progress, error } = await db.from("teach_progress").upsert({
    user_id: userId,
    teacher_xp: teacherRatings.reduce((sum, rating) => sum + (rating === "helpful" ? 20 : rating === "try" ? 12 : 4), 0) + (authored?.length ?? 0) * 10,
    learner_xp: learnerResults.filter(Boolean).length * 15,
    cards_authored: authored?.length ?? 0,
    cards_helpful: helpful,
    badges,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" }).select("teacher_xp,learner_xp,cards_authored,cards_helpful,badges").single();
  if (error) throw new Error("teach_progress_update_failed");
  return progress;
}

export async function ensureRound(session: Record<string, any>, roundNo = session.round_no || 1) {
  const db = admin();
  const { data: existing, error: existingError } = await db.from("teach_rounds")
    .select("*").eq("session_id", session.id).eq("round_no", roundNo).maybeSingle();
  if (existingError) throw new Error("teach_round_lookup_failed");
  if (existing) return existing;

  const authorIds = [session.p1, session.p2].filter((id): id is string => Boolean(id));
  const { data: verificationRows, error: verifiedError } = await db.from("teach_verified_authors")
    .select("user_id").in("user_id", authorIds);
  if (verifiedError) throw new Error("teach_author_verification_lookup_failed");
  const everyPlayerVerified = authorIds.length > 0 && (verificationRows?.length ?? 0) === authorIds.length;
  const topics = await allowedTopics(session.age_band, everyPlayerVerified);
  let eligible = topics.filter((topic) => !session.category || topic.id === session.category);
  if (session.mode === "bot") {
    const { data: seeds, error: seedError } = await db.from("teach_cards")
      .select("topic_id").eq("tier", "seed").eq("status", "approved").eq("flagged", false);
    if (seedError) throw new Error("teach_seed_lookup_failed");
    const seedTopics = new Set((seeds ?? []).map((seed) => seed.topic_id));
    eligible = eligible.filter((topic) => seedTopics.has(topic.id));
  }
  if (!eligible.length) throw new Error("teach_no_eligible_topics");
  const topic = eligible[(roundNo - 1) % eligible.length];
  let botCardId: string | null = null;
  if (session.mode === "bot") {
    const { data: seed, error: seedError } = await db.from("teach_cards")
      .select("id").eq("topic_id", topic.id).eq("tier", "seed").eq("status", "approved").eq("flagged", false)
      .limit(1).maybeSingle();
    if (seedError) throw new Error("teach_seed_lookup_failed");
    if (!seed) throw new Error("teach_bot_seed_unavailable");
    botCardId = seed.id;
  }
  const { data: created, error: createError } = await db.from("teach_rounds")
    .insert({
      session_id: session.id,
      round_no: roundNo,
      topic_id: topic.id,
      phase: "write",
      card_p2: botCardId,
    })
    .select("*").single();
  if (createError) {
    if (createError.code === "23505") {
      const { data: raced, error: raceError } = await db.from("teach_rounds")
        .select("*").eq("session_id", session.id).eq("round_no", roundNo).single();
      if (raceError) throw new Error("teach_round_lookup_failed");
      return raced;
    }
    throw new Error("teach_round_create_failed");
  }
  const { error: sessionUpdateError } = await db.from("teach_sessions").update({ round_no: roundNo }).eq("id", session.id);
  if (sessionUpdateError) throw new Error("teach_session_update_failed");
  return created;
}
