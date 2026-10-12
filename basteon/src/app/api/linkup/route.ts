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
import { botAnswer, botLetter, buildBotRoundPick } from "@/lib/games/linkup/bot";
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
const PICK_WINDOW_MS = 10_000;
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
const botActorId = (match: Match) => match.bot_actor_id ?? "kiki";
const databaseActorId = (match: Match, actorId: string) =>
  match.vs_bot && actorId === botActorId(match) ? null : actorId;
const toEpoch = (value: string | null | undefined) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
function requireDatabaseSuccess(operation: string, error: unknown) {
  if (error) {
    console.error(`linkup ${operation} failed`, error);
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
    throw new Error(code ? `${operation}:${code}` : operation);
  }
}
function isBombState(value: unknown): value is BombState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<BombState>;
  return typeof state.holder === "string"
    && typeof state.passer === "string"
    && typeof state.start === "string"
    && /^[a-z]$/.test(state.start)
    && (state.end === null || typeof state.end === "string" && /^[a-z]$/.test(state.end))
    && Array.isArray(state.used)
    && state.used.every((word) => typeof word === "string")
    && typeof state.fuseLeftMs === "number"
    && typeof state.turn === "number"
    && typeof state.exploded === "boolean"
    && (state.loser === null || typeof state.loser === "string")
    && Boolean(state.words && typeof state.words === "object")
    && Boolean(state.longest && typeof state.longest === "object");
}

