"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, BedDouble, Car, ChevronRight, Compass, CookingPot, Ear, Eye, Flower2, GraduationCap, Hand, HeartHandshake,
  Library, Send, ShieldX, Sofa, Sparkles, Trees, Wind, X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentType, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { askAi } from "@/lib/stoep/ai";
import {
  applyAnswer, buildGuesses, describeMove, guessText, matchesGuess, needsPerson, newRound, nextMove, questionsAsked,
  reaction, same, scoreSense, type Guess, type Move, type Round, type SenseResult,
} from "@/lib/stoep/engine";
import { SETTINGS, type SenseKey, type SettingId } from "@/lib/stoep/knowledge";
import styles from "./stoep.module.css"; // scene, top bar, person link (unchanged)
import g from "./Stoepplay.module.css"; // new game UI

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;
type Mood = "idle" | "think" | "happy" | "puzzled";
type Mode = "hub" | "name" | "setting" | "guess" | "results" | "clues";
type Items = Record<SenseKey, string[]>;

const ICONS: Record<string, Icon> = { BedDouble, Sofa, CookingPot, Library, GraduationCap, Car, Trees, Compass };
const SENSES: { key: SenseKey; count: number; icon: Icon; glow: string; ask: string; imagine: string; ph: string; noun: string }[] = [
  { key: "see", count: 5, icon: Eye, glow: "#ffd98a", noun: "see", ph: "blue mug", ask: "Look around. Type 5 things you can see.", imagine: "Picture a calm place. Type 5 things you can see there." },
  { key: "feel", count: 4, icon: Hand, glow: "#ffa6bd", noun: "feel", ph: "soft blanket", ask: "What can you feel? Type 4 things: your feet, your clothes, whatever you're touching.", imagine: "In your calm place, type 4 things you can feel." },
  { key: "hear", count: 3, icon: Ear, glow: "#8fd6ff", noun: "hear", ph: "a distant dog", ask: "Listen closely. Type 3 things you can hear.", imagine: "In your calm place, type 3 things you can hear." },
  { key: "smell", count: 2, icon: Wind, glow: "#a6f0c4", noun: "smell", ph: "fresh laundry", ask: "Type 2 things you can smell. Can't smell anything? Imagine one.", imagine: "In your calm place, type 2 things you can smell." },
  { key: "taste", count: 1, icon: Flower2, glow: "#ffb98a", noun: "taste", ph: "mint tea", ask: "Type 1 thing you can taste. A memory or a favourite is fine.", imagine: "Type 1 taste you'd have in your calm place." },
];
const empty = (): Items => ({ see: [], feel: [], hear: [], smell: [], taste: [] });

/* ---------------- Kiki the hummingbird (logo, in 3D) ---------------- */
type Look = { x: number; y: number };
const VB = "-10 -10 447 298";
const BIRD = "M157 278V140C157 60 190 0 270 0H427C360 8 315 50 312 120C308 200 250 278 157 278Z";
const WING = "M0 0H157V139A157 139 0 0 1 0 0Z";
const CX = 157, CY = 139, RX = 153, RY = 139;
function band(ro: number, ri: number) {
  const xo = CX - RX * ro, yo = CY + RY * ro;
  if (ri === 0) return `M${xo} ${CY}A${RX * ro} ${RY * ro} 0 0 0 ${CX} ${yo}L${CX} ${CY}Z`;
  const xi = CX - RX * ri, yi = CY + RY * ri;
  return `M${xo} ${CY}A${RX * ro} ${RY * ro} 0 0 0 ${CX} ${yo}L${CX} ${yi}A${RX * ri} ${RY * ri} 0 0 1 ${xi} ${CY}Z`;
}
const RINGS = [
  { d: band(1, 0.72), fill: "#b999d0", z: -6 },
  { d: band(0.64, 0.36), fill: "#c57fb4", z: -3 },
  { d: band(0.28, 0), fill: "#d27ab0", z: 0 },
];

