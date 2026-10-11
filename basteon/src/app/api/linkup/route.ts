import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BOMB, LETTERS, bombInit, bombResolve, bombSetEnd, bombSpec, buildIndex, buildSpec,
  chainCarry, matchWinner, mulberry32, rolesForRound, scoreRound, applyRound,
  solutions, validateAnswer,
} from "@/lib/games/linkup/engine";
import type { BombState, Mode, RoundSpec, Verdict } from "@/lib/games/linkup/engine";
import { botAnswer, botLetter } from "@/lib/games/linkup/bot";
import type { Difficulty } from "@/lib/games/linkup/bot";
import { LINKUP_WORDS } from "@/lib/games/linkup/words";

export const runtime = "nodejs";

const schema = z.object({
  matchId: z.string().uuid(),
  action: z.enum(["start", "pick", "answer", "advance", "bomb_end"]),
  letter: z.string().length(1).regex(/^[a-z]$/i).optional(),
  text: z.string().max(80).optional(),
  alternatives: z.array(z.string().max(80)).max(5).optional(),
});

const words = LINKUP_WORDS;
const index = buildIndex(words);
const PICK_WINDOW_MS = 3000;
const REVEAL_WINDOW_MS = 1400;
const ANSWER_WINDOW_MS = 10000;
const RESULT_WINDOW_MS = 2400;
type Match = {
  id: string;
  room_id: string | null;
  mode: Mode;
  vs_bot: boolean;
  bot_difficulty: Difficulty | null;
  player1_id: string;
  player2_id: string | null;
  bot_actor_id: string | null;
  status: string;
  round_no: number;
  scores: Record<string, number>;
  streaks: Record<string, number>;
  used_words: string[];
  seed: number;
  fuse_left_ms: number;
  holder_id: string | null;
  passer_id: string | null;
  turn_no: number;
  turn_started_at: string | null;
  bomb_start: string | null;
  bomb_end: string | null;
  bomb_state: BombState;
};
type Round = {
  id: string;
  round_no: number;
  spec: RoundSpec | null;
  phase: string;
  phase_started_at: string;
  deadline_at: string | null;
  picks: Record<string, string>;
  locked_user_ids: string[];
  bot_answer: { word: string | null; delayMs: number; kind: string } | null;
  results: unknown;
  chain_broken: boolean;
  sudden_death: boolean;
};

