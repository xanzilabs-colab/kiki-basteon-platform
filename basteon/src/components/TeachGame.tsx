"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, DoorOpen, Heart, Library, ShieldAlert, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { showGameError } from "@/lib/gameFeedback";
import styles from "./TeachGame.module.css";

type Topic = { id: string; title: string; blurb: string | null; contentNote: string | null };
type SafeCard = {
  id: string;
  topicId?: string;
  problem: string;
  tip: string;
  example: string | null;
  checkQ: string;
  checkOptions: string[];
  source: string;
  helpful?: number;
};
type Session = {
  id: string;
  mode: "pair" | "bot";
  ageBand: "teen" | "adult";
  status: "waiting" | "active" | "finished" | "abandoned";
  roundNo: number;
  roundsTotal: number;
  participant: { alias: string; avatar: string; you: true };
  partner: { alias: string; avatar: string } | null;
};
type Snapshot = {
  session: Session;
  round?: {
    roundNo: number;
    phase: "write" | "read" | "done";
    topic: Topic;
    deadlineAt: string;
    ownCard: SafeCard | null;
    partnerCard: (SafeCard & { correctChoice?: never }) | null;
    ratingOnYourTip: "helpful" | "try" | "not_for_me" | null;
    myRating: "helpful" | "try" | "not_for_me" | null;
    quizCorrect: boolean | null;
  };
  progress?: { teacher_xp: number; learner_xp: number; cards_authored: number; cards_helpful: number; badges: string[] } | null;
  notice?: string | null;
};
type LibraryCard = SafeCard & { topicId: string; helpful: number };

const emptyCard = {
  problem: "",
  tip: "",
  example: "",
  checkQ: "",
  checkOptions: ["", "", ""],
  checkAnswer: 0,
};
const ratingLabels = [
  { value: "helpful", label: "Helpful" },
  { value: "try", label: "I'll try it" },
  { value: "not_for_me", label: "Not for me" },
] as const;
const cardFieldHelp: Record<string, string> = {
  problem: "describe the everyday problem",
  tip: "write a tip of at least 15 characters",
  example: "shorten the example",
  checkQ: "add a quick-check question",
  checkOptions: "make all three answer choices different and non-empty",
  checkAnswer: "choose the correct answer",
};

function cardShapeMessage(fields: unknown) {
  const labels = Array.isArray(fields)
    ? [...new Set(fields.filter((field): field is string => typeof field === "string"))]
    : [];
  const help = labels.map((field) => cardFieldHelp[field]).filter(Boolean);
  return help.length
    ? `Please ${help.join("; ")} before sharing.`
    : "Please check that every card field is complete and the three answer choices are different.";
}

function professionalAdviceMessage(categories: unknown) {
  const labels = Array.isArray(categories) ? categories : [];
  const guidance: Record<string, string> = {
    medical: "This reads like medical guidance. Please remove diagnosis, medication, or treatment instructions and share an everyday experience instead.",
    legal: "This reads like legal advice. Please avoid telling people what the law requires and share an everyday experience instead.",
    safety: "This could put someone at risk. Please remove unsafe instructions and share a safer, supportive everyday step instead.",
    financial: "This reads like financial advice. Please avoid investment or debt instructions and share a basic everyday budgeting habit instead.",
  };
  const message = labels.map((label) => typeof label === "string" ? guidance[label] : null).find(Boolean);
  return message ?? "Please keep this to an everyday experience rather than expert instructions.";
}