function Layer({ z, s, cls, dim, children }: { z: number; s: number; cls?: string; dim?: number; children: ReactNode }) {
  return (
    <div className={`${g.layer} ${cls ?? ""}`} style={{ transform: `translateZ(${(z * s) / 100}px)` }}>
      <svg viewBox={VB} style={dim ? { filter: `brightness(${dim})` } : undefined}>{children}</svg>
    </div>
  );
}
const slabs = (key: string, d: string, fill: string, zs: number[], s: number, cls?: string) =>
  zs.map((z, i) => (
    <Layer key={key + i} z={z} s={s} cls={cls} dim={i === 0 ? undefined : Math.max(0.45, 0.85 - i * 0.08)}>
      <path d={d} fill={fill} />
    </Layer>
  ));

function Kiki({ mood = "idle", size = 84, look, follow = true }: { mood?: Mood; size?: number; look?: Look; follow?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const cur = useRef({ x: 0, y: 0 });
  const ptr = useRef<{ x: number; y: number; t: number } | null>(null);
  const moodRef = useRef(mood);
  const lookRef = useRef(look);
  const gid = useId().replace(/:/g, "");
  moodRef.current = mood;
  lookRef.current = look;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const onMove = (event: PointerEvent) => {
      ptr.current = { x: event.clientX, y: event.clientY, t: performance.now() };
    };
    if (follow) window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    const tick = (now: number) => {
      const time = now / 1000;
      const currentMood = moodRef.current;
      let targetX = 0, targetY = 0;
      if (lookRef.current) {
        targetX = Math.max(-1, Math.min(1, lookRef.current.x));
        targetY = Math.max(-1, Math.min(1, lookRef.current.y));
      } else if (currentMood === "think") {
        targetX = 0.7;
        targetY = -0.8;
      } else if (currentMood === "puzzled") {
        targetX = Math.sin(time * 2.2) * 0.9;
        targetY = 0.25;
      } else if (ptr.current && now - ptr.current.t < 5000) {
        const rect = el.getBoundingClientRect();
        const dx = ptr.current.x - (rect.left + rect.width / 2);
        const dy = ptr.current.y - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        const strength = Math.min(1, distance / 220);
        targetX = (dx / distance) * strength;
        targetY = (dy / distance) * strength;
      } else {
        targetX = Math.sin(time * 0.6) * 0.55;
        targetY = Math.sin(time * 0.43) * 0.25;
      }
      if (calm) { targetX = 0; targetY = 0; }

      cur.current.x += (targetX - cur.current.x) * 0.08;
      cur.current.y += (targetY - cur.current.y) * 0.08;
      el.style.setProperty("--lx", cur.current.x.toFixed(3));
      el.style.setProperty("--ly", cur.current.y.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [follow]);

  return (
    <div
      ref={root}
      className={`${g.kiki} ${g[mood]}`}
      style={{ width: size, height: (size * 298) / 447, "--persp": `${size * 6}px` } as CSSProperties}
      aria-hidden="true"
    >
      <div className={g.glow} />
      <div className={g.shadow} />
      <div className={g.stage}>
        <div className={g.spin}>
          <div className={g.rig}>
            <div className={g.wingRig}>{slabs("w", WING, "#ec8ab5", [-12, -14.5, -17], size)}</div>
            <div className={g.ringRig}>
              {RINGS.map((ring, index) => slabs(`r${index}`, ring.d, ring.fill, [ring.z, ring.z - 2.5], size, `${g.ring} ${g[`r${index}`]}`))}
            </div>
            <div className={g.head}>
              {slabs("b", BIRD, "#6b45a3", [9, 6, 3, 0, -3, -6, -9], size)}
              <Layer z={9.5} s={size}>
                <defs>
                  <radialGradient id={gid} cx="230" cy="40" r="210" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#fff" stopOpacity=".3" />
                    <stop offset="1" stopColor="#fff" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <path d={BIRD} fill={`url(#${gid})`} />
              </Layer>
              <Layer z={10} s={size} cls={g.blink}><circle cx="269" cy="63" r="19" fill="#fff" /></Layer>
              <Layer z={10.6} s={size} cls={`${g.blink} ${g.pupil}`}><circle cx="269" cy="63" r="10" fill="#2d1650" /></Layer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Main ---------------- */
export function StoepGame() {
  const router = useRouter();
  const search = useSearchParams();
  const [mode, setMode] = useState<Mode>("hub");
  const [level, setLevel] = useState(0);
  const [imagine, setImagine] = useState(() => search.get("assist") === "garden");
  const [discreet, setDiscreet] = useState(() => search.get("mode") === "quick");
  const [night, setNight] = useState(false);
  const [items, setItems] = useState<Items>(empty);
  const [guesses, setGuesses] = useState<Record<SenseKey, Guess[]> | null>(null);
  const [results, setResults] = useState<Partial<Record<SenseKey, SenseResult>>>({});
  const [care, setCare] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = new Date().getHours();
    setNight(h >= 18 || h < 6);
  }, []);
  useEffect(() => {
    setDiscreet(search.get("mode") === "quick");
    setImagine(search.get("assist") === "garden");
  }, [search]);

  const closeQuickly = () => router.replace("/account");
  const glow = mode === "name" ? SENSES[Math.min(level, 4)].glow : "#ffd98a";
  const skyLevel = mode === "results" ? 5 : mode === "guess" ? 3 : mode === "setting" ? 4 : level;

  async function pickSetting(id: SettingId | "other", text = "") {
    setBusy(true);
    let extra: Partial<Record<SenseKey, string[]>> | undefined;
    if (id === "other" && text) {
      const ai = await askAi<Partial<Record<SenseKey, string[]>>>({ task: "predict", setting: text, night });
      if (ai) { extra = ai; setAiUsed(true); }
    }
    setGuesses(buildGuesses(id, night, extra));
    setResults({});
    setBusy(false);
    setMode("guess");
  }

  function restart() {
    setItems(empty());
    setGuesses(null);
    setResults({});
    setLevel(0);
    setMode("hub");
  }

  return (
    <main
      className={`${styles.page} ${styles[`lv${skyLevel}`]} ${discreet ? styles.discreet : ""}`}
      style={{ "--glow": glow } as CSSProperties}
    >
      <div className={styles.scene} aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((n) => <div key={n} className={`${styles.sky_} ${styles[`sky${n}`]}`} />)}
        <div className={styles.sun} /><div className={styles.moon} />
        <div className={styles.stars}>
          {Array.from({ length: 44 }, (_, i) => (
            <span key={i} style={{ left: `${(i * 37 + 11) % 100}%`, top: `${(i * 23 + 5) % 58}%`, width: 1 + (i % 3), height: 1 + (i % 3), animationDelay: `${(i % 7) * 0.6}s` }} />
          ))}
        </div>
        <svg className={styles.hills} viewBox="0 0 400 220" preserveAspectRatio="none">
          <path d="M0 120 Q80 70 170 110 T400 90 V220 H0Z" className={styles.hillFar} />
          <path d="M0 160 Q110 110 210 150 T400 135 V220 H0Z" className={styles.hillNear} />
        </svg>
        <div className={styles.flies}>
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} style={{ left: `${(i * 61 + 7) % 100}%`, top: `${42 + ((i * 17) % 48)}%`, animationDelay: `${(i % 6) * -1.7}s`, animationDuration: `${8 + (i % 5) * 2}s` }} />
          ))}
        </div>
      </div>
      <header className={`${styles.top} ${mode === "hub" ? g.hubTopBar : ""}`}>
        <button
          aria-label={mode === "hub" ? "Back" : "Menu"}
          onClick={() => (mode === "hub" ? router.back() : restart())}
        >
          <ArrowLeft size={16} />
          <span>{mode === "hub" ? "Back" : "Menu"}</span>
        </button>
        <button
          aria-label={discreet ? "Discreet mode on" : "Discreet mode"}
          aria-pressed={discreet}
          onClick={() => setDiscreet(!discreet)}
        >
          <ShieldX size={16} />
          <span>{discreet ? "Discreet is on" : "Discreet mode"}</span>
        </button>
        <button aria-label="Quick close" onClick={closeQuickly}>
          <X size={16} />
          <span>Quick close</span>
        </button>
      </header>

      {care && (
        <div className={g.care} role="status">
          <p>It sounds like things might be hard or unsafe right now. You don&apos;t have to do this alone.</p>
          <Link href="/account/guardians">Reach a person</Link>
          <button onClick={() => setCare(false)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      {mode === "hub" && (
        <section className={`${g.panel} ${g.hubMenu}`}>
          <div className={g.hubHero}>
            <Kiki mood="idle" size={112} />
            <h1 className={g.title}>Hi, I&apos;m Kiki.</h1>
            <p className={g.hubSub}>Help me see your world.</p>
          </div>

          <button
            type="button"
            className={g.hubCalmChip}
            aria-pressed={imagine}
            onClick={() => setImagine((value) => !value)}
          >
            <Wind size={18} />
            <span>Can&apos;t look around</span>
            <span className={g.hubSwitch} aria-hidden="true" />
          </button>

          <div className={g.hubCards}>
            <button className={g.hubCard} onClick={() => { setItems(empty()); setLevel(0); setMode("name"); }}>
              <span className={g.hubOrb}><Eye size={30} /></span>
              <strong>Name it</strong>
              <small>I guess</small>
              <span className={g.hubGo}><ChevronRight size={16} /></span>
            </button>
            <button className={`${g.hubCard} ${g.hubCardGold}`} onClick={() => { setLevel(0); setMode("clues"); }}>
              <span className={g.hubOrb}><Sparkles size={30} /></span>
              <strong>Be my eyes</strong>
              <small>You hint</small>
              <span className={g.hubGo}><ChevronRight size={16} /></span>
            </button>
          </div>
        </section>
      )}

      {mode === "name" && (
        <NameGame
          imagine={imagine}
          onStep={setLevel}
          onCare={() => setCare(true)}
          onDone={(it) => { setItems(it); setMode("setting"); }}
        />
      )}

      {mode === "setting" && (
        <SettingPick imagine={imagine} night={night} setNight={setNight} busy={busy} onPick={pickSetting} onCare={() => setCare(true)} />
      )}

      {mode === "guess" && guesses && (
        <GuessGame items={items} guesses={guesses} onDone={(r) => { setResults(r); setMode("results"); }} />
      )}

      {mode === "results" && (
        <Results results={results} aiUsed={aiUsed} onClues={() => { setLevel(0); setMode("clues"); }} onAgain={restart} />
      )}

      {mode === "clues" && (
        <CluesGame onCare={() => setCare(true)} onAi={() => setAiUsed(true)} onLevel={setLevel} onMenu={restart} />
      )}

      <Link className={styles.person} href="/account/guardians"><HeartHandshake size={18} />I need a person</Link>
    </main>
  );
}

/* ---------------- Mode 1, part 1: type what you notice ---------------- */
function NameGame({ imagine, onStep, onCare, onDone }: { imagine: boolean; onStep: (n: number) => void; onCare: () => void; onDone: (i: Items) => void }) {
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<Items>(empty);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [said, setSaid] = useState("");
  const s = SENSES[step];
  const list = items[s.key];
  const full = list.length >= s.count;
  const Icon = s.icon;

  useEffect(() => { onStep(step); }, [step, onStep]);

  function add(e: FormEvent) {
    e.preventDefault();
    const t = draft.trim().slice(0, 40);
    if (full) return;
    if (t.length < 2 || !/[a-z]/i.test(t)) return setErr("Type a word or two.");
    if (list.some((x) => same(x, t))) return setErr("You already have that one. Find something new.");
    if (needsPerson(t)) onCare();
    setItems((cur) => ({ ...cur, [s.key]: [...cur[s.key], t] }));
    setSaid(["Ooh, nice one.", "Good eye.", "Got it. I'm curious.", "Mm, noted.", "I wouldn't have guessed that."][list.length % 5]);
    setDraft("");
    setErr("");
  }
  const remove = (i: number) => setItems((cur) => ({ ...cur, [s.key]: cur[s.key].filter((_, k) => k !== i) }));

  return (
    <section className={g.panel} key={step} style={{ "--glow": s.glow } as CSSProperties}>
      <ol className={g.steps} aria-label={`Step ${step + 1} of 5`}>
        {SENSES.map((x, i) => <li key={x.key} className={i < step ? g.done : i === step ? g.active : ""}>{x.count}</li>)}
      </ol>
      <Kiki mood={full ? "happy" : "idle"} size={72} />
      <p className={g.say}><Icon size={18} /> {imagine ? s.imagine : s.ask}</p>
      <ul className={g.chipsOut}>
        {list.map((t, i) => (
          <li key={t + i} style={{ animationDelay: `${i * 0.05}s` }}>
            {t}<button onClick={() => remove(i)} aria-label={`Remove ${t}`}><X size={12} /></button>
          </li>
        ))}
        {Array.from({ length: Math.max(0, s.count - list.length) }, (_, i) => <li key={`e${i}`} className={g.slot} aria-hidden="true" />)}
      </ul>
      {!full ? (
        <form className={g.inputRow} onSubmit={add}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`e.g. ${s.ph}`} maxLength={40} autoFocus aria-label={`Type something you ${s.noun}`} autoComplete="off" />
          <button type="submit" aria-label="Add"><Send size={18} /></button>
        </form>
      ) : (
        <button className={g.primary} onClick={() => { if (step === 4) onDone(items); else { setStep(step + 1); setSaid(""); setErr(""); } }}>
          {step === 4 ? "Done. Let Kiki guess" : "Next"}
        </button>
      )}
      <p className={g.helper} aria-live="polite">{err || said || `${list.length} of ${s.count}`}</p>
    </section>
  );
}

