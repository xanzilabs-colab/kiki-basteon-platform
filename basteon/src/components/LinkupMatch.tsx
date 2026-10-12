"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bomb, Check, Flame, Heart, Link2, Mic, Sparkles, Volume2, VolumeX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BOMB, rolesForRound, wildcardBanner } from "@/lib/games/linkup/engine";
import type { Mode, RoundSpec } from "@/lib/games/linkup/engine";
import { formatLinkupError, formatLinkupMode, formatLinkupReason } from "@/lib/games/linkup/presentation";
import { pickTimeRemainingMs } from "@/lib/games/linkup/pickTiming";
import { dismissGameError, showGameError } from "@/lib/gameFeedback";
import styles from "./LinkupMatch.module.css";

type Snapshot = {
  serverNow: string;
  match: {
    id: string;
    viewerId: string;
    mode: Mode;
    vsBot: boolean;
    difficulty: string | null;
    usedWords?: string[];
    player1Id: string;
    player2Id: string | null;
    botActorId: string | null;
    roomId: string | null;
    rematchHost: boolean;
    rematchGuest: boolean;
    status: string;
    roundNo: number;
    scores: Record<string, number>;
    fuseLeftMs: number;
    liveFuseLeftMs: number;
    turnStartedAt: string | null;
    holderId: string | null;
    passerId: string | null;
    bombStart: string | null;
    bombEnd: string | null;
    availableBombEndLetters: string[];
    bombState: {
      holder: string; passer: string; start: string; end: string | null;
      fuseLeftMs: number; used: string[]; words: Record<string, number>;
      longest: Record<string, string>; exploded: boolean; loser: string | null; turn: number;
    } | null;
  };
  round: null | {
    id: string;
    roundNo: number;
    spec: RoundSpec | null;
    phase: string;
    deadlineAt: string | null;
    picks: Record<string, string>;
    availableLetters: string[];
    lockedUserIds: string[];
    chainBroken: boolean;
    suddenDeath: boolean;
    ownAnswer: { valid: boolean; word: string; reason: string } | null;
    answers: { user_id: string | null; actor_id: string; word: string; valid: boolean; reason: string; answer_ms: number | null; points: number }[];
    results: { userId: string | null; word: string; points: number; stolen: number; valid: boolean; reason: string; streakAfter: number }[] | null;
  };
};

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const displayLetter = (value: string | null | undefined) =>
  typeof value === "string" && value.length > 0 ? value.toUpperCase() : "?";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function LinkupMatch({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [userId, setUserId] = useState("");
  const [word, setWord] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(true);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [localPickedLetter, setLocalPickedLetter] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const lastTickRef = useRef(0);
  const lastPhaseRef = useRef<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const busyRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const syncSequenceRef = useRef(0);
  const syncToastId = `linkup-sync-${matchId}`;

  const reportSyncFailure = useCallback((failure: unknown) => {
    const description = failure instanceof Error
      ? failure.message
      : "Your match is still saved. We are retrying the connection.";
    setMessage(description);
    showGameError(
      "Match sync interrupted",
      description,
      syncToastId,
    );
  }, [syncToastId]);

  useEffect(() => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
  }, []);

  const startDictation = useCallback(() => {
    if (recognitionRef.current) return;
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMessage("Voice input is not supported in this browser.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setWord(transcript);
    };
    recognition.onerror = (event) => {
      const errorMessage = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone permission was denied."
        : event.error === "no-speech"
          ? "No speech was detected. Hold the microphone and try again."
          : "Voice input failed. Please try typing your answer.";
      setMessage(errorMessage);
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setMessage("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setMessage("Could not start voice input. Check microphone access and try again.");
    }
  }, []);

  const stopDictation = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      setMessage("Voice input could not be stopped. Please try typing your answer.");
      recognitionRef.current = null;
      setListening(false);
    }
  }, []);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const speechButton = (
    <button
      type="button"
      className={`${styles.micButton} ${listening ? styles.listening : ""}`}
      disabled={!speechSupported}
      aria-label={listening ? "Release to finish speaking" : "Hold to speak your answer"}
      aria-pressed={listening}
      title={speechSupported ? "Hold to speak" : "Voice input is unavailable in this browser"}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        startDictation();
      }}
      onPointerUp={stopDictation}
      onPointerCancel={stopDictation}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          startDictation();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") stopDictation();
      }}
      onBlur={stopDictation}
    >
      <span className={styles.micIcon}><Mic size={21} /></span>
      <span className={styles.micCopy}><strong>{listening ? "Listening…" : "Hold to speak"}</strong><small>{listening ? "Release when you’re done" : "Say your word instead of typing"}</small></span>
    </button>
  );

  const playTone = useCallback((frequency: number, duration = 0.08, type: OscillatorType = "sine", gainValue = 0.04) => {
    if (!sound || typeof window === "undefined") return;
    try {
      const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      const audioContext = audioRef.current ?? new AudioCtor();
      audioRef.current = audioContext;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(gainValue, audioContext.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration + 0.02);
    } catch {
      // Silent fallback when audio is unavailable.
    }
  }, [sound]);

  const refresh = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    const sequence = ++syncSequenceRef.current;
    try {
      const response = await fetch(`/api/linkup?matchId=${encodeURIComponent(matchId)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { error?: unknown; operation?: unknown; reason?: unknown } | null;
      if (sequence !== syncSequenceRef.current) return;
      if (!response.ok) {
        const reason = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
        if (reason === "match_state_unavailable") {
          const operation = typeof body?.operation === "string" ? body.operation : "";
          const descriptions: Record<string, string> = {
            initialize_match: "The match is saved, but its opening round could not be prepared. We are retrying.",
            advance_round: "The latest turn is saved, but its next round could not be loaded. We are retrying.",
            build_snapshot: "The game is running, but its latest view could not be loaded. We are retrying.",
          };
          const explanation = descriptions[operation] ?? "Your match is still saved. We are retrying the connection.";
          throw new Error(explanation);
        }
        throw new Error(formatLinkupError(reason));
      }
      if (!body) throw new Error("Match sync returned an empty response.");
      const next = body as Snapshot;
      dismissGameError(syncToastId);
      setMessage("");
      setSnapshot(next);
      setUserId(next.match.viewerId);
      setNow(Date.parse(next.serverNow || new Date().toISOString()));
    } finally {
      syncInFlightRef.current = false;
    }
  }, [matchId, syncToastId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow((current) => current + 1000);
      if (!busyRef.current) void refresh().catch(reportSyncFailure);
    }, 1000);
    void refresh().catch(reportSyncFailure);
    return () => { window.clearInterval(timer); dismissGameError(syncToastId); };
  }, [refresh, reportSyncFailure, syncToastId]);

  useEffect(() => {
    setWord("");
    setHistory([]);
    setLocalPickedLetter(null);
  }, [matchId]);

  const send = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    syncSequenceRef.current += 1;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/linkup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId, action, ...extra }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(formatLinkupError(
        typeof result.error === "string" ? result.error : undefined,
        typeof result.reason === "string" ? result.reason : undefined,
      ));
      setSnapshot(result as Snapshot);
      setUserId((result as Snapshot).match.viewerId);
      setNow(Date.parse((result as Snapshot).serverNow || new Date().toISOString()));
      syncSequenceRef.current += 1;
      dismissGameError(syncToastId);
      if (action === "pick") playTone(520, 0.08, "triangle", 0.03);
      if (action === "answer") playTone(820, 0.09, "sine", 0.04);
      return true;
    } catch (error) {
      const description = error instanceof Error ? error.message : "That move could not be saved. Please try again.";
      setMessage(description);
      showGameError("Move not saved", description);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [matchId, playTone, syncToastId]);

  useEffect(() => {
    const spec = snapshot?.round?.spec;
    if (snapshot?.round?.phase === "result" && spec?.mode === "chain") {
      const answer = snapshot.round.answers
        .filter((item) => item.valid && item.answer_ms !== null)
        .sort((a, b) => (a.answer_ms ?? Infinity) - (b.answer_ms ?? Infinity))[0];
      if (answer?.word) setHistory((current) => [...current.slice(-9), answer.word]);
    }
  }, [snapshot?.round?.id, snapshot?.round?.phase]);

  useEffect(() => {
    if (snapshot?.round?.roundNo === 1 && snapshot.round.phase === "pick") {
      setWord("");
      setHistory([]);
    }
  }, [snapshot?.round?.id]);

  const state = snapshot;
  const match = state?.match;
  const round = state?.round;
  const bomb = match?.bombState;
  const isBot = match?.vsBot;
  const opponent = isBot ? match?.botActorId ?? "kiki" : match?.player2Id ?? "";
  const myScore = match ? match.scores[userId] ?? 0 : 0;
  const otherScore = match ? match.scores[opponent] ?? 0 : 0;
  const rematchRequested = match?.roomId && userId
    ? userId === match.player1Id ? match.rematchHost : match.rematchGuest
    : false;
  const currentSpec = round?.spec;
  const mineWarning = Boolean(word && currentSpec?.mines.some((mine) => word.toLowerCase().includes(mine)));
  const countdown = round?.deadlineAt ? Math.max(0, Math.ceil((Date.parse(round.deadlineAt) - now) / 1000)) : 0;
  const pickFinalizeCountdown = round?.deadlineAt
    ? Math.max(0, Math.ceil(pickTimeRemainingMs(round.deadlineAt, now) / 1000))
    : 0;
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const holderTurn = Boolean(bomb && bomb.holder === userId);
  const endPickerTurn = Boolean(bomb && bomb.passer === userId && !bomb.end);
  const bombSeconds = match?.liveFuseLeftMs ? Math.max(0, Math.ceil(match.liveFuseLeftMs / 1000)) : 0;
  const myRole = useMemo(() => {
    if (!round || !match) return "";
    const roles = rolesForRound(round.roundNo, match.player1Id, match.player2Id ?? match.botActorId ?? "kiki");
    if (match.mode === "chain" && round.roundNo > 1 && round.picks.carryStart) return roles.endPicker === userId ? "END" : "";
    return roles.startPicker === userId ? "START" : roles.endPicker === userId ? "END" : "";
  }, [match, round, userId]);
  const pickRoles = useMemo(() => {
    if (!round || !match) return null;
    return rolesForRound(round.roundNo, match.player1Id, match.player2Id ?? match.botActorId ?? "kiki");
  }, [match, round]);
  const myPickLocked = Boolean(round && userId && (
    round.picks[userId] ||
    (match?.mode === "chain" && round.roundNo > 1 && round.picks[pickRoles?.endPicker ?? ""])
  ));
  const myPickedLetter = round && pickRoles
    ? match?.mode === "chain" && round.roundNo > 1
      ? round.picks[pickRoles.endPicker]
      : myRole === "START" ? round.picks[pickRoles.startPicker] : round.picks[pickRoles.endPicker]
    : undefined;
  const shownPickedLetter = localPickedLetter ?? myPickedLetter;

  useEffect(() => {
    if (round?.phase !== "pick" || myPickedLetter) setLocalPickedLetter(null);
  }, [round?.id, round?.phase, myPickedLetter]);

  useEffect(() => {
    if (!match || match.mode !== "bomb" || match.status === "finished" || !bomb) return;
    const botId = match.botActorId ?? "kiki";
    const turnStartedAt = match.turnStartedAt ? Date.parse(match.turnStartedAt) : now;
    const elapsed = Math.max(0, now - turnStartedAt);
    const shouldAdvance = !bomb.end
      ? bomb.passer === botId || elapsed >= BOMB.pickMs
      : bomb.holder === botId || elapsed >= match.fuseLeftMs;
    if (shouldAdvance) void send("advance");
  }, [bomb, match, now, send]);

  async function requestRematch() {
    if (!match || busy) return;
    setBusy(true);
    setMessage("");
    const db = createClient();
    if (match.vsBot) {
      const difficulty = ["easy", "medium", "hard"].includes(match.difficulty ?? "")
        ? match.difficulty!
        : "medium";
      const { data, error } = await db.rpc("linkup_create_bot_match", {
        p_mode: match.mode,
        p_difficulty: difficulty,
      });
      const nextMatchId = (data as { id?: string } | null)?.id;
      if (error || !nextMatchId) {
        setMessage("A new Kiki match could not be started. Please try again.");
        setBusy(false);
        return;
      }
      router.replace(`/games/linkup/match/${nextMatchId}`);
      return;
    }

    const { data, error } = await db.rpc("linkup_rematch", { p_match_id: match.id });
    if (error) {
      setMessage(error.message === "rematch_unavailable"
        ? "This match is not ready for a rematch."
        : "A new round could not be started.");
    } else if (data?.started) {
      setMessage("Your rematch is starting…");
    } else {
      setMessage("Waiting for your Buddy to choose another round.");
    }
    setBusy(false);
    void refresh().catch(() => setMessage("Could not refresh the rematch status."));
  }

  useEffect(() => {
    const current = match?.mode === "bomb" ? match.liveFuseLeftMs : 0;
    if (current <= 0 || current >= 10000) return;
    const seconds = Math.ceil(current / 1000);
    if (seconds === lastTickRef.current) return;
    lastTickRef.current = seconds;
    if (!reducedMotion && navigator.vibrate) navigator.vibrate(seconds <= 3 ? [45, 30, 45] : seconds <= 5 ? 45 : 25);
    if (!sound) return;
    playTone(seconds <= 5 ? 850 : 520, 0.06, "sine", seconds <= 5 ? 0.05 : 0.03);
  }, [match?.liveFuseLeftMs, match?.mode, now, playTone, reducedMotion, sound]);

  useEffect(() => {
    const currentPhase = snapshot?.round?.phase ?? null;
    if (!currentPhase || currentPhase === lastPhaseRef.current) return;
    lastPhaseRef.current = currentPhase;
    if (currentPhase === "reveal") playTone(620, 0.12, "triangle", 0.045);
    if (currentPhase === "answer") playTone(820, 0.09, "sine", 0.04);
    if (currentPhase === "result") playTone(460, 0.14, "sine", 0.05);
  }, [playTone, snapshot?.round?.phase]);

  if (!state || !match) return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.syncStatus} role="status">
          <h1>{message ? "Match connection interrupted" : "Joining the word circle…"}</h1>
          {message && <p>{message}</p>}
          <button type="button" disabled={syncInFlightRef.current} onClick={() => void refresh().catch(reportSyncFailure)}>Retry connection</button>
          <Link href="/games/linkup/solo">Back to Kiki Links</Link>
        </section>
      </div>
    </main>
  );
  if (match.mode === "bomb" && !bomb) {
    return <main className={styles.page}><p role="status">{message || "Preparing the Hot Potato round…"}</p></main>;
  }
  if (match.mode === "bomb" && bomb) {
    const fusePct = Math.max(0, Math.min(100, match.liveFuseLeftMs / BOMB.maxFuseMs * 100));
    return (
      <main className={`${styles.page} ${bomb.exploded && !reducedMotion ? styles.shake : ""} ${bombSeconds <= 3 ? styles.vignette : ""}`}>
        <div className={styles.shell}>
          <header className={styles.header}>
            <Link href="/games/linkup/solo" aria-label="Back to the Kiki Links menu"><ArrowLeft size={18} /></Link>
            <div><small>HOT POTATO</small><h1>Pass it on!</h1></div>
            <button type="button" onClick={() => setSound((enabled) => !enabled)} aria-label={sound ? "Mute" : "Unmute"}>{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          </header>
          <div className={styles.scoreRow}><span>You <b>{myScore}</b></span><span>{isBot ? "Kiki" : "Buddy"} <b>{otherScore}</b></span></div>
          {bomb.exploded ? (
            <section className={styles.boom}>
              <div className={styles.bombIcon}><Bomb size={62} /></div>
              <p>BOOM!</p><h2>{bomb.loser === userId ? "You were holding it!" : `${bomb.loser === match.botActorId ? "Kiki" : "Your Buddy"} was holding it`}</h2>
              <p>{bomb.used.length} words · longest: {Object.values(bomb.longest).filter(Boolean).sort((a, b) => b.length - a.length)[0] || "—"}</p>
              <button type="button" onClick={() => void requestRematch()} disabled={busy || Boolean(rematchRequested)}>{busy ? "Starting…" : !isBot && rematchRequested ? "Waiting for Buddy…" : "Play another round"}</button>
            </section>
          ) : (
            <>
              <div className={`${styles.bombStage} ${bombSeconds < 10 ? styles.urgent : ""}`}>
                <div className={styles.bombIcon}><Bomb size={70} /><span className={styles.spark} /></div>
                <strong>{bombSeconds}s</strong>
                <div className={styles.fuseTrack} role="progressbar" aria-label="Bomb fuse" aria-valuenow={match.liveFuseLeftMs} aria-valuemin={0} aria-valuemax={BOMB.maxFuseMs}>
                  <span style={{ width: `${fusePct}%` }} />
                </div>
                <p>{holderTurn ? "You have the bomb!" : bomb.holder === match.botActorId ? "Kiki has the bomb" : "Your Buddy has the bomb"}</p>
              </div>
              <div className={styles.letterBoard}><span>{displayLetter(bomb.start)}</span><i>…</i><span>{displayLetter(bomb.end)}</span></div>
              {endPickerTurn && <section className={styles.picker}><strong>Pick the end letter for your opponent</strong><div className={styles.letters}>{(match.availableBombEndLetters ?? []).map((letter) => <button type="button" key={letter} onClick={() => void send("bomb_end", { letter })} disabled={busy}>{letter.toUpperCase()}</button>)}</div>{(match.availableBombEndLetters ?? []).length === 0 && <p role="status">No playable end letters are available for this starting letter.</p>}<small>Fuse pauses while you pick · {Math.max(0, Math.ceil((BOMB.pickMs - (match.turnStartedAt ? now - Date.parse(match.turnStartedAt) : 0)) / 1000))}s</small></section>}
              {holderTurn && bomb.end && <form className={styles.answer} onSubmit={async (event) => { event.preventDefault(); if (await send("answer", { text: word })) setWord(""); }}>
                <label htmlFor="bomb-answer">Make a word from {displayLetter(bomb.start)} to {displayLetter(bomb.end)}</label>
                <input id="bomb-answer" value={word} onChange={(event) => setWord(event.target.value)} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={32} />
                {speechButton}
                {!speechSupported && <small>Voice input is unavailable in this browser.</small>}
                <button disabled={busy || !word.trim()}>Pass it!</button>
              </form>}
              <p className={styles.wordsUsed}>Words played: {bomb.used.length} · {bomb.used.slice(-4).join(" · ")}</p>
            </>
          )}
          {message && <p role="status" className={styles.message}>{message}</p>}
        </div>
      </main>
    );
  }

  const isFinal = match.status === "finished" || round?.phase === "finished";
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/games/linkup/solo" aria-label="Back to the Kiki Links menu"><ArrowLeft size={18} /></Link>
          <div><small>KIKI LINKS · {formatLinkupMode(match.mode).toUpperCase()}</small><h1>{isFinal ? "Lovely game!" : `Round ${round?.roundNo ?? 1}`}</h1></div>
          <button type="button" onClick={() => setHelpOpen(true)} aria-label="How to play"><Heart size={18} /></button>
        </header>
        {!isFinal && <div className={styles.scoreRow}><span>You <b>{myScore}</b></span><span>{isBot ? "Kiki" : "Buddy"} <b>{otherScore}</b></span></div>}
        {!isFinal && round && (
          <div className={styles.dots} aria-label={`Round ${round.roundNo} of ten`}>{Array.from({ length: 10 }, (_, index) => <i key={index} className={index + 1 < round.roundNo ? styles.done : index + 1 === round.roundNo ? styles.active : ""} />)}</div>
        )}
        {round?.phase === "pick" && (
          <section className={styles.picker}>
            <h2>{myPickLocked ? `Your ${myRole.toLowerCase()} pick: ${myPickedLetter?.toUpperCase()}` : localPickedLetter ? `Saving your ${myRole.toLowerCase()} pick…` : round.availableLetters.length ? `Choose the ${myRole.toLowerCase()} letter` : "Waiting for the other picker"}</h2>
            <div className={styles.pickSummary}>
              <span>START <b>{displayLetter(round.picks.carryStart ?? round.picks[pickRoles?.startPicker ?? ""])}</b></span>
              <span>END <b>{displayLetter(round.picks[pickRoles?.endPicker ?? ""])}</b></span>
            </div>
            {localPickedLetter && <p role="status" className={styles.pickConfirmed}>You selected {displayLetter(localPickedLetter)} · saving your pick</p>}
            {myRole && !myPickLocked && round.availableLetters.length > 0 && (
              <div className={styles.letters}>{LETTERS.map((letter) => (
                <button
                  type="button"
                  key={letter}
                  className={letter === shownPickedLetter ? styles.selectedLetter : ""}
                  onClick={() => {
                    if (localPickedLetter || busyRef.current) return;
                    setLocalPickedLetter(letter);
                    void send("pick", { letter, pickedAt: now }).then((saved) => {
                      if (!saved) setLocalPickedLetter(null);
                    });
                  }}
                  disabled={busy || countdown <= 0 || Boolean(localPickedLetter) || !round.availableLetters.includes(letter)}
                  aria-pressed={letter === shownPickedLetter}
                >{letter.toUpperCase()}{letter === shownPickedLetter && <Check size={15} aria-label="Selected" />}</button>
              ))}</div>
            )}
            {myPickLocked && <p className={styles.pickConfirmed}>Letter locked in. Waiting for the other pick…</p>}
            <small>{countdown > 0 ? `Auto-picks in ${countdown}s` : pickFinalizeCountdown > 0 ? `Finishing any pick already in progress · auto-pick in ${pickFinalizeCountdown}s` : "Saving the automatic pick…"}</small>
          </section>
        )}
        {round?.phase === "reveal" && currentSpec && (
          <section className={`${styles.reveal} ${currentSpec.mode === "wildcard" ? styles.reel : ""}`} aria-live="polite">
            {round.suddenDeath && <p className={styles.banner}>Sudden death!</p>}
            {round.chainBroken && <p className={styles.banner}>Chain broken!</p>}
            <div className={styles.letterBoard}><span>{displayLetter(currentSpec.start)}</span><i>…</i><span>{displayLetter(currentSpec.end)}</span></div>
            {currentSpec.mines.length > 0 && <p className={styles.mines}>💣 {currentSpec.mines.map(displayLetter).join(" · ")}</p>}
            {currentSpec.rerolled && <p className={styles.banner}>Too tough! Kiki swapped a letter.</p>}
          </section>
        )}
        {round?.phase === "answer" && currentSpec && (
          <section className={styles.answerPhase}>
            <div className={styles.letterBoard}><span>{displayLetter(currentSpec.start)}</span><i>…</i><span>{displayLetter(currentSpec.end)}</span></div>
            {wildcardBanner(currentSpec) && <p className={styles.banner}><Sparkles size={15} />{wildcardBanner(currentSpec)}</p>}
            {currentSpec.mines.map((mine) => <span key={mine} className={styles.mineChip}>💣 {displayLetter(mine)}</span>)}
            {match.mode === "chain" && <div className={styles.chain}><Link2 size={16} /> Chain {round.roundNo} / 10 <span>{history.map(displayLetter).join(" → ")}</span></div>}
            <form className={styles.answer} onSubmit={async (event) => {
              event.preventDefault();
              if (await send("answer", { text: word })) setWord("");
            }}>
              <label htmlFor="linkup-word">Type a word</label>
              <input id="linkup-word" value={word} onChange={(event) => setWord(event.target.value)} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={32} />
              {speechButton}
              {!speechSupported && <small>Voice input is unavailable in this browser.</small>}
              {mineWarning && <small className={styles.warning}>Careful — that word contains a mine letter.</small>}
              <button disabled={busy || !word.trim() || Boolean(round.ownAnswer)}>{round.ownAnswer ? "Locked in ✓" : "Lock answer"}</button>
              {isBot && !round.answers.some((answer) => answer.actor_id === match.botActorId) && <p className={styles.message}>Kiki is thinking…</p>}
              {!round.ownAnswer && round.lockedUserIds.includes(userId) && <p className={styles.message}>Answer locked in ✓</p>}
              {round.lockedUserIds.some((player) => player !== userId) && <p className={styles.message}>{isBot ? "Kiki has locked in" : "Your Buddy has locked in"}</p>}
            </form>
            <p className={styles.timer}>Time left: {countdown}s</p>
          </section>
        )}
        {round?.phase === "result" && (
          <section className={styles.result}>
            <h2>Round results</h2>
            {round.results?.map((result, resultIndex) => {
              const actorId = result.userId ?? match.botActorId ?? "kiki";
              const playerName = actorId === userId ? "You" : actorId === (match.botActorId ?? "kiki") ? "Kiki" : "Buddy";
              return <p key={`${actorId}-${resultIndex}`}>
                <strong>{playerName}</strong> · {result.valid ? result.word : result.reason === "mine" ? `Hit a mine: ${displayLetter(currentSpec?.mines.find((mine) => result.word.includes(mine)))}` : formatLinkupReason(result.reason)}
                <span className={styles.roundPoints}>{result.valid ? ` +${result.points} points` : " +0 points"}</span>
              </p>;
            })}
            {round.results?.some((result) => result.stolen > 0) && <p className={styles.banner}>Points flying across the table!</p>}
          </section>
        )}
        {isFinal && (
          <section className={`${styles.result} ${styles.finalResult}`} aria-labelledby="linkup-final-title">
            <p className={styles.finalEyebrow}>MATCH COMPLETE · {formatLinkupMode(match.mode)}</p>
            <h2 id="linkup-final-title">{myScore === otherScore ? "A tie!" : myScore > otherScore ? "You win!" : `${isBot ? "Kiki" : "Your Buddy"} wins!`}</h2>
            <div className={styles.finalScore} aria-label="Final score">
              <div><span>You</span><strong>{myScore}</strong></div>
              <i aria-hidden="true">–</i>
              <div><span>{isBot ? "Kiki" : "Buddy"}</span><strong>{otherScore}</strong></div>
            </div>
            <div className={styles.finalStats}>
              <Sparkles size={17} aria-hidden="true" />
              <p><strong>{match.usedWords?.length ?? 0}</strong> valid {match.usedWords?.length === 1 ? "word" : "words"} played</p>
            </div>
            <button className={styles.finalAction} type="button" onClick={() => void requestRematch()} disabled={busy || Boolean(rematchRequested)}>
              <span>{busy ? "Starting…" : !isBot && rematchRequested ? "Waiting for Buddy…" : "Play another round"}</span>
              {!rematchRequested && <ArrowRight size={18} aria-hidden="true" />}
            </button>
            {!isBot && rematchRequested && <p className={styles.rematchHint}>Your Buddy will need to accept before the next game starts.</p>}
          </section>
        )}
        {message && <p role="status" className={styles.message}>{message}</p>}
        {helpOpen && <div className={styles.help}><button type="button" onClick={() => setHelpOpen(false)}>Close</button><p>Choose a letter, then race to type a word that starts and ends with the revealed letters. Minefield words must avoid the displayed mine letters.</p></div>}
      </div>
    </main>
  );
}