export function TeachGame({ mode = "bot", roomId }: { mode?: "pair" | "bot"; roomId?: string }) {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [ageBand, setAgeBand] = useState<"teen" | "adult" | "">("");
  const [category, setCategory] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [roomClosed, setRoomClosed] = useState(false);
  const [card, setCard] = useState(emptyCard);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [rating, setRating] = useState<"helpful" | "try" | "not_for_me" | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [view, setView] = useState<"play" | "library" | "toolbox">("play");
  const [library, setLibrary] = useState<LibraryCard[]>([]);
  const [libraryTopic, setLibraryTopic] = useState("");
  const [muted, setMuted] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const audioRef = useRef<AudioContext | null>(null);
  const lastSoundKeyRef = useRef("");

  const loadTopics = useCallback(async () => {
    const response = await fetch("/api/teach/topics", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Topics could not be loaded.");
    setTopics(body.topics as Topic[]);
    setAgeBand(body.needsAgeBand ? "" : body.ageBand);
  }, []);

  useEffect(() => {
    void loadTopics().catch((cause) => setError(cause instanceof Error ? cause.message : "Topics could not be loaded."));
    setMuted(localStorage.getItem("teach-muted") !== "false");
  }, [loadTopics]);

  const loadState = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/teach/state?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Your session could not be updated.");
    const next = body as Snapshot;
    setSession(next.session);
    setSnapshot(next);
    if (next.notice) setNotice(next.notice);
    if (next.session.status === "finished" || next.session.status === "abandoned") setBusy(false);
  }, []);

  useEffect(() => {
    if (!session?.id || session.status === "finished" || session.status === "abandoned") return;
    const sessionId = session.id;
    const poll = window.setInterval(() => {
      void loadState(sessionId).catch((cause) => setError(cause instanceof Error ? cause.message : "Reconnecting…"));
    }, 1000);
    return () => window.clearInterval(poll);
  }, [loadState, session?.id, session?.status]);

  useEffect(() => {
    if (!roomId || session || roomClosed) return;
    let active = true;
    const checkRoom = async () => {
      try {
        const response = await fetch(`/api/teach/room?roomId=${encodeURIComponent(roomId)}`, { cache: "no-store" });
        const body = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(body.error || "The Buddy room could not be checked.");
        if (body.closed) {
          setRoomClosed(true);
          return;
        }
        if (!body.pending) {
          const next = body as Snapshot;
          setSession(next.session);
          setSnapshot(next);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "The Buddy room could not be checked.");
      }
    };
    void checkRoom();
    const timer = window.setInterval(() => void checkRoom(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [roomClosed, roomId, session]);

  const playTone = useCallback(() => {
    if (muted) return;
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.15);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.17);
    } catch {
      setError("Sound is unavailable in this browser. You can keep playing without it.");
    }
  }, [muted]);

  useEffect(() => {
    const key = `${snapshot?.session.status ?? ""}:${snapshot?.round?.roundNo ?? ""}:${snapshot?.round?.phase ?? ""}`;
    if (!key || key === lastSoundKeyRef.current) return;
    lastSoundKeyRef.current = key;
    playTone();
    if (navigator.vibrate && snapshot?.round?.phase) navigator.vibrate(20);
  }, [playTone, snapshot?.round?.phase, snapshot?.round?.roundNo, snapshot?.session.status]);

  useEffect(() => {
    const deadline = snapshot?.round?.deadlineAt;
    if (!deadline) return;
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [snapshot?.round?.deadlineAt]);

  async function post(action: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/teach/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.error === "pii") {
        const finding = Array.isArray(body.findings) ? body.findings[0] : "personal information";
        throw new Error(`Looks like this contains ${finding}; please remove it before sharing.`);
      }
      if (body.error === "professional") {
        throw new Error(`professional_advice:${professionalAdviceMessage(body.categories)}`);
      }
      if (body.error === "self_harm") {
        setNotice(body.message || "Please pause and reach out to someone you trust. Help is available in the app.");
        setSupportUrl(body.helpUrl === "/account/guardians" ? body.helpUrl : "");
        throw new Error("supportive_message");
      }
      if (body.error === "bot_seed_unavailable") {
        throw new Error("Kiki's reviewed tip cards are not ready yet. Please try a Buddy session later.");
      }
      if (body.error === "invalid_card" || body.error === "invalid_card_shape") {
        throw new Error(cardShapeMessage(body.fields));
      }
      throw new Error(body.message || "That action could not be completed. Please try again.");
    }
    return body;
  }

  async function saveAgeBand(next: "teen" | "adult") {
    setBusy(true);
    setError("");
    try {
      await post("profile", { ageBand: next });
      setAgeBand(next);
      await loadTopics();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your age band could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function start(mode: "pair" | "bot") {
    setBusy(true);
    setError("");
    setNotice("");
    setSupportUrl("");
    try {
      if (mode === "pair" && !roomId) throw new Error("Open a Buddy room from the radar first.");
      const response = await fetch("/api/teach/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, category: category || null, roomId }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error === "age_band_required") throw new Error("Choose your age band first.");
        if (body.error === "buddy_age_group_required") throw new Error("Both players need to choose an age group before this session can start.");
        if (body.error === "buddy_age_group_mismatch") throw new Error("You and your Buddy need to be in the same age group to play.");
        if (body.error === "topic_unavailable") throw new Error("That topic is not available to both players. Choose another topic.");
        if (body.error === "bot_seed_unavailable") throw new Error("Kiki's reviewed tip cards are not ready yet. Please try a Buddy session later.");
        throw new Error(body.message || body.error || "A session could not be started.");
      }
      setSession(body.session as Session);
      await loadState(body.session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A session could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    let warning = "";
    if (session && ["waiting", "active"].includes(session.status)) {
      try {
        const response = await fetch("/api/teach/leave", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: session.id }),
        });
        if (!response.ok) warning = "The session could not be closed cleanly. You have still left this screen.";
      } catch {
        warning = "The session could not be closed cleanly. You have still left this screen.";
      }
    }
    const { error: presenceError } = await createClient().rpc("game_clear_presence");
    if (presenceError) warning = "Your nearby status could not be cleared. It will expire automatically.";
    if (roomId && !session) {
      const { error: roomError } = await createClient().rpc("game_leave_room", { p_room_id: roomId });
      if (roomError) warning = "The room could not be closed cleanly. Please return to the radar and leave it from My rooms.";
    }
    if (roomId || mode === "bot") {
      router.replace(roomId ? "/games/teach" : "/games");
      return;
    }
    setSession(null);
    setSnapshot(null);
    setCard(emptyCard);
    setError(warning);
    setNotice("");
    setView("play");
  }

  async function submitCard(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post("card", { sessionId: session.id, ...card });
      await loadState(session.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Your tip card could not be submitted.";
      if (message.startsWith("professional_advice:")) {
        const feedback = message.slice("professional_advice:".length);
        setNotice(feedback);
        showGameError("Tip needs a small edit", feedback);
      } else if (message !== "supportive_message") {
        setError(message);
        showGameError("Tip not shared", message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitRating(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !rating || quizChoice === null) return;
    setBusy(true);
    setError("");
    try {
      await post("rate", { sessionId: session.id, rating, quizChoice });
      if (navigator.vibrate) navigator.vibrate(25);
      playTone();
      await loadState(session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your rating could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function nextRound() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const result = await post("next", { sessionId: session.id });
      await loadState(session.id);
      if (result.finished) setSnapshot((current) => current ? { ...current, session: { ...current.session, status: "finished" } } : current);
      setCard(emptyCard);
      setQuizChoice(null);
      setRating("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The next round could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function report(target: "tip" | "partner") {
    if (!session || !window.confirm(target === "partner" ? "Report this partner and end the session?" : "Report this tip and end the session?")) return;
    setBusy(true);
    try {
      await post("report", { sessionId: session.id, target });
      setNotice("Thanks for letting us know. The session has ended and the tip is hidden while it is reviewed.");
      setSession((current) => current ? { ...current, status: "abandoned" } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function loadLibrary(topic = libraryTopic, toolbox = false) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(toolbox ? "/api/teach/toolbox" : `/api/teach/library${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The tip library could not be loaded.");
      setLibrary(body.cards as LibraryCard[]);
      setView(toolbox ? "toolbox" : "library");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tip library could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function toolbox(cardId: string, operation: "save" | "remove", sessionId?: string) {
    setBusy(true);
    try {
      await post("toolbox", { cardId, operation, sessionId });
      if (view === "toolbox") await loadLibrary("", true);
      else setNotice(operation === "save" ? "Saved to your private toolbox." : "Removed from your toolbox.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your toolbox could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function helpful(cardId: string) {
    try {
      await post("helpful", { cardId });
      setNotice("Thanks for marking this tip helpful.");
      await loadLibrary(libraryTopic);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That reaction could not be saved.");
    }
  }

  const toggleMute = () => {
    if (muted) {
      try {
        const context = audioRef.current ?? new AudioContext();
        audioRef.current = context;
        void context.resume().catch(() => setError("Sound is unavailable in this browser. You can keep playing without it."));
      } catch {
        setError("Sound is unavailable in this browser. You can keep playing without it.");
      }
    }
    const next = !muted;
    localStorage.setItem("teach-muted", String(next));
    setMuted(next);
  };
  const round = snapshot?.round;
  const timed = Boolean(round && (round.phase === "write" || round.phase === "read"));

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/games/teach" aria-label="Back to the Teach One radar"><ArrowLeft size={18} /></Link>
          <div><small>STOEP · PEER LEARNING</small><h1>Each One Teach One</h1></div>
          <button className={styles.quickExit} onClick={() => void leave()} type="button"><DoorOpen size={17} /> Quick exit</button>
        </header>
        <div className={styles.tools}>
          <button type="button" onClick={toggleMute} aria-pressed={muted}>{muted ? "Sound off" : "Sound on"}</button>
          <button type="button" onClick={() => void loadLibrary()} disabled={busy}><Library size={16} /> Tip Library</button>
          <button type="button" onClick={() => void loadLibrary("", true)} disabled={busy}><BookOpen size={16} /> My toolbox</button>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <aside className={styles.notice} role="status"><ShieldAlert size={18} />{notice}{supportUrl && <Link href={supportUrl}>Open your Guardian Circle</Link>}<button type="button" onClick={() => { setNotice(""); setSupportUrl(""); if (notice.includes("professional")) setError(""); }}>Dismiss</button></aside>}

        {roomClosed && !session ? (
          <section className={styles.panel}>
            <h2>This Buddy room has closed</h2>
            <p>Return to the radar to invite another Buddy.</p>
            <button type="button" onClick={() => router.replace("/games/teach")}>Back to the Teach One radar</button>
          </section>
        ) : !ageBand ? (
          <section className={styles.panel}>
            <h2>Choose your age group</h2>
            <p>We only pair people in the same age group. This is self-selected, not independently age-verified, and is not shown to a Buddy.</p>
            <div className={styles.choiceRow}>
              <button type="button" disabled={busy} onClick={() => void saveAgeBand("teen")}>Teen · 13–17</button>
              <button type="button" disabled={busy} onClick={() => void saveAgeBand("adult")}>Adult · 18+</button>
            </div>
          </section>
        ) : !session ? (
          view === "library" || view === "toolbox" ? (
            <section className={styles.panel}>
              <div className={styles.sectionTitle}><h2>{view === "library" ? "Tip Library" : "My private toolbox"}</h2><button type="button" onClick={() => setView("play")}>Back to game</button></div>
              <p className={styles.disclaimer}>Community tips are not professional advice.</p>
              {view === "library" && <label className={styles.field}>Topic
                <select value={libraryTopic} onChange={(event) => { setLibraryTopic(event.target.value); void loadLibrary(event.target.value); }}>
                  <option value="">All topics</option>
                  {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                </select>
              </label>}
              {library.map((item) => <article className={styles.tipCard} key={item.id}>
                <small>{item.source}</small><h3>{item.problem}</h3><p>{item.tip}</p>{item.example && <p><b>Example:</b> {item.example}</p>}
                {view === "library" ? <div className={styles.choiceRow}><button type="button" onClick={() => void helpful(item.id)}>Helpful · {item.helpful ?? 0}</button><button type="button" onClick={() => void toolbox(item.id, "save")}>Save to my toolbox</button></div> : <button type="button" onClick={() => void toolbox(item.id, "remove")}>Remove from toolbox</button>}
              </article>)}
              {!library.length && <p>No approved tips here yet.</p>}
            </section>
          ) : (
            <section className={styles.panel}>
              <h2>What would you like to learn about?</h2>
              {mode === "pair" && <p>Both players need to choose an age group. Once you agree on a topic, either of you can start the session.</p>}
              <p>Choose a topic or let the game pick from topics available to your age group.</p>
              <label className={styles.field}>Topic
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">Surprise me</option>
                  {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                </select>
              </label>
              {topics.find((topic) => topic.id === category)?.contentNote && <p className={styles.note}>{topics.find((topic) => topic.id === category)?.contentNote}</p>}
              <div className={styles.choiceRow}>
                {mode === "pair"
                  ? <button type="button" disabled={busy || !roomId} onClick={() => void start("pair")}><Heart size={17} /> Start with this Buddy</button>
                  : <button type="button" disabled={busy} onClick={() => void start("bot")}><Sparkles size={17} /> Play with Kiki</button>}
              </div>
              {mode === "pair" && <p className={styles.privacy}>Your invitation was accepted in the Buddy radar. Your exact location is never shown in the game.</p>}
              <p className={styles.disclaimer}>Community tips are not professional advice. Don't include names or personal details in your card.</p>
            </section>
          )
        ) : (
          <section className={styles.panel} aria-live="polite">
            <div className={styles.partners}>
              <div><span>{session.participant.avatar}</span><strong>{session.participant.alias} · You</strong></div>
              {session.partner && <div><span>{session.partner.avatar}</span><strong>{session.partner.alias}</strong></div>}
            </div>
            {session.status === "waiting" && <div className={styles.waiting}>
              <div className={styles.spinner} aria-hidden="true" /><h2>Finding a nearby Buddy…</h2>
              <p>We’re looking for someone in the same age group and topic. Kiki will join if nobody is found in 20 seconds.</p>
              <button type="button" onClick={() => void leave()}>Take a break</button>
            </div>}
            {session.status === "active" && round && <>
              <div className={styles.roundHeading}><small>ROUND {round.roundNo} OF 3</small><h2>{round.topic.title}</h2>{timed && <span className={styles.timer}>⏱ {secondsLeft}s</span>}</div>
              {round.topic.contentNote && <p className={styles.note}>{round.topic.contentNote}</p>}
              {round.phase === "write" && !round.ownCard && <form className={styles.form} onSubmit={(event) => void submitCard(event)}>
                <p className={styles.hint}>What helps most? Share a small everyday tip, not personal information or professional advice.</p>
                <label>Problem (what it helps with)
                  <textarea maxLength={120} value={card.problem} onChange={(event) => setCard({ ...card, problem: event.target.value })} required />
                  <small>{card.problem.length}/120</small>
                </label>
                <label>My tip
                  <textarea maxLength={400} value={card.tip} onChange={(event) => setCard({ ...card, tip: event.target.value })} required />
                  <small>{card.tip.length}/400</small>
                </label>
                <label>One example <span>(optional)</span>
                  <textarea maxLength={240} value={card.example} onChange={(event) => setCard({ ...card, example: event.target.value })} />
                  <small>{card.example.length}/240</small>
                </label>
                <label>Quick check question
                  <input maxLength={140} value={card.checkQ} onChange={(event) => setCard({ ...card, checkQ: event.target.value })} required />
                </label>
                <fieldset><legend>Three possible answers · select the correct one</legend>
                  {card.checkOptions.map((option, index) => <div className={styles.optionRow} key={index}>
                    <input aria-label={`Answer option ${index + 1}`} maxLength={80} value={option} onChange={(event) => {
                      const options = [...card.checkOptions];
                      options[index] = event.target.value;
                      setCard({ ...card, checkOptions: options });
                    }} required />
                    <label><input type="radio" name="checkAnswer" checked={card.checkAnswer === index} onChange={() => setCard({ ...card, checkAnswer: index })} /> Correct</label>
                  </div>)}
                </fieldset>
                <p className={styles.privacy}>We scan this card for personal details and unsafe advice before anyone else can see it.</p>
                <button type="submit" disabled={busy}>{busy ? "Checking your card…" : "Share tip card"}</button>
                <div className={styles.actionRow}><button type="button" className={styles.subtle} disabled={busy} onClick={() => {
                  setBusy(true);
                  void post("skip", { sessionId: session.id })
                    .then(() => loadState(session.id))
                    .catch((cause) => setError(cause instanceof Error ? cause.message : "This topic could not be skipped."))
                    .finally(() => setBusy(false));
                }}>Skip this topic</button><button type="button" className={styles.subtle} onClick={() => void leave()}>Take a break</button></div>
              </form>}
              {round.phase === "write" && round.ownCard && <div className={styles.waiting}><p>Your card is with your Buddy now. We’ll show their tip as soon as both cards are ready.</p><div className={styles.spinner} aria-hidden="true" /></div>}
              {round.phase === "read" && round.partnerCard && !round.myRating && <form className={styles.form} onSubmit={(event) => void submitRating(event)}>
                <article className={styles.tipCard}>
                  <small>{round.partnerCard.source}</small><h3>{round.partnerCard.problem}</h3><p>{round.partnerCard.tip}</p>
                  {round.partnerCard.example && <p><b>Example:</b> {round.partnerCard.example}</p>}
                  <p className={styles.disclaimer}>Community tips are not professional advice.</p>
                  <button type="button" className={styles.report} onClick={() => void report("tip")}><ShieldAlert size={16} /> Report this tip</button>
                </article>
                <fieldset><legend>{round.partnerCard.checkQ}</legend>
                  {round.partnerCard.checkOptions.map((option, index) => <label className={styles.radioChoice} key={index}>
                    <input type="radio" name="quizChoice" checked={quizChoice === index} onChange={() => setQuizChoice(index)} />
                    {option}
                  </label>)}
                </fieldset>
                <fieldset><legend>How does this tip feel for you?</legend>
                  {ratingLabels.map((choice) => <label className={styles.radioChoice} key={choice.value}>
                    <input type="radio" name="rating" checked={rating === choice.value} onChange={() => setRating(choice.value)} />
                    {choice.label}
                  </label>)}
                </fieldset>
                <div className={styles.actionRow}><button type="submit" disabled={busy || quizChoice === null || !rating}>Send my response</button><button className={styles.subtle} type="button" onClick={() => void report("partner")}><ShieldAlert size={16} /> Report this partner</button></div>
              </form>}
              {round.phase === "read" && round.myRating && <div className={styles.waiting}><h3>Response saved</h3><p>Your quick check was {round.quizCorrect ? "right" : "not quite"}; thanks for being thoughtful.</p></div>}
              {(round.phase === "done" || round.phase === "read" && Boolean(round.ratingOnYourTip)) && <div className={styles.feedback}>
                {round.ratingOnYourTip && <p><Sparkles size={18} /> {round.ratingOnYourTip === "helpful" ? "Your tip helped someone!" : "Your tip was received."} <span>{ratingLabels.find((item) => item.value === round.ratingOnYourTip)?.label}</span></p>}
                {round.phase === "done" && <button type="button" disabled={busy} onClick={() => void nextRound()}>{round.roundNo >= 3 ? "See my progress" : "Next round"}</button>}
              </div>}
            </>}
            {session.status === "finished" && <div className={styles.final}>
              <h2>You taught and learned. That’s enough.</h2>
              <p>No winners or losers — just useful things shared kindly.</p>
              <div className={styles.scoreRow}><p>Teacher XP <strong>{snapshot?.progress?.teacher_xp ?? 0}</strong></p><p>Learner XP <strong>{snapshot?.progress?.learner_xp ?? 0}</strong></p></div>
              <p>{snapshot?.progress?.cards_authored ?? 0} tips shared · {snapshot?.progress?.cards_helpful ?? 0} helpful ratings</p>
              {!!snapshot?.progress?.badges?.length && <p>Badges: {snapshot.progress.badges.join(" · ")}</p>}
              {round?.partnerCard && <button type="button" onClick={() => void toolbox(round.partnerCard!.id, "save", session.id)}>Add a good tip to my toolbox</button>}
              <button type="button" onClick={() => router.replace("/games/teach")}>Back to the Teach One radar</button>
            </div>}
            {session.status === "abandoned" && <div className={styles.final}><h2>Session ended</h2><p>{notice || "You can take a break or try again whenever you like."}</p><button type="button" onClick={() => router.replace("/games/teach")}>Back to the Teach One radar</button></div>}
          </section>
        )}
        <footer className={styles.footer}>Kind tips, shared anonymously. No cash rewards. Your details stay private.</footer>
      </div>
    </main>
  );
}