/* ---------------- Mode 1, part 2: where are you? ---------------- */
function SettingPick({ imagine, night, setNight, busy, onPick, onCare }: {
  imagine: boolean; night: boolean; setNight: (v: boolean) => void; busy: boolean;
  onPick: (id: SettingId | "other", text?: string) => void; onCare: () => void;
}) {
  const [other, setOther] = useState("");
  const [showOther, setShowOther] = useState(false);
  return (
    <section className={g.panel}>
      <Kiki mood="think" size={72} />
      <h1 className={g.title}>{imagine ? "Where is your calm place?" : "Where are you?"}</h1>
      <p className={g.lede}>Pick the closest one. I&apos;ll try to guess everything you just typed.</p>
      <div className={g.settings}>
        {SETTINGS.map((s) => {
          const Ic = ICONS[s.icon];
          return <button key={s.id} disabled={busy} onClick={() => onPick(s.id)}><Ic size={22} />{s.name}</button>;
        })}
        <button disabled={busy} onClick={() => setShowOther(true)}><Compass size={22} />Somewhere else</button>
      </div>
      {showOther && (
        <form className={g.inputRow} onSubmit={(e) => { e.preventDefault(); if (other.trim().length > 1) { if (needsPerson(other)) onCare(); onPick("other", other.trim()); } }}>
          <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. a hair salon" maxLength={40} autoFocus aria-label="Where are you?" />
          <button type="submit" aria-label="Go"><Send size={18} /></button>
        </form>
      )}
      <label className={g.check}><input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} />It&apos;s dark where I am</label>
      {busy && <p className={g.helper}>Kiki is thinking…</p>}
    </section>
  );
}