async function authenticatedUser() {
  const session = await createClient();
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function loadMatch(matchId: string, uid: string) {
  const db = admin();
  const { data, error } = await db.from("linkup_matches").select("*").eq("id", matchId).maybeSingle();
  requireDatabaseSuccess("match_lookup", error);
  if (!data || (data.player1_id !== uid && data.player2_id !== uid)) return null;
  return {
    ...data,
    bot_actor_id: data.vs_bot ? data.bot_actor_id ?? "kiki" : data.bot_actor_id,
  } as Match;
}

async function currentRound(matchId: string) {
  const { data, error } = await admin().from("linkup_rounds").select("*").eq("match_id", matchId).order("round_no", { ascending: false }).limit(1).maybeSingle();
  requireDatabaseSuccess("round_lookup", error);
  return data as Round | null;
}

async function makeRound(match: Match, roundNo: number, carry?: string | null, suddenDeath = false) {
  const roundMode: Mode = suddenDeath ? "classic" : match.mode;
  let previousAnswers: { data: { word: string; valid: boolean; answer_ms: number | null }[] | null; error: unknown } = { data: [], error: null };
  if (roundNo > 1 && roundMode === "chain" && carry === undefined) {
    const { data: previousRound, error: previousError } = await admin().from("linkup_rounds")
      .select("id").eq("match_id", match.id).eq("round_no", roundNo - 1).maybeSingle();
    requireDatabaseSuccess("previous_round_lookup", previousError);
    if (previousRound) {
      previousAnswers = await admin().from("linkup_answers")
        .select("word,valid,answer_ms").eq("round_id", previousRound.id);
      requireDatabaseSuccess("previous_answers_lookup", previousAnswers.error);
    }
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
  requireDatabaseSuccess("round_create", error);
  if (data) return data as Round;
  const existing = await admin().from("linkup_rounds").select("*").eq("match_id", match.id).eq("round_no", roundNo).single();
  requireDatabaseSuccess("round_lookup", existing.error);
  return existing.data as Round;
}

async function initializeMatch(match: Match) {
  if (match.mode === "bomb") {
    if (isBombState(match.bomb_state)) return;
    if (match.turn_no !== 0 || match.status !== "active") throw new Error("bomb_state_unavailable");
    const opponent = match.vs_bot ? botActorId(match) : match.player2_id!;
    const state = bombInit(match.player1_id, opponent, "s");
    const { error } = await admin().from("linkup_matches").update({
      bot_actor_id: match.vs_bot ? opponent : match.bot_actor_id,
      status: "active",
      holder_id: databaseActorId(match, state.holder),
      passer_id: databaseActorId(match, state.passer),
      turn_no: 1,
      turn_started_at: new Date().toISOString(),
      bomb_start: state.start,
      bomb_end: null,
      fuse_left_ms: state.fuseLeftMs,
      bomb_state: state,
      round_no: 1,
    }).eq("id", match.id).eq("status", "active").eq("turn_no", 0).is("holder_id", null);
    requireDatabaseSuccess("bomb_initialization", error);
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
  if (match.vs_bot && chainCarries && roles.endPicker !== uid) return [];
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
    requireDatabaseSuccess("answer_snapshot", error);
    const rows = answers ?? [];
    ownAnswer = rows.find((answer) => answer.actor_id === uid) ?? null;
    if (round.phase === "result" || round.phase === "finished") visibleAnswers = rows;
  }
  const safeBombState = match.mode === "bomb" && isBombState(match.bomb_state) ? match.bomb_state : null;
  if (match.mode === "bomb" && !safeBombState) throw new Error("bomb_state_unavailable");
  const liveFuseLeftMs = match.mode === "bomb" && safeBombState?.end && match.turn_started_at
    ? Math.max(0, match.fuse_left_ms - Math.max(0, Date.now() - toEpoch(match.turn_started_at)))
    : match.fuse_left_ms;
  let rematchRoom: { rematch_host: boolean; rematch_guest: boolean } | null = null;
  if (match.room_id) {
    const { data, error } = await db.from("game_rooms")
      .select("rematch_host,rematch_guest")
      .eq("id", match.room_id)
      .maybeSingle();
    requireDatabaseSuccess("rematch_state_lookup", error);
    rematchRoom = data;
  }
  return {
    serverNow: new Date().toISOString(),
    match: {
      id: match.id,
      viewerId: uid,
      mode: match.mode,
      vsBot: match.vs_bot,
      difficulty: match.bot_difficulty,
      player1Id: match.player1_id,
      player2Id: match.player2_id,
      botActorId: match.bot_actor_id,
      roomId: match.room_id,
      rematchHost: rematchRoom?.rematch_host ?? false,
      rematchGuest: rematchRoom?.rematch_guest ?? false,
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
      availableBombEndLetters: safeBombState && safeBombState.passer === uid && !safeBombState.end
        ? LETTERS.filter((letter) => pairHasWords(safeBombState.start, letter, new Set(safeBombState.used)))
        : [],
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
  const finishedAt = finalRound ? new Date().toISOString() : null;
  const { data: committed, error: commitError } = await db.rpc("linkup_commit_round", {
    p_match_id: match.id,
    p_round_id: round.id,
    p_round_no: round.round_no,
    p_results: results.map((result) => ({ ...result, userId: result.userId === botId ? null : result.userId })),
    p_scores: scores,
    p_streaks: streaks,
    p_used_words: usedWords,
    p_deadline_at: finalRound ? null : addMs(RESULT_WINDOW_MS),
    p_finished_at: finishedAt,
  });
  requireDatabaseSuccess("round_resolve", commitError);
  if (!committed) return;
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

async function autoPickRound(match: Match, round: Round) {
  if (round.phase !== "pick" || !round.deadline_at || Date.parse(round.deadline_at) > Date.now()) return;
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
  const { error } = await admin().from("linkup_rounds").update({
    picks: built.picks,
    spec: built.spec,
    phase: "reveal",
    phase_started_at: new Date().toISOString(),
    deadline_at: addMs(built.spec.mode === "wildcard" ? REVEAL_WINDOW_MS + 1200 : REVEAL_WINDOW_MS),
  }).eq("id", round.id).eq("phase", "pick").lte("deadline_at", new Date().toISOString());
  requireDatabaseSuccess("pick_timeout_advance", error);
}

async function markBombRoomFinished(match: Match) {
  if (!match.room_id) return;
  const { error } = await admin().from("game_rooms").update({
    status: "post_game",
    updated_at: new Date().toISOString(),
  }).eq("id", match.room_id);
  if (error) throw new Error("bomb_room_finish_failed");
}

async function advanceRound(match: Match, round: Round) {
  const db = admin();
  if (round.phase === "pick") {
    await autoPickRound(match, round);
    return;
  }
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
    const { error } = await db.from("linkup_rounds").update(updates).eq("id", round.id).eq("phase", "reveal");
    requireDatabaseSuccess("reveal_advance", error);
    return;
  }
  if (round.phase === "answer") {
    const bot = round.bot_answer;
    if (match.vs_bot && bot && bot.delayMs <= Date.now() - Date.parse(round.phase_started_at)) {
      const verdict = bot.word
        ? validateAnswer(bot.word, round.spec!, words, new Set(match.used_words))
        : { valid: false, word: "", reason: "timeout" as const };
      const actorId = botActorId(match);
      const { data: existingAnswer, error: lookupError } = await db.from("linkup_answers")
        .select("id").eq("round_id", round.id).eq("actor_id", actorId).maybeSingle();
      requireDatabaseSuccess("bot_answer_lookup", lookupError);
      if (!existingAnswer) {
        const { error: answerError } = await db.from("linkup_answers").insert({
          round_id: round.id, actor_id: actorId, user_id: null, raw_text: bot.word ?? "", alternatives: [],
          word: verdict.word, valid: verdict.valid, reason: verdict.reason,
          answer_ms: bot.delayMs, points: 0,
        });
        if (answerError?.code !== "23505") requireDatabaseSuccess("bot_answer_save", answerError);
      }
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
  const botId = botActorId(match);
  let state = match.bomb_state;
  if (!isBombState(state)) {
    await initializeMatch(match);
    const refreshed = await loadMatch(match.id, uid);
    if (!refreshed) throw new Error("match_missing");
    state = refreshed.bomb_state;
  }
  if (!isBombState(state)) throw new Error("bomb_state_unavailable");
  if (state.exploded) return;
  if (action.action === "bomb_end") {
    const letter = action.letter?.toLowerCase();
    if (uid !== state.passer || !letter) throw new Error("not_picker");
    if (!pairHasWords(state.start, letter, new Set(state.used))) throw new Error("letter_has_no_words");
    state = bombSetEnd(state, letter);
    const { data: claimed, error } = await db.from("linkup_matches").update({
      bomb_state: state, bomb_end: state.end, turn_started_at: new Date().toISOString(),
    }).eq("id", match.id).eq("turn_no", match.turn_no).eq("passer_id", uid)
      .is("bomb_end", null).eq("status", "active").select("id").maybeSingle();
    requireDatabaseSuccess("bomb_end_pick", error);
    if (!claimed) throw new Error("bomb_turn_already_resolved");
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
    const { data: claimed, error: commitError } = await db.rpc("linkup_commit_bomb_turn", {
      p_match_id: match.id,
      p_expected_turn: match.turn_no,
      p_expected_holder: match.bomb_state.holder,
      p_next_state: state,
      p_next_holder_id: databaseActorId(match, state.holder),
      p_next_passer_id: databaseActorId(match, state.passer),
      p_history_holder_id: databaseActorId(match, match.bomb_state.holder),
      p_start: spec.start,
      p_end: spec.end,
      p_word: verdict.word,
      p_valid: verdict.valid,
      p_reason: verdict.reason,
      p_used_ms: usedMs,
      p_fuse_after_ms: state.fuseLeftMs,
    });
    requireDatabaseSuccess("bomb_turn_commit", commitError);
    if (!claimed) throw new Error("bomb_turn_already_resolved");
    if (state.exploded) await markBombRoomFinished(match);
    return;
  }
  if (action.action === "advance") {
    const elapsed = Math.max(0, Date.now() - Date.parse(match.turn_started_at ?? new Date().toISOString()));
    if (!state.end) {
      const botIsPicking = match.vs_bot && state.passer === botId;
      if (!botIsPicking && elapsed < BOMB.pickMs) return;
      const availableEnds = LETTERS.filter((letter) => pairHasWords(state.start, letter, new Set(state.used)));
      if (availableEnds.length === 0) throw new Error("bomb_no_playable_end_letters");
      const rng = mulberry32(match.seed + state.turn * 31);
      const botPick = botIsPicking ? botLetter("end", rng) : null;
      const end = botPick && availableEnds.includes(botPick)
        ? botPick
        : availableEnds[Math.floor(rng() * availableEnds.length)];
      state = bombSetEnd(state, end);
      const { error } = await db.from("linkup_matches").update({
        bomb_state: state, bomb_end: end, turn_started_at: new Date().toISOString(),
      }).eq("id", match.id).eq("turn_no", match.turn_no).is("bomb_end", null).eq("status", "active");
      requireDatabaseSuccess("bomb_end_auto_pick", error);
      return;
    }
    if (elapsed >= match.fuse_left_ms) {
      state = { ...state, fuseLeftMs: 0, exploded: true, loser: state.holder };
      const { data: claimed, error } = await db.from("linkup_matches").update({
        bomb_state: state, fuse_left_ms: 0, status: "finished", holder_id: databaseActorId(match, state.holder),
        finished_at: new Date().toISOString(),
      }).eq("id", match.id).eq("bomb_state->>holder", state.holder).eq("turn_no", match.turn_no).eq("status", "active").select("id").maybeSingle();
      if (error) throw new Error("bomb_explosion_update_failed");
      if (claimed) await markBombRoomFinished(match);
      return;
    }
    if (match.vs_bot && state.holder === botId && state.end) {
      const rng = mulberry32(match.seed + state.turn * 23);
      const spec = buildSpec({
        round: state.turn,
        mode: "classic",
        start: state.start,
        end: state.end,
        preserveStart: true,
        preserveEnd: true,
        idx: index,
        used: new Set(state.used),
        rng,
      });
      const answer = botAnswer(index, spec, new Set(state.used), match.bot_difficulty ?? "medium", rng);
      if (elapsed >= answer.delayMs) {
        const verdict = answer.word ? validateAnswer(answer.word, spec, words, new Set(state.used)) : { valid: false, word: "", reason: "timeout" as const };
        const usedMs = Math.max(answer.delayMs, elapsed);
        const resolution = bombResolve(state, verdict, usedMs);
        const nextState = resolution.state;
        const { data: claimed, error: commitError } = await db.rpc("linkup_commit_bomb_turn", {
          p_match_id: match.id,
          p_expected_turn: match.turn_no,
          p_expected_holder: botId,
          p_next_state: nextState,
          p_next_holder_id: databaseActorId(match, nextState.holder),
          p_next_passer_id: databaseActorId(match, nextState.passer),
          p_history_holder_id: null,
          p_start: spec.start,
          p_end: spec.end,
          p_word: verdict.word,
          p_valid: verdict.valid,
          p_reason: verdict.reason,
          p_used_ms: usedMs,
          p_fuse_after_ms: nextState.fuseLeftMs,
        });
        requireDatabaseSuccess("bomb_bot_commit", commitError);
        if (claimed) {
          if (nextState.exploded) await markBombRoomFinished(match);
        }
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
  let operation = "load_match";
  try {
    let match = await loadMatch(parsed.data, user.id);
    if (!match) return fail("match_not_found", 404);
    operation = "initialize_match";
    await initializeMatch(match);
    const initializedMatch = await loadMatch(parsed.data, user.id);
    if (!initializedMatch) return fail("match_not_found", 404);
    match = initializedMatch;
    if (match.mode === "bomb" && match.status === "finished") await markBombRoomFinished(match);
    if (match.mode !== "bomb") {
      operation = "advance_round";
      const round = await currentRound(match.id);
      if (round) await advanceRound(match, round);
      const advancedMatch = await loadMatch(parsed.data, user.id);
      if (!advancedMatch) return fail("match_not_found", 404);
      match = advancedMatch;
    }
    operation = "build_snapshot";
    return NextResponse.json(await getSnapshot(match, user.id));
  } catch (error) {
    console.error("linkup get snapshot failed", { matchId: parsed.data, operation, error });
    const rawReason = error instanceof Error ? error.message : "";
    const reason = /^[a-z][a-z0-9_:-]{0,80}$/i.test(rawReason) ? rawReason : "unknown";
    return NextResponse.json({
      error: "match_state_unavailable",
      operation,
      reason,
    }, { status: 500 });
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
    if (match.status === "finished") {
      if (match.mode === "bomb") await markBombRoomFinished(match);
      return NextResponse.json(await getSnapshot(match, user.id));
    }
    if (match.mode === "bomb") {
      try {
        await actOnBomb(match, user.id, action);
      } catch (error) {
        if (error instanceof Error && error.message === "bomb_turn_already_resolved") {
          return fail("bomb_turn_already_resolved", 409);
        }
        if (error instanceof Error && error.message === "letter_has_no_words") {
          return fail("letter_has_no_words", 409);
        }
        throw error;
      }
    } else {
      let round = await currentRound(match.id);
      if (round?.phase === "pick" && round.deadline_at && Date.parse(round.deadline_at) <= Date.now()) {
        await autoPickRound(match, round);
        round = await currentRound(match.id);
      }
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
        if (match.vs_bot) {
          const built = buildBotRoundPick({
            round: round.round_no,
            mode: match.mode,
            playerId: match.player1_id,
            botId,
            carryStart: round.picks.carryStart,
            letter: action.letter,
            idx: index,
            used: new Set(match.used_words),
            rng: mulberry32(match.seed + round.round_no * 13),
          });
          if (!built) return fail("not_picker", 403);
          const { error } = await admin().from("linkup_rounds").update({
            picks: built.picks, spec: built.spec, phase: "reveal",
            phase_started_at: new Date().toISOString(), deadline_at: addMs(built.spec.mode === "wildcard" ? REVEAL_WINDOW_MS + 1200 : REVEAL_WINDOW_MS),
          }).eq("id", round.id).eq("phase", "pick");
          requireDatabaseSuccess("bot_pick_save", error);
        } else {
          const picks = { ...round.picks, [user.id]: action.letter.toLowerCase() };
          const pickerKey = chainCarries ? roles.endPicker : user.id;
          picks[pickerKey] = action.letter.toLowerCase();
          const required = chainCarries ? [roles.endPicker] : [roles.startPicker, roles.endPicker];
          if (required.every((picker) => typeof picks[picker] === "string")) {
            const built = buildPickedSpec(match, round, picks);
            const { error } = await admin().from("linkup_rounds").update({
              picks: built.picks, spec: built.spec, phase: "reveal",
              phase_started_at: new Date().toISOString(), deadline_at: addMs(built.spec.mode === "wildcard" ? REVEAL_WINDOW_MS + 1200 : REVEAL_WINDOW_MS),
            }).eq("id", round.id).eq("phase", "pick");
            requireDatabaseSuccess("pick_reveal_save", error);
          } else {
            const { error } = await admin().from("linkup_rounds").update({ picks }).eq("id", round.id).eq("phase", "pick");
            requireDatabaseSuccess("pick_save", error);
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
          const { error: answerInsertError } = await admin().from("linkup_answers").insert({
            round_id: round.id, actor_id: user.id, user_id: user.id, raw_text: action.text ?? "",
            alternatives: action.alternatives ?? [], word: verdict.word, valid: verdict.valid,
            reason: verdict.reason,
            answer_ms: elapsed,
            points: 0,
          });
          requireDatabaseSuccess("answer_save", answerInsertError);
          const { error: lockError } = await admin().from("linkup_rounds").update({
            locked_user_ids: Array.from(new Set([...round.locked_user_ids, user.id])),
          }).eq("id", round.id).eq("phase", "answer");
          requireDatabaseSuccess("answer_lock", lockError);
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
    const rawReason = error instanceof Error ? error.message : "";
    const reason = /^[a-z][a-z0-9_:-]{0,80}$/i.test(rawReason) ? rawReason : "unknown";
    return NextResponse.json({ error: "action_failed", reason }, { status: 500 });
  }
}