const admin = () => createAdminClient();
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const addMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const toEpoch = (value: string | null | undefined) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function authenticatedUser() {
  const session = await createClient();
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function loadMatch(matchId: string, uid: string) {
  const db = admin();
  const { data, error } = await db.from("linkup_matches").select("*").eq("id", matchId).maybeSingle();
  if (error) throw new Error("match_lookup_failed");
  if (!data || (data.player1_id !== uid && data.player2_id !== uid)) return null;
  return data as Match;
}

async function currentRound(matchId: string) {
  const { data, error } = await admin().from("linkup_rounds").select("*").eq("match_id", matchId).order("round_no", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("round_lookup_failed");
  return data as Round | null;
}

async function makeRound(match: Match, roundNo: number, carry?: string | null, suddenDeath = false) {
  const roundMode: Mode = suddenDeath ? "classic" : match.mode;
  let previousAnswers: { data: { word: string; valid: boolean; answer_ms: number | null }[] | null; error: unknown } = { data: [], error: null };
  if (roundNo > 1 && roundMode === "chain" && carry === undefined) {
    const { data: previousRound, error: previousError } = await admin().from("linkup_rounds")
      .select("id").eq("match_id", match.id).eq("round_no", roundNo - 1).maybeSingle();
    if (previousError) throw new Error("previous_round_lookup_failed");
    if (previousRound) previousAnswers = await admin().from("linkup_answers")
      .select("word,valid,answer_ms").eq("round_id", previousRound.id);
  }
  const carryLetter = carry ?? (roundMode === "chain" && previousAnswers.data
    ? chainCarry(previousAnswers.data.map((answer) => ({ word: answer.word, valid: answer.valid, answerMs: answer.answer_ms })))
    : null);
  const broken = roundMode === "chain" && roundNo > 1 && !carryLetter;
  const rng = mulberry32(match.seed + roundNo * 7919);
  const botId = match.bot_actor_id ?? "kiki";
  const roles = rolesForRound(roundNo, match.player1_id, match.player2_id ?? botId);
  const start = roundMode === "chain" && roundNo > 1 && carryLetter ? carryLetter : "";
  const end = "";
  const spec = buildSpec({
    round: roundNo,
    mode: roundMode,
    start: start || "s",
    end: end || "t",
    idx: index,
    used: new Set(match.used_words),
    rng,
  });

  const picks: Record<string, string> = {};
  if (start) picks.carryStart = start;
  const { data, error } = await admin().from("linkup_rounds").upsert({
    match_id: match.id,
    round_no: roundNo,
    spec,
    phase: "pick",
    phase_started_at: new Date().toISOString(),
    deadline_at: addMs(PICK_WINDOW_MS),
    picks,
    chain_broken: broken,
    sudden_death: suddenDeath,
  }, { onConflict: "match_id,round_no", ignoreDuplicates: true }).select("*").maybeSingle();
  if (error) throw new Error("round_create_failed");
  if (data) return data as Round;
  const existing = await admin().from("linkup_rounds").select("*").eq("match_id", match.id).eq("round_no", roundNo).single();
  if (existing.error) throw new Error("round_lookup_failed");
  return existing.data as Round;
}

async function initializeMatch(match: Match) {
  if (match.mode === "bomb") {
    if (match.bomb_state?.holder) return;
    const opponent = match.vs_bot ? match.bot_actor_id ?? "kiki" : match.player2_id!;
    const state = bombInit(match.player1_id, opponent, "s");
    await admin().from("linkup_matches").update({
      status: "active",
      holder_id: state.holder,
      passer_id: state.passer,
      turn_no: 1,
      turn_started_at: new Date().toISOString(),
      bomb_start: state.start,
      bomb_end: null,
      fuse_left_ms: state.fuseLeftMs,
      bomb_state: state,
      round_no: 1,
    }).eq("id", match.id).eq("status", "active").is("bomb_state->>holder", null);
    return;
  }
  if (await currentRound(match.id)) return;
  await makeRound(match, 1);
}

function pairHasWords(start: string, end: string, used: Set<string>) {
  return (index.get(start + end) ?? []).some((word) => !used.has(word));
}

function availablePickLetters(match: Match, round: Round, uid: string) {
  if (round.phase !== "pick") return [];
  const botId = match.bot_actor_id ?? "kiki";
  const roles = rolesForRound(round.round_no, match.player1_id, match.player2_id ?? botId);
  const chainCarries = match.mode === "chain" && round.round_no > 1 && Boolean(round.picks.carryStart);
  const playerRole = chainCarries
    ? "end"
    : roles.startPicker === uid ? "start" : roles.endPicker === uid ? "end" : null;
  if (!playerRole || (match.vs_bot && uid !== match.player1_id)) return [];
  if (!match.vs_bot) {
    const expectedPicker = chainCarries
      ? roles.endPicker
      : round.picks[roles.startPicker] ? roles.endPicker : roles.startPicker;
    if (uid !== expectedPicker) return [];
  }

  const used = new Set(match.used_words);
  if (playerRole === "start") {
    return LETTERS.filter((start) => LETTERS.some((end) => pairHasWords(start, end, used)));
  }
  const start = chainCarries ? round.picks.carryStart : round.picks[roles.startPicker];
  if (start) return LETTERS.filter((end) => pairHasWords(start, end, used));
  return LETTERS.filter((end) => LETTERS.some((candidateStart) => pairHasWords(candidateStart, end, used)));
}

function publicRound(match: Match, uid: string, round: Round | null, ownAnswer: unknown, otherAnswers: unknown[]) {
  if (!round) return null;
  const resolved = round.phase === "result" || round.phase === "finished";
  return {
    id: round.id,
    roundNo: round.round_no,
    spec: round.phase === "pick" ? null : round.spec,
    phase: round.phase,
    deadlineAt: round.deadline_at,
    picks: round.picks,
    availableLetters: availablePickLetters(match, round, uid),
    lockedUserIds: round.locked_user_ids,
    chainBroken: round.chain_broken,
    suddenDeath: round.sudden_death,
    ownAnswer,
    answers: resolved ? otherAnswers : [],
    results: resolved ? round.results : null,
  };
}

async function getSnapshot(match: Match, uid: string) {
  const round = await currentRound(match.id);
  const db = admin();
  let ownAnswer: unknown = null;
  let visibleAnswers: unknown[] = [];
  if (round) {
    const { data: answers, error } = await db.from("linkup_answers").select("actor_id,user_id,word,valid,reason,answer_ms,points").eq("round_id", round.id);
    if (error) throw new Error("answer_snapshot_failed");
    const rows = answers ?? [];
    ownAnswer = rows.find((answer) => answer.actor_id === uid) ?? null;
    if (round.phase === "result" || round.phase === "finished") visibleAnswers = rows;
  }
  const safeBombState = match.mode === "bomb" && match.bomb_state && typeof match.bomb_state === "object" ? match.bomb_state : null;
  const liveFuseLeftMs = match.mode === "bomb" && safeBombState?.end && match.turn_started_at
    ? Math.max(0, match.fuse_left_ms - Math.max(0, Date.now() - toEpoch(match.turn_started_at)))
    : match.fuse_left_ms;
  return {
    serverNow: new Date().toISOString(),
    match: {
      id: match.id,
      mode: match.mode,
      vsBot: match.vs_bot,
      difficulty: match.bot_difficulty,
      player1Id: match.player1_id,
      player2Id: match.player2_id,
      botActorId: match.bot_actor_id,
      status: match.status,
      roundNo: match.round_no,
      scores: match.scores,
      fuseLeftMs: match.fuse_left_ms,
      liveFuseLeftMs,
      holderId: match.holder_id,
      passerId: match.passer_id,
      bombStart: match.bomb_start,
      bombEnd: match.bomb_end,
      turnStartedAt: match.turn_started_at,
      bombState: match.mode === "bomb" ? safeBombState : null,
      usedWords: match.mode === "bomb" && safeBombState ? safeBombState.used : undefined,
    },
    round: publicRound(match, uid, round, ownAnswer, visibleAnswers),
  };
}

async function resolveRound(match: Match, round: Round) {
  if (round.phase !== "answer") return;
  const db = admin();
  const { data: rows, error } = await db.from("linkup_answers").select("*").eq("round_id", round.id);
  if (error) throw new Error("answer_lookup_failed");
  const answers = rows ?? [];
  const botId = match.bot_actor_id ?? "kiki";
  const playerIds = [match.player1_id, match.player2_id ?? botId];
  const mapped = playerIds.map((userId) => {
    const row = answers.find((answer) => answer.actor_id === userId);
    const verdict: Verdict = row
      ? { valid: row.valid, word: row.word, reason: row.reason }
      : { valid: false, word: "", reason: "timeout" };
    return { userId, verdict, answerMs: row?.answer_ms ?? null, streakBefore: match.streaks[userId] ?? 0 };
  });
  const spec = round.spec!;
  const results = scoreRound(spec, mapped);
  const scores = applyRound(match.scores, results);
  const streaks = { ...match.streaks };
  for (const result of results) streaks[result.userId] = result.streakAfter;
  const usedWords = [...match.used_words, ...results.filter((result) => result.valid).map((result) => result.word)];
  const roundWinner = round.round_no >= 10 ? matchWinner(scores) : null;
  const finalRound = round.round_no >= 11 || (round.round_no >= 10 && roundWinner !== null);
  const winner = finalRound ? matchWinner(scores) : null;
  const { data: claimed, error: claimError } = await db.from("linkup_rounds").update({
    phase: finalRound ? "finished" : "result",
    phase_started_at: new Date().toISOString(),
    deadline_at: finalRound ? null : addMs(RESULT_WINDOW_MS),
    results: results.map((result) => ({ ...result, userId: result.userId === botId ? null : result.userId })),
  }).eq("id", round.id).eq("phase", "answer").select("id").maybeSingle();
  if (claimError) throw new Error("round_resolve_failed");
  if (!claimed) return;
  for (const result of results) {
    const actorId = result.userId === botId ? match.bot_actor_id ?? "kiki" : result.userId;
    const { error } = await db.from("linkup_answers").update({ points: result.points }).eq("round_id", round.id).eq("actor_id", actorId);
    if (error) throw new Error("answer_score_save_failed");
  }
  const { error: scoreError } = await db.from("linkup_matches").update({
    scores, streaks, used_words: usedWords, round_no: round.round_no,
    status: finalRound ? "finished" : "active",
    finished_at: finalRound ? new Date().toISOString() : null,
  }).eq("id", match.id);
  if (scoreError) throw new Error("match_score_save_failed");
  if (match.room_id) {
    const { error: roomError } = await db.from("game_rooms").update({ status: finalRound ? "post_game" : "playing", round_no: round.round_no }).eq("id", match.room_id);
    if (roomError) throw new Error("room_round_save_failed");
  }
}

function buildPickedSpec(match: Match, round: Round, picked: Record<string, string>) {
  const rng = mulberry32(match.seed + round.round_no * 13);
  const botId = match.bot_actor_id ?? "kiki";
  const roles = rolesForRound(round.round_no, match.player1_id, match.player2_id ?? botId);
  const carriedStart = round.picks.carryStart;
  const chainCarries = match.mode === "chain" && round.round_no > 1 && carriedStart;
  const start = chainCarries ? carriedStart : picked[roles.startPicker] ?? botLetter("start", rng);
  const end = picked[roles.endPicker] ?? botLetter("end", rng);
  const humanRole = match.vs_bot
    ? roles.startPicker === match.player1_id ? "start" : "end"
    : null;
  const spec = buildSpec({
    round: round.round_no,
    mode: match.mode,
    start,
    end,
    preserveStart: Boolean(chainCarries) || !match.vs_bot || humanRole === "start",
    preserveEnd: !match.vs_bot || humanRole === "end",
    idx: index,
    used: new Set(match.used_words),
    rng,
  });
  return {
    spec,
    picks: {
      ...picked,
      ...(chainCarries ? { carryStart: carriedStart } : {}),
      start: spec.start,
      end: spec.end,
    },
  };
}

async function advanceRound(match: Match, round: Round) {
  const db = admin();
  if (!round.spec) return;
  if (round.phase === "reveal") {
    if (!round.deadline_at || Date.parse(round.deadline_at) > Date.now()) return;
    const spec = round.spec;
    const updates: Record<string, unknown> = {
      phase: "answer",
      phase_started_at: new Date().toISOString(),
      deadline_at: addMs(ANSWER_WINDOW_MS),
    };
    if (match.vs_bot) {
      const rng = mulberry32(match.seed + round.round_no * 7919 + 17);
      updates.bot_answer = botAnswer(index, spec, new Set(match.used_words), match.bot_difficulty ?? "medium", rng, new Set());
    }
    await db.from("linkup_rounds").update(updates).eq("id", round.id).eq("phase", "reveal");
    return;
  }
  if (round.phase === "answer") {
    const bot = round.bot_answer;
    if (match.vs_bot && bot && bot.delayMs <= Date.now() - Date.parse(round.phase_started_at)) {
      const verdict = bot.word
        ? validateAnswer(bot.word, round.spec!, words, new Set(match.used_words))
        : { valid: false, word: "", reason: "timeout" as const };
      const { error: answerError } = await db.from("linkup_answers").upsert({
        round_id: round.id, actor_id: match.bot_actor_id ?? "kiki", user_id: null, raw_text: bot.word ?? "", alternatives: [],
        word: verdict.word, valid: verdict.valid, reason: verdict.reason,
        answer_ms: bot.delayMs, points: 0,
      }, { onConflict: "round_id,actor_id" });
      if (answerError) throw new Error("bot_answer_save_failed");
    }
    const { data: answers, error: answerLookupError } = await db.from("linkup_answers").select("user_id").eq("round_id", round.id);
    if (answerLookupError) throw new Error("answer_count_failed");
    if ((answers?.length ?? 0) >= 2 || (round.deadline_at !== null && Date.now() >= Date.parse(round.deadline_at))) {
      await resolveRound(match, round);
    }
    return;
  }
  if (round.phase === "result") {
    if (!round.deadline_at || Date.parse(round.deadline_at) > Date.now()) return;
    if (round.round_no >= 11) return;
    const latest = await loadMatch(match.id, match.player1_id);
    if (latest) await makeRound(latest, round.round_no + 1, undefined, round.round_no === 10);
  }
}

async function actOnBomb(match: Match, uid: string, action: z.infer<typeof schema>) {
  const db = admin();
  let state = match.bomb_state;
  if (!state?.holder) {
    await initializeMatch(match);
    const refreshed = await loadMatch(match.id, uid);
    if (!refreshed) throw new Error("match_missing");
    state = refreshed.bomb_state;
  }
  if (state.exploded) return;
  if (action.action === "bomb_end") {
    if (uid !== state.passer || !action.letter) throw new Error("not_picker");
    state = bombSetEnd(state, action.letter.toLowerCase());
    await db.from("linkup_matches").update({
      bomb_state: state, bomb_end: state.end, turn_started_at: new Date().toISOString(),
    }).eq("id", match.id).eq("turn_no", match.turn_no);
    return;
  }
  if (action.action === "answer") {
    if (uid !== state.holder) throw new Error("not_holder");
    if (!state.end) throw new Error("end_not_picked");
    const started = match.turn_started_at ? Date.parse(match.turn_started_at) : Date.now();
    const usedMs = Math.max(0, Date.now() - started);
    const spec = bombSpec(state);
    const verdict = validateAnswer(action.text ?? null, spec, words, new Set(state.used));
    const resolution = bombResolve(state, verdict, usedMs);
    state = resolution.state;
    const { data: claimed, error: updateError } = await db.from("linkup_matches").update({
      bomb_state: state, fuse_left_ms: state.fuseLeftMs, turn_no: match.turn_no + 1,
      holder_id: state.holder === match.bot_actor_id ? null : state.holder,
      passer_id: state.passer === match.bot_actor_id ? null : state.passer,
      bomb_start: state.start,
      bomb_end: state.end, turn_started_at: new Date().toISOString(),
      status: state.exploded ? "finished" : "active",
      finished_at: state.exploded ? new Date().toISOString() : null,
    }).eq("id", match.id).eq("turn_no", match.turn_no).eq("holder_id", uid).eq("status", "active").select("id").maybeSingle();
    if (updateError) throw new Error("bomb_turn_update_failed");
    if (!claimed) throw new Error("bomb_turn_already_resolved");
    await db.from("linkup_turns").insert({
      match_id: match.id, turn_no: match.turn_no,
      holder_id: match.holder_id === match.bot_actor_id ? null : match.holder_id,
      actor_id: match.bomb_state.holder,
      start: spec.start, end: spec.end, word: verdict.word, valid: verdict.valid,
      reason: verdict.reason, used_ms: usedMs, fuse_after_ms: state.fuseLeftMs, resolved: true,
    });
    return;
  }
  if (action.action === "advance") {
    const elapsed = Math.max(0, Date.now() - Date.parse(match.turn_started_at ?? new Date().toISOString()));
    if (!state.end) {
      if (elapsed < BOMB.pickMs) return;
      const end = botLetter("end", mulberry32(match.seed + state.turn * 31));
      state = bombSetEnd(state, end);
      await db.from("linkup_matches").update({
        bomb_state: state, bomb_end: end, turn_started_at: new Date().toISOString(),
      }).eq("id", match.id).eq("turn_no", match.turn_no).eq("bomb_state->>turn", String(state.turn));
      return;
    }
    if (elapsed >= match.fuse_left_ms) {
      state = { ...state, fuseLeftMs: 0, exploded: true, loser: state.holder };
      await db.from("linkup_matches").update({
        bomb_state: state, fuse_left_ms: 0, status: "finished", holder_id: state.holder === match.bot_actor_id ? null : state.holder,
        finished_at: new Date().toISOString(),
      }).eq("id", match.id).eq("bomb_state->>holder", state.holder).eq("turn_no", match.turn_no).eq("status", "active");
      return;
    }
    if (match.vs_bot && state.holder === match.bot_actor_id && state.end) {
      const spec = bombSpec(state);
      const rng = mulberry32(match.seed + state.turn * 23);
      const answer = botAnswer(index, spec, new Set(state.used), match.bot_difficulty ?? "medium", rng);
      if (elapsed >= answer.delayMs) {
        const verdict = answer.word ? validateAnswer(answer.word, spec, words, new Set(state.used)) : { valid: false, word: "", reason: "timeout" as const };
        const usedMs = Math.max(answer.delayMs, elapsed);
        const resolution = bombResolve(state, verdict, usedMs);
        const nextState = resolution.state;
        const { data: claimed } = await db.from("linkup_matches").update({
          bomb_state: nextState,
          fuse_left_ms: nextState.fuseLeftMs,
          turn_no: match.turn_no + 1,
          holder_id: nextState.holder === match.bot_actor_id ? null : nextState.holder,
          passer_id: nextState.passer === match.bot_actor_id ? null : nextState.passer,
          bomb_start: nextState.start,
          bomb_end: nextState.end,
          turn_started_at: new Date().toISOString(),
          status: nextState.exploded ? "finished" : "active",
          finished_at: nextState.exploded ? new Date().toISOString() : null,
        }).eq("id", match.id).eq("bomb_state->>holder", match.bot_actor_id!).eq("turn_no", match.turn_no)
          .eq("status", "active").select("id").maybeSingle();
        if (claimed) await db.from("linkup_turns").upsert({
          match_id: match.id,
          turn_no: match.turn_no,
          holder_id: null,
          actor_id: match.bot_actor_id ?? "kiki",
          start: spec.start,
          end: spec.end,
          word: verdict.word,
          valid: verdict.valid,
          reason: verdict.reason,
          used_ms: usedMs,
          fuse_after_ms: nextState.fuseLeftMs,
          resolved: true,
        }, { onConflict: "match_id,turn_no" });
      }
    }
  }
}

export async function GET(request: Request) {
  const user = await authenticatedUser();
  if (!user) return fail("not_authenticated", 401);
  const matchId = new URL(request.url).searchParams.get("matchId");
  const parsed = z.string().uuid().safeParse(matchId);
  if (!parsed.success) return fail("invalid_match_id");
  try {
    let match = await loadMatch(parsed.data, user.id);
    if (!match) return fail("match_not_found", 404);
    await initializeMatch(match);
    match = (await loadMatch(parsed.data, user.id))!;
    if (match.mode !== "bomb") {
      const round = await currentRound(match.id);
      if (round) await advanceRound(match, round);
      match = (await loadMatch(parsed.data, user.id))!;
    }
    return NextResponse.json(await getSnapshot(match, user.id));
  } catch (error) {
    console.error("linkup get snapshot failed", error);
    return fail("match_state_unavailable", 500);
  }
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) return fail("not_authenticated", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid_request");
  const action = parsed.data;
  try {
    const match = await loadMatch(action.matchId, user.id);
    if (!match) return fail("match_not_found", 404);
    if (match.status === "finished") return NextResponse.json(await getSnapshot(match, user.id));
    if (match.mode === "bomb") {
      await actOnBomb(match, user.id, action);
    } else {
      let round = await currentRound(match.id);
      if (action.action === "pick" && round?.phase === "pick" && action.letter) {
        const botId = match.bot_actor_id ?? "kiki";
        const roles = rolesForRound(round.round_no, match.player1_id, match.player2_id ?? botId);
        const chainCarries = match.mode === "chain" && round.round_no > 1 && Boolean(round.picks.carryStart);
        const selectionKey = chainCarries ? roles.endPicker : user.id;
        if (round.picks[selectionKey]) return fail("pick_already_locked", 409);
        const allowedLetters = availablePickLetters(match, round, user.id);
        if (!allowedLetters.includes(action.letter.toLowerCase())) return fail("letter_has_no_words", 409);
        if (!match.vs_bot) {
          const expectedPicker = chainCarries ? roles.endPicker : round.picks[roles.startPicker] ? roles.endPicker : roles.startPicker;
          if (user.id !== expectedPicker) throw new Error("not_picker");
        }
        if (match.vs_bot && user.id !== match.player1_id) throw new Error("not_picker");
        const picks = { ...round.picks, [user.id]: action.letter.toLowerCase() };
        const rng = mulberry32(match.seed + round.round_no * 13);
        if (match.vs_bot) {
          const botRole = roles.startPicker === botId ? "start" : "end";
          if (!chainCarries) picks[botId] = botLetter(botRole, rng);
          const humanRole = roles.startPicker === match.player1_id ? roles.startPicker : roles.endPicker;
          picks[humanRole] = action.letter.toLowerCase();
          if (chainCarries) {
            delete picks[roles.startPicker];
            picks[roles.endPicker] = roles.endPicker === match.player1_id ? action.letter.toLowerCase() : botLetter("end", rng);
          }
          const built = buildPickedSpec(match, round, picks);
          await admin().from("linkup_rounds").update({
            picks: built.picks, spec: built.spec, phase: "reveal",
            phase_started_at: new Date().toISOString(), deadline_at: addMs(built.spec.mode === "wildcard" ? REVEAL_WINDOW_MS + 1200 : REVEAL_WINDOW_MS),
          }).eq("id", round.id).eq("phase", "pick");
        } else {
          const pickerKey = chainCarries ? roles.endPicker : user.id;
          picks[pickerKey] = action.letter.toLowerCase();
          const required = chainCarries ? [roles.endPicker] : [roles.startPicker, roles.endPicker];
          if (required.every((picker) => typeof picks[picker] === "string")) {
            const built = buildPickedSpec(match, round, picks);
            await admin().from("linkup_rounds").update({
              picks: built.picks, spec: built.spec, phase: "reveal",
              phase_started_at: new Date().toISOString(), deadline_at: addMs(built.spec.mode === "wildcard" ? REVEAL_WINDOW_MS + 1200 : REVEAL_WINDOW_MS),
            }).eq("id", round.id).eq("phase", "pick");
          } else {
            await admin().from("linkup_rounds").update({ picks }).eq("id", round.id).eq("phase", "pick");
          }
        }
      } else if (action.action === "answer" && round?.phase === "answer") {
        const existing = await admin().from("linkup_answers").select("id").eq("round_id", round.id).eq("actor_id", user.id).maybeSingle();
        if (!existing.data) {
          const elapsed = Math.max(0, Date.now() - Date.parse(round.phase_started_at));
          if (elapsed > ANSWER_WINDOW_MS) return fail("answer_late", 409);
          const submitted = action.alternatives?.length ? action.alternatives : [action.text ?? ""];
          const verdict = submitted.map((candidate) => validateAnswer(candidate, round!.spec!, words, new Set(match!.used_words))).find((candidate) => candidate.valid)
            ?? validateAnswer(submitted[0] ?? "", round.spec!, words, new Set(match.used_words));
          await admin().from("linkup_answers").insert({
            round_id: round.id, actor_id: user.id, user_id: user.id, raw_text: action.text ?? "",
            alternatives: action.alternatives ?? [], word: verdict.word, valid: verdict.valid,
            reason: verdict.reason,
            answer_ms: elapsed,
            points: 0,
          });
          await admin().from("linkup_rounds").update({
            locked_user_ids: Array.from(new Set([...round.locked_user_ids, user.id])),
          }).eq("id", round.id).eq("phase", "answer");
        }
      } else if (action.action === "advance") {
        if (round?.phase === "pick" && round.deadline_at && Date.parse(round.deadline_at) <= Date.now()) {
          const roles = rolesForRound(round.round_no, match.player1_id, match.player2_id ?? match.bot_actor_id ?? "kiki");
          const rng = mulberry32(match.seed + round.round_no * 17);
          const chainCarries = match.mode === "chain" && round.round_no > 1 && Boolean(round.picks.carryStart);
          const picks = { ...round.picks };
          if (match.vs_bot) {
            if (chainCarries) picks[roles.endPicker] = picks[roles.endPicker] ?? botLetter("end", rng);
            else {
              picks[roles.startPicker] = picks[roles.startPicker] ?? botLetter("start", rng);
              picks[roles.endPicker] = picks[roles.endPicker] ?? botLetter("end", rng);
            }
          } else if (chainCarries) {
            picks[roles.endPicker] = picks[roles.endPicker] ?? botLetter("end", rng);
          } else {
            picks[roles.startPicker] = picks[roles.startPicker] ?? botLetter("start", rng);
            picks[roles.endPicker] = picks[roles.endPicker] ?? botLetter("end", rng);
          }
          const built = buildPickedSpec(match, round, picks);
          await admin().from("linkup_rounds").update({
            picks: built.picks, spec: built.spec, phase: "reveal",
            phase_started_at: new Date().toISOString(), deadline_at: addMs(built.spec.mode === "wildcard" ? REVEAL_WINDOW_MS + 1200 : REVEAL_WINDOW_MS),
          }).eq("id", round.id).eq("phase", "pick");
        }
      }
      round = await currentRound(match.id);
      if (round) await advanceRound(match, round);
    }
    const latest = await loadMatch(action.matchId, user.id);
    if (!latest) return fail("match_not_found", 404);
    return NextResponse.json(await getSnapshot(latest, user.id));
  } catch (error) {
    console.error("linkup action failed", error);
    return fail("action_failed", 500);
  }
}