/* ---------------- Mode 1, part 3: pop the wrong guesses ---------------- */
function GuessGame({ items, guesses, onDone }: { items: Items; guesses: Record<SenseKey, Guess[]>; onDone: (r: Partial<Record<SenseKey, SenseResult>>) => void }) {
  const [gi, setGi] = useState(0);
  const [popped, setPopped] = useState<string[]>([]);
  const [shake, setShake] = useState("");
  const [nudge, setNudge] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [acc, setAcc] = useState<Partial<Record<SenseKey, SenseResult>>>({});
  const s = SENSES[gi];
  const gs = guesses[s.key];
  const mine = items[s.key];
  const wrong = gs.filter((x) => !mine.some((t) => matchesGuess(t, x)));
  const allGone = wrong.every((w) => popped.includes(w.label));
  const result = scoreSense(mine, gs);
  const Icon = s.icon;

  useEffect(() => {
    if (!allGone || revealed) return;
    const t = window.setTimeout(() => setRevealed(true), 750);
    return () => window.clearTimeout(t);
  }, [allGone, revealed]);

  function tap(x: Guess) {
    if (revealed || popped.includes(x.label)) return;
    const match = mine.find((t) => matchesGuess(t, x));
    if (!match) {
      setPopped((p) => [...p, x.label]);
      setNudge(["Pop! Good catch.", "Nope, not there. Nice.", "Right, Kiki was way off.", "Sharp eyes."][popped.length % 4]);
      navigator.vibrate?.(10);
    } else {
      setShake(x.label);
      setNudge(`That one matches "${match}", which you typed. Keep it.`);
      window.setTimeout(() => setShake(""), 500);
    }
  }
  function next() {
    const merged = { ...acc, [s.key]: result };
    if (gi === SENSES.length - 1) return onDone(merged);
    setAcc(merged); setGi(gi + 1); setPopped([]); setRevealed(false); setNudge("");
  }

  return (
    <section className={g.panel} key={gi} style={{ "--glow": s.glow } as CSSProperties}>
      <Kiki mood={revealed ? (result.hits.length > 0 ? "happy" : "puzzled") : "think"} size={64} />
      <p className={g.say}><Icon size={18} /> {revealed ? `Kiki got ${result.hits.length} of your ${result.mine} ${s.noun}${s.count > 1 ? "s" : ""}.` : `These are my guesses for what you ${s.noun}. Tap the wrong ones to pop them.`}</p>
      <div className={g.cloud}>
        {gs.map((x, i) => {
          const isPopped = popped.includes(x.label);
          const right = mine.some((t) => matchesGuess(t, x));
          return (
            <button
              key={x.label}
              onClick={() => tap(x)}
              className={`${g.bubble} ${g[`b${i % 4}`]} ${isPopped ? g.popped : ""} ${shake === x.label ? g.shake : ""} ${revealed && right ? g.hit : ""}`}
              style={{ "--d": `${(i % 5) * 0.5}s` } as CSSProperties}
              disabled={isPopped || revealed}
            >{x.label}</button>
          );
        })}
      </div>
      {revealed && result.surprises.length > 0 && <p className={g.surprise}>Kiki never guessed: {result.surprises.join(", ")}. Nice noticing.</p>}
      <p className={g.helper} aria-live="polite">{nudge || `${popped.length} of ${wrong.length} wrong guesses popped`}</p>
      <div className={g.mine}>You typed: {mine.join(", ")}</div>
      {revealed && <button className={g.primary} onClick={next}>{gi === SENSES.length - 1 ? "See my score" : "Next"}</button>}
    </section>
  );
}

