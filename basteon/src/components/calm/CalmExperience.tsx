"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, CircleHelp, Pause, Play, RotateCcw, Wind, X } from "lucide-react";
import { CalmSession, CalmSettings, DEFAULT_CALM_SETTINGS, fetchCalmHistory, fetchCalmSettings, saveCalmSession } from "./CalmSettings";
import { CalmShell, usePersistentMute, useReducedMotion } from "./CalmShell";
import styles from "./calm.module.css";
import { answerPhaseIndex, effectivePhases, PATTERNS, PHASE_LABEL, questionPhaseIndex, tickAt } from "@/lib/calm/breath/engine";
import { playPhaseTone, unlockCalmAudio } from "@/lib/calm/audio";
import { vibratePhase } from "@/lib/calm/haptics";
import { cycleIntensity, INTENSITY_LABEL, suggestBreathing, summarize, tipsFor, ZONES, type Intensity, type ZoneId, type ZoneMap } from "@/lib/calm/body/zones";
import { applyChange, buildQuestions, changeAnswer, CHANGE_OPTIONS, generateScene, LEVELS, mulberry32, nextLevel, sessionSummary, type Level, type Question, type Scene } from "@/lib/calm/baseline/engine";

type Tool = "winds" | "baseline" | "body";
type Trivia = { id: string; question: string; options: string[]; answer: number; fact: string };
type Props = { tool: Tool };

function ratingLabel(value: number) {
  return ["", "Very low", "Low", "Okay", "Good", "Very good"][value];
}
function Rating({ value, onChange, label }: { value: number | null; onChange: (value: number) => void; label: string }) {
  return <fieldset className={styles.rating}><legend>{label}</legend><div>{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className={value === n ? styles.ratingActive : ""} onClick={() => onChange(n)} aria-pressed={value === n} aria-label={`${n} of 5, ${ratingLabel(n)}`}>{n}</button>)}</div><button type="button" className={styles.skip} onClick={() => onChange(0)}>Skip</button></fieldset>;
}

