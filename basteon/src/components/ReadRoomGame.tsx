"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Flag, Heart, Lightbulb, LoaderCircle, Sparkles, UsersRound } from "lucide-react";
import { showGameError } from "@/lib/gameFeedback";
import styles from "./ReadRoomGame.module.css";

type Session = {
  id: string;
  mode: "pair" | "bot";
  status: "active" | "finished" | "abandoned";
  ageBand: "teen" | "adult";
  roundNo: number;
  roundsTotal: number;
  participant: { alias: string; avatar: string; you?: boolean };
  partner: { alias: string; avatar: string } | null;
};
type Round = {
  phase: "answer" | "reveal" | "done";
  prompt: string;
  contentNote: string;
  emotionOptions: string[];
  responseOptions: string[];
  ownEmotion: number | null;
  ownResponse: number | null;
  partnerEmotion: number | null;
  partnerResponse: number | null;
  ownReady: boolean;
  partnerReady: boolean;
};
type Snapshot = {
  session: Session | null;
  round: Round | null;
  ageBand?: "teen" | "adult" | null;
  roomReady?: boolean;
  canStart?: boolean;
  advance?: { waiting: boolean };
};

export function ReadRoomGame({ roomId }: { roomId?: string }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [emotion, setEmotion] = useState<number | null>(null);
  const [response, setResponse] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reportReason, setReportReason] = useState("uncomfortable");
  const [reporting, setReporting] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const roundKeyRef = useRef("");
  const snapshotRef = useRef<Snapshot | null>(null);

  const applySnapshot = useCallback((next: Snapshot, resetSelections = false) => {
    const current = snapshotRef.current;
    if (!resetSelections && current?.session?.status === "active") {
      if (!next.session || next.session.id !== current.session.id) return;
      if (next.session.roundNo < current.session.roundNo) return;
      if (next.session.roundNo === current.session.roundNo) {
        const phaseOrder = { answer: 0, reveal: 1, done: 2 };
        const currentPhase = current.round?.phase;
        const nextPhase = next.round?.phase;
        if (currentPhase && nextPhase && phaseOrder[nextPhase] < phaseOrder[currentPhase]) return;
      }
    }
    const roundKey = `${next.session?.id ?? ""}:${next.session?.roundNo ?? ""}:${next.round?.phase ?? ""}`;
    const hasSavedChoices = next.round?.ownEmotion !== null && next.round?.ownEmotion !== undefined
      || next.round?.ownResponse !== null && next.round?.ownResponse !== undefined;
    if (resetSelections || roundKeyRef.current !== roundKey || hasSavedChoices) {
      setEmotion(next.round?.ownEmotion ?? null);
      setResponse(next.round?.ownResponse ?? null);
    }
    roundKeyRef.current = roundKey;
    sessionIdRef.current = next.session?.id ?? null;
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const request = useCallback(async (action: string, body?: unknown) => {
    const stateQuery = roomId
      ? `?roomId=${encodeURIComponent(roomId)}`
      : action === "state" && sessionIdRef.current
        ? `?sessionId=${encodeURIComponent(sessionIdRef.current)}`
        : "";
    const result = await fetch(body === undefined
      ? `/api/read-room/${action}${stateQuery}`
      : `/api/read-room/${action}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = await result.json().catch(() => null) as (Snapshot & { error?: string }) | null;
    if (result.status === 401) {
      router.replace("/login");
      throw new Error("Sign in to play Read the Room.");
    }
    if (!result.ok) {
      const messages: Record<string, string> = {
        age_band_required: "Choose your age group to continue.",
        buddy_age_group_required: "Both players need to choose an age group before starting.",
        buddy_age_group_mismatch: "You and your Buddy need to be in the same age group to play.",
        room_not_ready: "Wait for your Buddy to accept the invitation first.",
        host_starts_game: "The room host will start the game in a moment.",
        age_band_locked: "Your age group cannot be changed during an active game.",
        action_unavailable: action === "start"
          ? "We couldn't start the game just now. Your setup is saved—please try again."
          : "We couldn't update the game just now. Please try again in a moment.",
      };
      throw new Error(data?.error ? messages[data.error] ?? "That action could not be completed." : "That action could not be completed.");
    }
    return data ?? {};
  }, [roomId, router]);

  const refresh = useCallback(async () => {
    const next = await request("state") as Snapshot;
    applySnapshot(next);
  }, [applySnapshot, request]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await request("state") as Snapshot;
        if (active) {
          applySnapshot(next);
          setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Read the Room could not load.");
      }
    };
    void load();
    const poll = window.setInterval(() => { void load(); }, 2500);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [applySnapshot, request]);

  async function saveAgeBand(ageBand: "teen" | "adult") {
    setBusy(true);
    setError("");
    try {
      await request("profile", { ageBand });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your age group could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      const next = await request("start", roomId ? { mode: "pair", roomId } : { mode: "bot" }) as Snapshot;
      applySnapshot(next, true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The game could not start. Please try again.";
      setError(message);
      showGameError("Game didn't start", message);
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer() {
    if (!snapshot?.session || emotion === null || response === null) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("answer", { sessionId: snapshot.session.id, emotion, response }) as Snapshot;
      applySnapshot(next, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your choices could not be saved.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function nextRound() {
    if (!snapshot?.session) return;
    setBusy(true);
    setError("");
    try {
      const next = await request("next", { sessionId: snapshot.session.id }) as Snapshot;
      applySnapshot(next, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The next round could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (snapshot?.session && snapshot.session.status === "active") {
      setBusy(true);
      try {
        await request("leave", { sessionId: snapshot.session.id });
      } catch {
        setError("The game could not be closed cleanly. You can still return to the Stoep.");
        return;
      } finally {
        setBusy(false);
      }
    }
    router.push(roomId ? "/games/read-room" : "/games");
  }

  async function reportPartner() {
    if (!snapshot?.session) return;
    setReporting(true);
    setError("");
    try {
      await request("report", { sessionId: snapshot.session.id, reason: reportReason });
      router.push("/games/read-room");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your report could not be sent.");
    } finally {
      setReporting(false);
    }
  }

  const session = snapshot?.session;
  const round = snapshot?.round;
  const submitted = round?.ownEmotion !== null && round?.ownEmotion !== undefined;
  const title = roomId ? "Read the Room · with a Buddy" : "Read the Room · with Kiki";

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href={roomId ? "/games/read-room" : "/games"} aria-label="Back"><ArrowLeft size={20} /></Link>
          <div><small>STOEP · GENTLE PERSPECTIVES</small><h1>{title}</h1></div>
          <button type="button" className={styles.exit} onClick={() => void leave()}>Leave</button>
        </header>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {!snapshot && !error && <section className={styles.panel}><LoaderCircle className={styles.spinner} /> Loading your game…</section>}

        {snapshot && !session && !snapshot.ageBand && (
          <section className={styles.panel}>
            <span className={styles.eyebrow}><Heart size={15} /> A gentle perspective game</span>
            <h2>First, choose your age group.</h2>
            <p>This helps keep games with nearby Buddies age-appropriate. Your exact age is not requested.</p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => void saveAgeBand("teen")}>13–17</button>
              <button type="button" disabled={busy} onClick={() => void saveAgeBand("adult")}>18+</button>
            </div>
          </section>
        )}

        {snapshot && !session && snapshot.ageBand && (
          <section className={styles.panel}>
            <span className={styles.eyebrow}><Sparkles size={15} /> Three rounds · no right answers</span>
            <h2>{roomId ? "Take a moment to read the room." : "How might someone feel?"}</h2>
            <p>Read a fictional everyday moment, choose a feeling that could fit, then pick a kind next step. Compare your perspectives—different answers are welcome.</p>
            {roomId ? snapshot.canStart
              ? <button type="button" className={styles.primary} disabled={busy || !snapshot.roomReady} onClick={() => void start()}>{busy ? "Starting…" : "Start together"}</button>
              : <div className={styles.waiting}><UsersRound size={20} /><span>Waiting for the host to start. You’ll join the same round automatically.</span></div>
              : <button type="button" className={styles.primary} disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Play with Kiki"}</button>}
            {roomId && !snapshot.roomReady && <p className={styles.softNote}>Both Buddies need to accept the invitation before the game begins.</p>}
          </section>
        )}

        {session?.status === "abandoned" && (
          <section className={styles.panel}><h2>This game has ended.</h2><p>Return to the radar to find another Buddy.</p><Link className={styles.primaryLink} href="/games/read-room">Back to Read the Room</Link></section>
        )}

        {session?.status === "finished" && (
          <section className={`${styles.panel} ${styles.finished}`}>
            <span className={styles.celebration}><Sparkles size={30} /></span>
            <p className={styles.eyebrow}>THREE ROUNDS COMPLETE</p>
            <h2>Thanks for looking from another angle.</h2>
            <p>There’s no score and no single right way to read a moment. Listening with curiosity is the win.</p>
            <div className={styles.actions}>
              <Link href="/games/read-room">Find another Buddy</Link>
              <Link href="/games/read-room/kiki">Play again with Kiki</Link>
            </div>
          </section>
        )}

        {session?.status === "active" && round && (
          <>
            <div className={styles.players} aria-label="Players">
              <div className={styles.you}><span>{session.participant.avatar}</span><strong>{session.participant.alias}</strong><small>You</small></div>
              <span className={styles.perspectives}>↔</span>
              <div><span>{session.partner?.avatar}</span><strong>{session.partner?.alias}</strong><small>{session.mode === "bot" ? "AI companion" : "Buddy"}</small></div>
            </div>
            <section className={styles.panel}>
              <div className={styles.roundTop}><span>ROUND {session.roundNo} OF {session.roundsTotal}</span><span><Lightbulb size={15} />{round.contentNote}</span></div>
              <h2 className={styles.prompt}>{round.prompt}</h2>
              {round.phase === "answer" && (
                submitted
                  ? <div className={styles.waiting}><LoaderCircle className={styles.spinner} /><span>Your choices are in. Waiting for {session.partner?.alias}…</span></div>
                  : <div className={styles.choices}>
                    <fieldset>
                      <legend>What might someone in this moment feel?</legend>
                      <div className={styles.options}>
                        {round.emotionOptions.map((option, index) => (
                          <button key={option} type="button" className={emotion === index ? styles.selected : ""} aria-pressed={emotion === index} onClick={() => setEmotion(index)}>{option}</button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>What could be a supportive next step?</legend>
                      <div className={styles.responseOptions}>
                        {round.responseOptions.map((option, index) => (
                          <button key={option} type="button" className={response === index ? styles.selected : ""} aria-pressed={response === index} onClick={() => setResponse(index)}>{option}</button>
                        ))}
                      </div>
                    </fieldset>
                    <button type="button" className={styles.primary} disabled={busy || emotion === null || response === null} onClick={() => void submitAnswer()}>{busy ? "Saving…" : "Lock in my choices"}</button>
                  </div>
              )}
              {round.phase !== "answer" && (
                <div className={styles.reveal}>
                  <p className={styles.comparison}>{round.ownEmotion === round.partnerEmotion ? "You saw a similar feeling." : "You noticed different possibilities."}</p>
                  <div className={styles.picks}>
                    <article><small>{session.participant.alias} · you</small><strong>{round.emotionOptions[round.ownEmotion ?? 0]}</strong><p>{round.responseOptions[round.ownResponse ?? 0]}</p></article>
                    <article><small>{session.partner?.alias}</small><strong>{round.emotionOptions[round.partnerEmotion ?? 0]}</strong><p>{round.responseOptions[round.partnerResponse ?? 0]}</p></article>
                  </div>
                  <p className={styles.invitation}>Ask with curiosity. Different perspectives are a chance to learn, not a test.</p>
                  {!round.ownReady
                    ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void nextRound()}>{busy ? "One moment…" : session.roundNo === session.roundsTotal ? "Finish together" : "Ready for the next moment"}</button>
                    : <div className={styles.waiting}><Check size={19} /><span>You’re ready. Waiting for {session.partner?.alias}…</span></div>}
                  {session.mode === "pair" && <div className={styles.reportBox}>
                    <label>Need help with this interaction?
                      <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                        <option value="uncomfortable">I felt uncomfortable</option>
                        <option value="inappropriate">Something inappropriate happened</option>
                        <option value="other">Something else</option>
                      </select>
                    </label>
                    <button type="button" onClick={() => void reportPartner()} disabled={reporting}><Flag size={15} />{reporting ? "Sending…" : "Report & leave"}</button>
                  </div>}
                </div>
              )}
            </section>
          </>
        )}

        <footer className={styles.footer}>Fictional situations, private choices, and room for more than one perspective.</footer>
      </div>
    </main>
  );
}