/* ---------------- Mode 1, part 4: score ---------------- */
function Results({ results, aiUsed, onClues, onAgain }: { results: Partial<Record<SenseKey, SenseResult>>; aiUsed: boolean; onClues: () => void; onAgain: () => void }) {
  const all = Object.values(results) as SenseResult[];
  const hits = all.reduce((n, r) => n + r.hits.length, 0);
  const mine = all.reduce((n, r) => n + r.mine, 0);
  const surprises = all.flatMap((r) => r.surprises);
  const pct = mine ? hits / mine : 0;
  const title = pct >= 0.7 ? "Kiki read your mind" : pct >= 0.4 ? "Kiki had a good feeling" : "You were too unpredictable";
  return (
    <section className={g.panel}>
      <Kiki mood="happy" size={88} />
      <h1 className={g.title}>{title}.</h1>
      <p className={g.big}>{hits}<span> of {mine}</span></p>
      <p className={g.lede}>Kiki guessed {hits} of the {mine} things you noticed. You surprised me {surprises.length} time{surprises.length === 1 ? "" : "s"}.</p>
      {surprises.length > 0 && <ul className={g.chipsOut}>{surprises.slice(0, 8).map((t) => <li key={t}>{t}</li>)}</ul>}
      {aiUsed && <p className={g.helper}>Kiki used an AI helper this round. Your words were sent to it, not saved.</p>}
      <div className={g.actions}>
        <button className={g.primary} onClick={onClues}>Now be my eyes</button>
        <button className={g.ghost} onClick={onAgain}>Menu</button>
      </div>
    </section>
  );
}