export function CalmExperience({ tool }: Props) {
  const [muted, setMuted] = usePersistentMute();
  const reducedMotion = useReducedMotion();
  const [settings, setSettings] = useState<CalmSettings>(DEFAULT_CALM_SETTINGS);
  const [history, setHistory] = useState<CalmSession[]>([]);
  const [trivia, setTrivia] = useState<Trivia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [triviaNotice, setTriviaNotice] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const stopAction = useRef<() => void>(() => window.location.assign("/account/calm"));
  const registerStop = useCallback((action: () => void) => { stopAction.current = action; }, []);
  const stopCurrentTool = useCallback(() => stopAction.current(), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loadedSettings = await fetchCalmSettings();
        if (!active) return;
        setSettings(loadedSettings);
        if (loadedSettings.saveHistory) {
          const rows = await fetchCalmHistory();
          if (active) setHistory(rows);
        }
        if (tool === "winds") {
          try {
            const response = await fetch("/api/calm/trivia?n=3", { cache: "no-store" });
            if (response.ok) {
              const rows = await response.json() as Trivia[];
              if (active) setTrivia(rows);
            } else if (active) setTriviaNotice("Trivia could not load, but breathing is still ready.");
          } catch {
            if (active) setTriviaNotice("Trivia could not load, but breathing is still ready.");
          }
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Couldn't load Calm.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [tool]);

  const save = useCallback(async (payload: Record<string, unknown>) => {
    setSavedMessage("");
    try {
      const result = await saveCalmSession(payload);
      if (result.saved) {
        setSavedMessage("Saved privately to your Calm history.");
        if (settings.saveHistory) setHistory(await fetchCalmHistory());
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save this session.");
    }
  }, [settings.saveHistory]);

  const heading = tool === "winds" ? "Gentle Winds" : tool === "baseline" ? "Spot the Baseline" : "Body Check";

  return (
    <CalmShell title={heading} running onStop={stopCurrentTool} muted={muted} onMuteChange={setMuted}>
      {loading ? <p className={styles.loading} role="status">Preparing your calm space…</p> : error ? <div className={styles.error} role="alert">{error}</div> : <>
        {tool === "winds" && <Winds settings={settings} muted={muted} reducedMotion={reducedMotion} trivia={trivia} triviaNotice={triviaNotice} save={save} savedMessage={savedMessage} registerStop={registerStop} />}
        {tool === "baseline" && <Baseline settings={settings} setSettings={setSettings} history={history} save={save} savedMessage={savedMessage} registerStop={registerStop} />}
        {tool === "body" && <BodyCheck settings={settings} history={history} save={save} savedMessage={savedMessage} registerStop={registerStop} />}
      </>}
    </CalmShell>
  );
}

export function CalmHub() {
  const [muted, setMuted] = usePersistentMute();
  return (
    <CalmShell title="A quiet place" onStop={() => window.location.assign("/account")} muted={muted} onMuteChange={setMuted}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>A little space for yourself</p>
        <h1>Choose what feels right.</h1>
        <p>Gentle, optional exercises for breathing, noticing, and checking in with yourself.</p>
      </section>
      <div className={styles.toolGrid}>
        <ToolCard href="/account/calm/winds" icon="◌" title="Gentle Winds" rule="Follow a soft breathing rhythm, with a quiet eyes-closed option." length="About 1–2 minutes" />
        <ToolCard href="/account/calm/baseline" icon="⌕" title="Spot the Baseline" rule="Notice a calm everyday scene and what is in it." length="About 1–2 minutes" />
        <ToolCard href="/account/calm/body" icon="♡" title="Body Check" rule="Map how different parts of your body feel, without judgement." length="Take your time" />
      </div>
      <p className={styles.disclaimerCard}>These are calming exercises, not medical advice. You can stop at any time.</p>
      <Link className={styles.textLink} href="/account/calm/settings">Calm settings and privacy <ChevronRight size={16} /></Link>
      <HelpSheet />
    </CalmShell>
  );
}

function ToolCard({ href, icon, title, rule, length }: { href: string; icon: string; title: string; rule: string; length: string }) {
  return <Link className={styles.toolCard} href={href}><span className={styles.toolIcon} aria-hidden="true">{icon}</span><b>{title}</b><span>{rule}</span><small>{length}</small><ArrowRight size={18} className={styles.cardArrow} /></Link>;
}

function HelpSheet({ tool }: { tool?: Tool } = {}) {
  const [open, setOpen] = useState(false);
  const copy = tool === "winds"
    ? { title: "How to use Gentle Winds", steps: [["Choose a pattern.", "Wind shows a breathing circle; Quiet offers eyes-closed pacing."], ["Follow the cue.", "Breathe in and out comfortably. Holds are optional."], ["Stop whenever.", "A trivia fact may appear in Wind mode. There is no score."]], example: "inhale → exhale" }
    : tool === "baseline"
      ? { title: "How to play Spot the Baseline", steps: [["Look around.", "Notice a friendly café or station scene at your own pace."], ["Choose what you remember.", "Questions are gentle prompts, not a test."], ["Look again.", "See the scene and take away what you noticed."]], example: "look → notice → reveal" }
      : tool === "body"
        ? { title: "How to use Body Check", steps: [["Choose a starting rating.", "This is optional; skip it if you prefer."], ["Tap or select body areas.", "Each tap cycles through four gentle intensity descriptions."], ["Choose a supportive next step.", "Tips and the encrypted journal note are always optional."]], example: "notice → name → care" }
        : { title: "How Calm tools work", steps: [["Pick what suits you.", "Breathing, noticing, or a body check are all optional."], ["Go at your own pace.", "Skip ratings, adjust settings, or stop whenever you want."], ["Your notes stay yours.", "Calm history is off by default. Journal notes use your encrypted journal."]], example: "inhale → exhale" };
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open]);
  return <><button type="button" className={styles.secondaryButton} onClick={() => setOpen(true)}><CircleHelp size={16} /> {tool ? "How to play" : "How this space works"}</button>
    {open && <div className={styles.scrim} role="presentation" onClick={() => setOpen(false)}><section className={styles.sheet} role="dialog" aria-modal="true" aria-label={copy.title} onClick={(event) => event.stopPropagation()}><button className={styles.closeButton} onClick={() => setOpen(false)} aria-label="Close"><X size={19} /></button><p className={styles.eyebrow}>A gentle guide</p><h2>{copy.title}</h2><ol className={styles.steps}>{copy.steps.map(([heading, detail]) => <li key={heading}><b>{heading}</b><span>{detail}</span></li>)}</ol><div className={styles.example}><span className={styles.exampleCircle}>{copy.example}</span><span>No rush. Pause or stop whenever you like.</span></div></section></div>}</>;
}

function Winds({ settings, muted, reducedMotion, trivia, triviaNotice, save, savedMessage, registerStop }: { settings: CalmSettings; muted: boolean; reducedMotion: boolean; trivia: Trivia[]; triviaNotice: string; save: (payload: Record<string, unknown>) => Promise<void>; savedMessage: string; registerStop: (action: () => void) => void }) {
  const [mode, setMode] = useState<"wind" | "quiet">("wind");
  const [patternId, setPatternId] = useState<keyof typeof PATTERNS>("slow");
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [welcomeBack, setWelcomeBack] = useState(false);
  const [vibrationUnsupported, setVibrationUnsupported] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [factCount, setFactCount] = useState(0);
  const [cycleTrivia, setCycleTrivia] = useState<Trivia | null>(null);
  const startAt = useRef(0);
  const elapsedRef = useRef(0);
  const lastPhase = useRef("");
  const seenTrivia = useRef(new Set<string>());
  const saved = useRef(false);
  const started = useRef(false);
  const completed = useRef(false);
  const phases = useMemo(() => effectivePhases(PATTERNS[patternId], settings.breathHolds, settings.breathPace), [patternId, settings.breathHolds, settings.breathPace]);
  const pattern = PATTERNS[patternId];
  const tick = tickAt(phases, pattern.cycles, elapsed);
  const qIndex = questionPhaseIndex(phases);
  const aIndex = answerPhaseIndex(phases);

  const persist = useCallback(async (completed: boolean, afterRating = after) => {
    if (saved.current) return;
    saved.current = true;
    await save({ tool: "winds", mode, durationSeconds: Math.min(3600, Math.floor(elapsedRef.current / 1000)), completed, ratingBefore: before, ratingAfter: afterRating, payload: { pattern: patternId, factCount } });
  }, [after, before, factCount, mode, patternId, save]);

  useEffect(() => {
    if (!running || welcomeBack) return;
    let frame = 0;
    const update = () => {
      const current = elapsedRef.current + performance.now() - startAt.current;
      setElapsed(current);
      if (current >= pattern.cycles * phases.reduce((sum, phase) => sum + phase.ms, 0)) {
        elapsedRef.current = current;
        completed.current = true;
        setRunning(false);
        setFinished(true);
        return;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [phases, pattern.cycles, running, welcomeBack]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "quiet") setMode("quiet");
  }, []);

  useEffect(() => {
    const visibility = () => {
      if (!running) return;
      if (document.hidden) {
        navigator.vibrate?.(0);
        elapsedRef.current += performance.now() - startAt.current;
        setElapsed(elapsedRef.current);
        setRunning(false);
        setWelcomeBack(true);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [running]);

  useEffect(() => {
    if (!running || mode !== "quiet" || !("wakeLock" in navigator)) return;
    let active = true;
    let lock: { release: () => Promise<void> } | null = null;
    void (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen")
      .then((value) => { if (active) lock = value; else void value.release(); })
      .catch(() => undefined);
    return () => { active = false; if (lock) void lock.release(); };
  }, [mode, running]);

  useEffect(() => {
    if (!running) return;
    const key = `${tick.cycle}:${tick.phaseIndex}`;
    if (lastPhase.current === key || tick.done) return;
    lastPhase.current = key;
    const phase = phases[tick.phaseIndex];
    if (mode === "quiet") {
      const supported = settings.haptics && vibratePhase(phase.kind, phase.ms);
      if (!supported) setVibrationUnsupported(settings.haptics);
      if ((!settings.haptics || !supported) && settings.sound && !muted) playPhaseTone(phase.kind);
    }
    if (tick.phaseIndex === qIndex && trivia.length) {
      const available = trivia.filter((item) => !seenTrivia.current.has(item.id));
      const pool = available.length ? available : trivia;
      const next = pool[Math.floor(Math.random() * pool.length)];
      seenTrivia.current.add(next.id);
      setCycleTrivia(next);
      setSelectedOption(null);
    }
    if (tick.phaseIndex === aIndex && cycleTrivia) setFactCount((count) => count + 1);
  }, [aIndex, cycleTrivia, mode, muted, phases, qIndex, running, settings.haptics, settings.sound, tick, trivia]);

  function start() {
    elapsedRef.current = 0;
    startAt.current = performance.now();
    lastPhase.current = "";
    setElapsed(0);
    setFinished(false);
    setWelcomeBack(false);
    setRunning(true);
    saved.current = false;
    started.current = true;
    completed.current = false;
    seenTrivia.current.clear();
    setFactCount(0);
    setCycleTrivia(null);
    setSelectedOption(null);
    setVibrationUnsupported(false);
    if (mode === "quiet" && settings.sound && !muted) unlockCalmAudio();
  }

  const stop = useCallback(() => {
    if (!started.current) { window.location.assign("/account/calm"); return; }
    if (typeof navigator !== "undefined") navigator.vibrate?.(0);
    if (running) elapsedRef.current += performance.now() - startAt.current;
    setRunning(false);
    setFinished(true);
    completed.current = false;
  }, [running]);

  useEffect(() => { registerStop(stop); }, [registerStop, stop]);
  const complete = useCallback(async () => {
    await persist(completed.current, after);
    started.current = false;
  }, [after, persist]);
  const restart = useCallback(async () => {
    await persist(completed.current, after);
    started.current = false;
    start();
  }, [after, persist]);

  const quizVisible = Boolean(cycleTrivia && (tick.phaseIndex === qIndex || tick.phaseIndex === aIndex));
  const factVisible = Boolean(cycleTrivia && tick.phaseIndex === aIndex);
  if (finished) return <section className={styles.card}><p className={styles.eyebrow}>A gentle pause</p><h1>That&apos;s okay. You did well.</h1><p>{pattern.title} · {Math.floor(elapsed / 1000)} seconds</p><Rating value={after} onChange={(value) => setAfter(value || null)} label="How do you feel now? (optional)" /><div className={styles.buttonRow}><button className={styles.primaryButton} onClick={() => void complete()}><Check size={17} /> Done</button><button className={styles.secondaryButton} onClick={() => void restart()}><RotateCcw size={17} /> One more round</button></div><Link className={styles.textLink} href="/account/calm">Calm home <ArrowRight size={16} /></Link>{savedMessage && <p className={styles.success} role="status">{savedMessage}</p>}</section>;
  return <section className={`${styles.windStage} ${mode === "quiet" ? styles.quietStage : ""}`} data-reduced-motion={reducedMotion}>
    {!running && !welcomeBack ? <>
      <p className={styles.eyebrow}>Choose your pace</p><h1>Make a little room to breathe.</h1>
      <div className={styles.choiceRow} role="group" aria-label="Breathing mode"><button className={mode === "wind" ? styles.choiceActive : ""} onClick={() => setMode("wind")} aria-pressed={mode === "wind"}>Wind · visual</button><button className={mode === "quiet" ? styles.choiceActive : ""} onClick={() => setMode("quiet")} aria-pressed={mode === "quiet"}>Quiet · eyes closed</button></div>
      <label className={styles.formLabel}>Breathing pattern<select value={patternId} onChange={(event) => setPatternId(event.target.value as keyof typeof PATTERNS)}>{Object.values(PATTERNS).map((value) => <option value={value.id} key={value.id}>{value.title}</option>)}</select></label>
      <p className={styles.smallNote}>{pattern.blurb}</p>
      <label className={styles.formLabel}>Pace<select value={settings.breathPace} disabled><option value="gentle">Gentle · adjust in Calm settings</option><option value="standard">Standard · adjust in Calm settings</option></select></label>
      <p className={styles.smallNote}>{settings.breathHolds ? "Optional holds are on." : "Holds are off; you can change this in settings."}</p>
      <Rating value={before} onChange={(value) => setBefore(value || null)} label="How do you feel right now? (optional)" />
      <HelpSheet tool="winds" />
      <button className={styles.primaryButton} onClick={start}><Wind size={18} /> Begin gently</button>
      {triviaNotice && mode === "wind" && <p className={styles.smallNote} role="status">{triviaNotice}</p>}
      {!trivia.length && !triviaNotice && mode === "wind" && <p className={styles.smallNote}>Breathing is ready. Reviewed trivia cards will appear here when available.</p>}
    </> : welcomeBack ? <div className={styles.card}><p className={styles.eyebrow}>Welcome back</p><h1>Ready when you are.</h1><p>Your breathing rhythm paused while you were away.</p><button className={styles.primaryButton} onClick={() => { startAt.current = performance.now(); setWelcomeBack(false); setRunning(true); }}><Play size={18} /> Continue</button><button className={styles.secondaryButton} onClick={stop}><Pause size={16} /> Stop gently</button></div> : <>
      <p className={styles.phaseLabel} aria-live="polite">{PHASE_LABEL[tick.kind]}</p>
      <div className={styles.breathRing} style={{ "--breath-size": tick.size } as React.CSSProperties} aria-hidden="true"><span>{mode === "quiet" ? "" : PHASE_LABEL[tick.kind]}</span></div>
      <p className={styles.countdown} aria-label={`About ${Math.max(0, Math.ceil(tick.msLeftInPhase / 1000))} seconds in this phase`}>{Math.max(0, Math.ceil(tick.msLeftInPhase / 1000))}</p>
      {vibrationUnsupported && mode === "quiet" && <p className={styles.smallNote} role="status">Vibration is not available here. If sound is on, a soft tone will guide each phase.</p>}
      {quizVisible && cycleTrivia && <aside className={styles.triviaCard}><b>{cycleTrivia.question}</b>{tick.phaseIndex === qIndex && cycleTrivia.options.map((option, index) => <button key={option} className={selectedOption === index ? styles.choiceActive : ""} aria-pressed={selectedOption === index} onClick={() => setSelectedOption(index)}>{option}</button>)}{factVisible && <p>{selectedOption === null ? "Here's a fun one." : selectedOption === cycleTrivia.answer ? "Nice guess!" : "Here's a fun one."} {cycleTrivia.fact}</p>}</aside>}
      <button className={styles.stopLarge} onClick={stop}><Pause size={18} /> Stop gently</button>
    </>}
  </section>;
}

function Baseline({ settings, setSettings, history, save, savedMessage, registerStop }: { settings: CalmSettings; setSettings: (settings: CalmSettings) => void; history: CalmSession[]; save: (payload: Record<string, unknown>) => Promise<void>; savedMessage: string; registerStop: (action: () => void) => void }) {
  const [level, setLevel] = useState<Level>(settings.baselineLevel);
  const [phase, setPhase] = useState<"intro" | "study" | "question" | "reveal" | "change-study" | "change-question" | "done">("intro");
  const [scene, setScene] = useState<Scene | null>(null);
  const [changedScene, setChangedScene] = useState<Scene | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [studyLeft, setStudyLeft] = useState(0);
  const [ratingBefore, setRatingBefore] = useState<number | null>(null);
  const [ratingAfter, setRatingAfter] = useState<number | null>(null);
  const startedAt = useRef(0);
  const saved = useRef(false);
  const resultsRef = useRef<boolean[]>([]);
  const updateLevel = useCallback(async (newLevel: Level) => {
    if (newLevel === settings.baselineLevel) return;
    const next = { ...settings, baselineLevel: newLevel };
    try {
      const response = await fetch("/api/calm/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error("Couldn't update your saved level.");
      setSettings(next);
      setLevel(newLevel);
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : "Couldn't update your saved level.");
    }
  }, [setSettings, settings]);

  useEffect(() => {
    if (phase !== "study" && phase !== "change-study") return;
    setStudyLeft(LEVELS[level].studyMs);
    const started = Date.now();
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, LEVELS[level].studyMs - (Date.now() - started));
      setStudyLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(interval);
        if (phase === "study") setPhase("question");
        else setPhase("change-question");
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [level, phase]);

  useEffect(() => {
    if (phase !== "reveal") return;
    const timer = window.setTimeout(() => {
      setChosen(null);
      setFeedback("");
      if (questionIndex + 1 >= questions.length) setPhase("done");
      else {
        setQuestionIndex((index) => index + 1);
        setPhase(questions[questionIndex + 1]?.kind === "change" ? "change-study" : "question");
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [phase, questionIndex, questions]);
  useEffect(() => { resultsRef.current = results; }, [results]);

  const summary = sessionSummary(results);
  const baselineSessions = history.filter((entry) =>
    entry.tool === "baseline" && entry.completed && Number(entry.payload.level) === level && Number(entry.payload.total) > 0,
  );
  const progress = settings.saveHistory && phase === "done"
    ? nextLevel(level, [...baselineSessions.slice(0, 1).map((entry) => Number(entry.payload.total) > 0 ? Math.round(Number(entry.payload.correct) / Number(entry.payload.total) * 100) : 0), summary.pct])
    : level;

  function begin(daily = false) {
    const date = new Date();
    const todaySeed = Number(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`);
    const nextSeed = daily ? todaySeed : Math.floor(Math.random() * 0xffffffff);
    const nextScene = generateScene(nextSeed, level);
    const rng = mulberry32(nextSeed ^ 0x51f15e);
    const built = buildQuestions(nextScene, level, rng);
    if (level >= 2) {
      const change = applyChange(nextScene, mulberry32(nextSeed ^ 0xa12ce));
      built.push({ id: "change", kind: "change", text: "What changed in the scene?", options: CHANGE_OPTIONS, answer: changeAnswer(change.kind) });
      setChangedScene(change.scene);
    } else {
      setChangedScene(null);
    }
    setScene(nextScene);
    setQuestions(built);
    setQuestionIndex(0);
    setResults([]);
    setChosen(null);
    setFeedback("");
    setPhase("study");
    startedAt.current = Date.now();
    saved.current = false;
  }

  async function selectLevel(value: Level) {
    setLevel(value);
    const updated = { ...settings, baselineLevel: value };
    try {
      const response = await fetch("/api/calm/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
      if (!response.ok) throw new Error("Couldn't save your baseline level.");
      setSettings(updated);
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : "Couldn't save your baseline level.");
    }
  }

  function answer(index: number) {
    if (chosen !== null) return;
    const question = questions[questionIndex];
    const correct = index === question.answer;
    setChosen(index);
    setResults((current) => [...current, correct]);
    const rightText = question.kind === "change" ? CHANGE_OPTIONS[question.answer] : question.options[question.answer];
    setFeedback(correct ? "Nice noticing." : `No worries. It was ${rightText}.`);
    if (question.kind === "change") setScene(changedScene);
    setPhase("reveal");
  }

  async function finish() {
    if (saved.current) return;
    saved.current = true;
    const nextLevel = progress;
    if (nextLevel > level) void updateLevel(nextLevel);
    await save({
      tool: "baseline", mode: "attention",
      durationSeconds: Math.min(3600, Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000))),
      completed: true, ratingBefore, ratingAfter,
      payload: { level, correct: summary.correct, total: summary.total },
    });
  }

  const stop = useCallback(() => {
    if (phase === "done" && !saved.current) {
      void finish().finally(() => window.location.assign("/account/calm"));
    } else if (phase !== "intro" && !saved.current) {
      saved.current = true;
      setPhase("intro");
      void save({
        tool: "baseline", mode: "attention",
        durationSeconds: Math.min(3600, Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000))),
        completed: false, ratingBefore, ratingAfter: null,
        payload: { level, correct: resultsRef.current.filter(Boolean).length, total: resultsRef.current.length },
      }).finally(() => window.location.assign("/account/calm"));
    } else window.location.assign("/account/calm");
  }, [finish, level, phase, ratingBefore, save]);
  useEffect(() => { registerStop(stop); }, [registerStop, stop]);

  const question = questions[questionIndex];
  return <section className={styles.card}>
    {phase === "intro" && <>
      <p className={styles.eyebrow}>A gentle noticing game</p><h1>Spot the Baseline</h1><p className={styles.lede}>Notice what is normal. This is a calm attention game, not a test.</p>
      <label className={styles.formLabel}>Level<select value={level} onChange={(event) => void selectLevel(Number(event.target.value) as Level)}><option value={1}>Level 1 · Easy</option><option value={2}>Level 2 · Steady</option><option value={3}>Level 3 · Detailed</option></select></label>
      {feedback && <p className={styles.error} role="alert">{feedback}</p>}
      {!settings.saveHistory && <p className={styles.smallNote}>Enable Calm history if you&apos;d like gentle level progression between sessions. If you turn it off later, existing history stays private until you delete it.</p>}
      <Rating value={ratingBefore} onChange={(value) => setRatingBefore(value || null)} label="How do you feel before? (optional)" />
      <HelpSheet tool="baseline" />
      <div className={styles.buttonRow}><button className={styles.primaryButton} onClick={() => begin(false)}><Play size={17} /> Start a scene</button><button className={styles.secondaryButton} onClick={() => begin(true)}>Today&apos;s scene</button></div>
    </>}
    {(phase === "study" || phase === "change-study") && scene && <><p className={styles.eyebrow}>{phase === "change-study" ? "Take another look" : "Take your time"}</p><h2>{phase === "change-study" ? "Notice the scene again" : "Look around the scene"}</h2><p className={styles.smallNote}>No rush. Notice whatever stands out to you.</p><BaselineScene scene={phase === "change-study" ? scene : scene} /><div className={styles.progressTrack}><span style={{ width: `${Math.max(0, (1 - studyLeft / LEVELS[level].studyMs) * 100)}%` }} /></div><button className={styles.primaryButton} onClick={() => setPhase(phase === "study" ? "question" : "change-question")}>I&apos;m ready <ChevronRight size={17} /></button></>}
    {(phase === "question" || phase === "change-question") && question && <><p className={styles.eyebrow}>Question {questionIndex + 1} of {questions.length}</p><h2>{question.text}</h2>{phase === "change-question" && changedScene && <BaselineScene scene={changedScene} />}{phase === "question" && <div className={styles.optionGrid}>{question.options.map((option, index) => <button key={`${question.id}-${option}`} className={styles.answerButton} onClick={() => answer(index)}>{option}</button>)}</div>}{phase === "change-question" && <div className={styles.optionGrid}>{question.options.map((option, index) => <button key={`${question.id}-${option}`} className={styles.answerButton} onClick={() => answer(index)}>{option}</button>)}</div>}</>}
    {phase === "reveal" && <div className={styles.reveal}><Check size={24} /><h2>{feedback}</h2><p>The scene will stay here for a moment if you&apos;d like to look again.</p>{scene && <BaselineScene scene={scene} />}</div>}
    {phase === "done" && <><p className={styles.eyebrow}>A moment of noticing</p><h1>You noticed {summary.correct} of {summary.total} things.</h1><p className={styles.lede}>Knowing what is normal makes anything unusual easier to spot, calmly.</p><Rating value={ratingAfter} onChange={(value) => setRatingAfter(value || null)} label="How do you feel now? (optional)" /><button className={styles.primaryButton} onClick={() => void finish()}><Check size={17} /> Finish</button>{progress > level && <p className={styles.success}>You&apos;re ready for Level {progress}. Nicely done.</p>}<button className={styles.secondaryButton} onClick={() => { setPhase("intro"); setLevel(settings.baselineLevel); }}>One more scene</button>{savedMessage && <p className={styles.success} role="status">{savedMessage}</p>}</>}
  </section>;
}

function BaselineScene({ scene }: { scene: Scene }) {
  const colorMap: Record<string, string> = { red: "#d67478", blue: "#7198c8", green: "#73a98d", yellow: "#d9b65c", orange: "#d58a58", grey: "#88909a" };
  const itemGlyph: Record<string, string> = { bag: "▣", umbrella: "☂", phone: "▯", coffee: "☕", none: "" };
  return <svg className={styles.scene} viewBox="0 0 800 480" role="img" aria-label="Friendly illustrated everyday scene">
    <rect x="25" y="25" width="750" height="430" rx="28" fill="#f5eddf" stroke="#d8c7ae" strokeWidth="4" />
    <rect x="75" y="75" width="230" height="145" rx="15" fill="#dbeaf2" stroke="#fff" strokeWidth="8" />
    <path d="M190 76v144M76 148h228" stroke="#fff" strokeWidth="8" />
    <rect x="600" y="86" width="95" height="145" rx="16" fill="#c99b71" /><circle cx="675" cy="160" r="7" fill="#815f43" />
    <rect x="355" y="258" width="270" height="30" rx="15" fill="#c9a781" /><path d="M380 288v92m218-92v92" stroke="#987758" strokeWidth="12" strokeLinecap="round" />
    <rect x="90" y="365" width="90" height="75" rx="14" fill="#b88f6b" /><rect x="625" y="360" width="74" height="80" rx="12" fill="#83a78f" />
    {scene.exits.map((exit, index) => <g key={exit.id} transform={`translate(${95 + index * 220} 55)`}><rect width="92" height="34" rx="17" fill="#fff" /><text x="46" y="23" textAnchor="middle" fontSize="14" fill="#522868">↗ {exit.label}</text></g>)}
    {scene.people.map((person) => <g key={person.id} transform={`translate(${60 + person.x * 6.8} ${80 + person.y * 5.1})`} aria-label={`${person.color} top, ${person.item === "none" ? "no item" : person.item}`}>
      <circle cy="-30" r="17" fill="#d7a989" /><path d={person.pose === "sitting" ? "M-18 -8h36v28h-36zM-12 18l-12 20m36-20 12 20" : "M-18 -8h36v45h-36zM-12 37l-7 26m31-26 7 26"} fill={colorMap[person.color]} stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      {itemGlyph[person.item] && <text x="14" y="-6" fontSize="18" fill="#522868">{itemGlyph[person.item]}</text>}
    </g>)}
  </svg>;
}

function BodyCheck({ settings, history, save, savedMessage, registerStop }: { settings: CalmSettings; history: CalmSession[]; save: (payload: Record<string, unknown>) => Promise<void>; savedMessage: string; registerStop: (action: () => void) => void }) {
  const [zones, setZones] = useState<ZoneMap>({});
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [phase, setPhase] = useState<"checkin" | "map" | "done">("checkin");
  const [startedAt, setStartedAt] = useState(0);
  const [listView, setListView] = useState(false);
  const saved = useRef(false);
  const zonesRef = useRef<ZoneMap>({});
  const beforeRef = useRef<number | null>(null);
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { beforeRef.current = before; }, [before]);
  const trends = summarize(history.filter((entry) => entry.tool === "body").map((entry) => ({
    at: entry.started_at,
    zones: ((entry.payload.zones ?? {}) as ZoneMap),
    before: entry.rating_before,
    after: entry.rating_after,
  })));
  const tips = tipsFor(zones);

  function change(id: ZoneId) {
    setZones((current) => ({ ...current, [id]: cycleIntensity(current[id]) }));
  }

  async function finish() {
    if (saved.current) return;
    saved.current = true;
    await save({
      tool: "body", mode: "check", durationSeconds: Math.min(3600, Math.floor((Date.now() - startedAt) / 1000)),
      completed: true, ratingBefore: before, ratingAfter: after,
      payload: { zones },
    });
  }

  const stop = useCallback(() => {
    if (phase === "done" && !saved.current) {
      void finish().finally(() => window.location.assign("/account/calm"));
    } else if (phase === "map" && startedAt > 0 && !saved.current) {
      saved.current = true;
      setPhase("checkin");
      void save({
        tool: "body", mode: "check", durationSeconds: Math.min(3600, Math.floor((Date.now() - startedAt) / 1000)),
        completed: false, ratingBefore: beforeRef.current, ratingAfter: null,
        payload: { zones: zonesRef.current },
      }).finally(() => window.location.assign("/account/calm"));
    } else window.location.assign("/account/calm");
  }, [finish, phase, save, startedAt]);
  useEffect(() => { registerStop(stop); }, [registerStop, stop]);

  return <section className={styles.card}>
    {phase === "checkin" && <><p className={styles.eyebrow}>A gentle check-in</p><h1>Body Check</h1><p className={styles.lede}>Notice how different places feel, without needing to change anything.</p><Rating value={before} onChange={(value) => setBefore(value || null)} label="How are you feeling? (optional)" /><HelpSheet tool="body" /><button className={styles.primaryButton} onClick={() => { setStartedAt(Date.now()); setPhase("map"); saved.current = false; }}>Begin body check <ChevronRight size={17} /></button></>}
    {phase === "map" && <><p className={styles.eyebrow}>Tap an area to check in</p><h1>What do you notice?</h1><p className={styles.smallNote}>Each tap moves from Nothing to A little, Quite a bit, A lot, then back to Nothing.</p><div className={styles.mapToggle}><button className={!listView ? styles.choiceActive : ""} onClick={() => setListView(false)}>Body map</button><button className={listView ? styles.choiceActive : ""} onClick={() => setListView(true)}>List view</button></div>{listView ? <div className={styles.zoneList}>{ZONES.map((zone) => <ZoneButton key={zone.id} zone={zone} value={zones[zone.id] ?? 0} onClick={() => change(zone.id)} />)}</div> : <BodyMap zones={zones} onChange={change} />}<button className={styles.primaryButton} onClick={() => setPhase("done")}>Done <Check size={17} /></button></>}
    {phase === "done" && <><p className={styles.eyebrow}>A little care, if you want it</p><h1>What might feel supportive?</h1>{tips.length ? <div className={styles.tipGrid}>{tips.map((zone) => <article className={styles.tipCard} key={zone.id}><b>{zone.label}</b><p>{zone.tip}</p></article>)}</div> : <p className={styles.lede}>You noticed what you noticed. That is enough.</p>}{suggestBreathing(zones) && <Link className={styles.secondaryButton} href="/account/calm/winds"><Wind size={17} /> Try Gentle Winds</Link>}<p className={styles.medicalNote}>If a sensation worries you, speak to a health professional.</p><div className={styles.privateNote}><b>Add a private note</b><p>It stays locked like the rest of your journal; calm does not store the note.</p><Link className={styles.textLink} href="/w?template=gut-check">Open the encrypted “Gut check” journal template <ArrowRight size={15} /></Link></div><Rating value={after} onChange={(value) => setAfter(value || null)} label="How do you feel now? (optional)" /><button className={styles.primaryButton} onClick={() => void finish()}><Check size={17} /> Finish</button>{settings.saveHistory && trends.count > 0 && <section className={styles.trends}><h2>Your gentle trends</h2><p>Patterns only, never a diagnosis.</p>{trends.top.map((item) => <p key={item.id}>{ZONES.find((zone) => zone.id === item.id)?.label}: noticed in {item.n} sessions</p>)}{trends.helpedPct !== null && <p>In {trends.helpedPct}% of rated sessions, your after-rating was higher.</p>}</section>}{savedMessage && <p className={styles.success} role="status">{savedMessage}</p>}<button className={styles.secondaryButton} onClick={() => { setZones({}); setBefore(null); setAfter(null); setPhase("checkin"); }}>Start another check-in</button></>}
  </section>;
}

function ZoneButton({ zone, value, onClick }: { zone: typeof ZONES[number]; value: Intensity; onClick: () => void }) {
  return <button type="button" className={styles.zoneButton} onClick={onClick} aria-label={`${zone.label}: ${INTENSITY_LABEL[value]}. Tap to change.`}><span>{zone.label}</span><b>{INTENSITY_LABEL[value]}</b><small>{value} of 3</small></button>;
}

function BodyMap({ zones, onChange }: { zones: ZoneMap; onChange: (id: ZoneId) => void }) {
  const points: Record<ZoneId, [number, number]> = { jaw: [150, 60], neck: [150, 95], shoulders: [100, 125], chest: [150, 145], stomach: [150, 195], back: [200, 160], hands: [55, 230], legs: [150, 285], feet: [150, 370] };
  return <div className={styles.bodyMap}>
    <svg viewBox="0 0 300 420" role="img" aria-label="Tap the labelled circles on the body map, or use the list view">
      <path d="M150 35c-24 0-36 18-36 38v18c-26 8-47 23-54 51l-24 84c-4 14 18 24 25 9l31-69 5 74-13 99c-2 19 24 23 28 4l17-87 21 0 17 87c4 19 30 15 28-4l-13-99 5-74 31 69c7 15 29 5 25-9l-24-84c-7-28-28-43-54-51V73c0-20-12-38-35-38Z" fill="#eadff1" stroke="#9b76af" strokeWidth="4" strokeLinejoin="round" />
      {ZONES.map((zone) => {
        const [x, y] = points[zone.id];
        const intensity = zones[zone.id] ?? 0;
        return <g key={zone.id} role="button" tabIndex={0} aria-label={`${zone.label}: ${INTENSITY_LABEL[intensity]}. Tap to change.`} onClick={() => onChange(zone.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChange(zone.id); } }} className={styles.mapPoint}>
          <circle cx={x} cy={y} r="27" fill={intensity ? `rgba(117, 75, 145, ${0.15 + intensity * 0.14})` : "#fff"} stroke="#68437e" strokeWidth="2" />
          <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fill="#3e2850">{zone.label}</text>
          {[0, 1, 2].map((dot) => <circle key={dot} cx={x - 7 + dot * 7} cy={y + 17} r="2" fill={dot < intensity ? "#68437e" : "#d7c9df"} />)}
        </g>;
      })}
    </svg>
  </div>;
}