/* ---------------- Mode 2: Be my eyes ---------------- */
type Msg = { from: "kiki" | "you"; text: string };
const STARTERS: { sense: SenseKey; label: string; icon: Icon }[] = [
  { sense: "see", label: "I see something", icon: Eye },
  { sense: "feel", label: "I'm holding something", icon: Hand },
  { sense: "hear", label: "I hear something", icon: Ear },
  { sense: "smell", label: "I smell something", icon: Wind },
];
const INTRO: Record<string, string> = {
  see: "Ooh, you see something! I can't see anything from in here.",
  feel: "You're holding something? Don't tell me. I'll ask.",
  hear: "You hear something! My ears are only little.",
  smell: "A smell! Fireflies have terrible noses.",
};

function CluesGame({ onCare, onAi, onLevel, onMenu }: { onCare: () => void; onAi: () => void; onLevel: (n: number) => void; onMenu: () => void }) {
  const CLUE_TARGET = 7;
  const [round, setRound] = useState<Round | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [log, setLog] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [mood, setMood] = useState<Mood>("idle");
  const [draft, setDraft] = useState("");
  const [outcome, setOutcome] = useState<"won" | "lost" | null>(null);
  const [stats, setStats] = useState({ rounds: 0, kiki: 0 });
  const logRef = useRef<Msg[]>([]);
  const timers = useRef<number[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [log, thinking]);
  useEffect(() => { onLevel(round ? Math.min(4, questionsAsked(round)) : 0); }, [round, onLevel]);

  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const push = (from: Msg["from"], text: string) => { logRef.current = [...logRef.current, { from, text }]; setLog(logRef.current); };

  function start(sense: SenseKey) {
    const r = newRound(sense);
    logRef.current = [];
    setLog([]); setOutcome(null); setMood("idle");
    push("kiki", `${INTRO[sense]} Be my eyes? A few questions and I'll guess.`);
    turn(r);
  }

  function turn(r: Round, lead = "", forced?: Move) {
    setRound(r); setMove(null); setThinking(true); setMood("think");
    later(() => {
      const m = forced ?? nextMove(r);
      if (m.kind === "stuck") { void giveUp(r, lead); return; }
      setThinking(false); setMove(m); setMood("idle");
      push("kiki", `${lead ? lead + " " : ""}${describeMove(m, r)}`);
    }, 800);
  }

  async function giveUp(r: Round, lead: string) {
    let guess: string | undefined;
    if (!r.aiTried) {
      const ai = await askAi<{ guess?: string }>({ task: "clue", sense: r.sense, transcript: logRef.current, wrong: r.rejected });
      guess = ai?.guess;
      if (ai) onAi();
    }
    setRound({ ...r, aiTried: true });
    setThinking(false);
    if (guess && !r.rejected.some((x) => same(x, guess))) {
      setMove({ kind: "guess", label: guess });
      push("kiki", `${lead ? lead + " " : ""}Let me think harder. ${guessText(guess, r.sense)}`);
    } else {
      setMove({ kind: "reveal" });
      setMood("puzzled");
      push("kiki", `${lead ? lead + " " : ""}You got me! What was it?`);
    }
  }

  function finish(won: boolean, text: string) {
    setOutcome(won ? "won" : "lost"); setMood(won ? "happy" : "puzzled"); setMove(null);
    setStats((s) => ({ rounds: s.rounds + 1, kiki: s.kiki + (won ? 1 : 0) }));
    push("kiki", text);
  }

  function submit(raw: string) {
    const text = raw.trim().slice(0, 120);
    if (!text || !move || !round || thinking || outcome) return;
    if (needsPerson(text)) onCare();
    push("you", text);
    setDraft("");
    if (move.kind === "reveal") return finish(false, `Ahh, ${text}! I'd never have guessed. Point to you.`);
    const res = applyAnswer(round, move, text);
    if (move.kind === "guess" && res.yes) return finish(true, `Yes! I got it in ${questionsAsked(round)} questions. Kiki's brain is glowing.`);
    const inferred = res.inferredGuess;
    if (inferred && move.kind !== "guess" && !res.round.rejected.some((x) => same(x, inferred))) {
      turn(res.round, `${reaction(move, res, res.round)} I think I caught your clue.`, { kind: "guess", label: inferred });
      return;
    }
    turn(res.round, reaction(move, res, res.round));
  }

  const quick: string[] =
    move?.kind === "setting" ? SETTINGS.map((s) => s.name)
    : move?.kind === "posture" ? ["Lying down", "Sitting", "Standing"]
    : move?.kind === "ask" || move?.kind === "guess" ? ["Yes", "No", "Not sure"] : [];
  const used = round ? Math.min(questionsAsked(round), CLUE_TARGET) : 0;

  if (!round) {
    return (
      <section className={g.panel}>
        <Kiki mood="idle" size={88} />
        <h1 className={g.title}>Give me a clue.</h1>
        <p className={g.lede}>Pick where to start. I&apos;ll ask a few questions and guess what you&apos;re noticing.</p>
        <div className={g.settings}>
          {STARTERS.map((s) => <button key={s.sense} onClick={() => start(s.sense)}><s.icon size={22} />{s.label}</button>)}
        </div>
      </section>
    );
  }

  return (
    <section className={g.chatWrap}>
      <div className={g.chatHead}>
        <Kiki mood={mood} size={52} look={draft ? { x: 0, y: 0.9 } : undefined} />
        <div><strong>Kiki</strong><small>{outcome ? `Kiki ${stats.kiki}, you ${stats.rounds - stats.kiki}` : `Clue ${used} of ${CLUE_TARGET}`}</small></div>
      </div>
      <div className={g.chat} aria-live="polite">
        {log.map((m, i) => <p key={i} className={`${g.msg} ${m.from === "you" ? g.you : ""}`}>{m.text}</p>)}
        {thinking && <p className={`${g.msg} ${g.typing}`}><i /><i /><i /></p>}
        <div ref={endRef} />
      </div>
      {outcome ? (
        <div className={g.actions}>
          <button className={g.primary} onClick={() => { setRound(null); setLog([]); logRef.current = []; setOutcome(null); setMood("idle"); }}>Another round</button>
          <button className={g.ghost} onClick={onMenu}>Menu</button>
        </div>
      ) : (
        <>
          {quick.length > 0 && <div className={g.quick}>{quick.map((q) => <button key={q} onClick={() => submit(q)}>{q}</button>)}</div>}
          <form className={g.inputRow} onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={thinking ? "Kiki is thinking…" : "Type your answer"} disabled={thinking || !move} maxLength={120} aria-label="Your answer" autoComplete="off" />
            <button type="submit" disabled={thinking || !move} aria-label="Send"><Send size={18} /></button>
          </form>
        </>
      )}
    </section>
  );
}