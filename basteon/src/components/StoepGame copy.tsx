"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Bell, Bird, CloudRain, Coffee, Droplets, Ear, Eye, Feather, Flower2, Footprints, Gem, Hand,
  HeartHandshake, Lamp, Leaf, MoonStar, Music2, ShieldX, Sparkles, Sprout, SunMedium, TreePine, Waves, Wind, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import styles from "./stoep.module.css";

type Route = "real" | "garden";
type Phase = "choose" | "play" | "sky" | "complete";
type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;
type GardenItem = { name: string; line: string; icon: Icon };
type Sense = {
  name: string;
  past: string;
  count: number;
  icon: Icon;
  glow: string;
  prompt: string;
  hints: string[];
  garden: GardenItem[];
};
type Spark = { id: number; sx: number; sy: number; dx: number; dy: number };

const senses: Sense[] = [
  {
    name: "see", past: "seen", count: 5, icon: Eye, glow: "#ffd98a",
    prompt: "Find five things you can see.",
    hints: ["Something blue", "Something round", "Something very small", "Something far away", "Something you like"],
    garden: [
      { name: "Jacaranda bloom", line: "A purple bell, loose on the grass.", icon: Flower2 },
      { name: "Sunbird", line: "A flash of green and copper, gone and back.", icon: Bird },
      { name: "Smooth stone", line: "Grey, flat, and worn round by water.", icon: Gem },
      { name: "Quiet path", line: "It bends away between the aloes.", icon: Footprints },
      { name: "Paraffin lamp", line: "A small flame, perfectly still.", icon: Lamp },
    ],
  },
  {
    name: "feel", past: "felt", count: 4, icon: Hand, glow: "#ffa6bd",
    prompt: "Notice four things you can feel.",
    hints: ["Your feet on the ground", "Your clothes on your skin", "Something you are touching", "Air on your face"],
    garden: [
      { name: "Warm step", line: "The stoep still holds the afternoon sun.", icon: SunMedium },
      { name: "Soft moss", line: "Cool and springy under your fingers.", icon: Sprout },
      { name: "Rough bark", line: "Ridged and dry, solid and steady.", icon: Leaf },
      { name: "Evening breeze", line: "It lifts the hair off your neck.", icon: Wind },
    ],
  },
  {
    name: "hear", past: "heard", count: 3, icon: Ear, glow: "#8fd6ff",
    prompt: "Listen for three things you can hear.",
    hints: ["The closest sound", "A sound far away", "The quietest sound"],
    garden: [
      { name: "Wind chime", line: "Three soft notes, then silence.", icon: Bell },
      { name: "Crickets", line: "A slow, steady shimmer in the grass.", icon: Music2 },
      { name: "Running water", line: "A little stream, somewhere below.", icon: Waves },
    ],
  },
  {
    name: "smell", past: "smelled", count: 2, icon: Wind, glow: "#a6f0c4",
    prompt: "Notice two things you can smell.",
    hints: ["The air around you", "Something familiar. Or imagine one."],
    garden: [
      { name: "Rain on dry earth", line: "That first-storm smell, green and mineral.", icon: CloudRain },
      { name: "Jasmine", line: "Sweet and heavy, drifting over the wall.", icon: Feather },
    ],
  },
  {
    name: "taste", past: "tasted", count: 1, icon: Flower2, glow: "#ffb98a",
    prompt: "Notice one thing you can taste.",
    hints: ["What is in your mouth now? Or imagine a favourite."],
    garden: [{ name: "Rooibos with honey", line: "Warm, round and a little sweet.", icon: Coffee }],
  },
];

const TOTAL = senses.reduce((sum, sense) => sum + sense.count, 0);
const affirm = ["Got it.", "Nice noticing.", "Good one.", "Steady.", "Keep going."];
const STARS: [number, number][] = [
  [50, 90], [50, 74], [50, 58], [36, 50], [22, 42], [26, 27], [50, 42], [50, 27],
  [50, 12], [64, 50], [78, 42], [74, 27], [38, 18], [62, 18], [30, 64],
];
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 7], [7, 8],
  [2, 9], [9, 10], [10, 11], [7, 12], [7, 13], [3, 14],
];

export function StoepGame() {
  const router = useRouter();
  const search = useSearchParams();
  const [route, setRoute] = useState<Route>(() => (search.get("assist") === "garden" ? "garden" : "real"));
  const [phase, setPhase] = useState<Phase>(() => (search.get("intro") === "1" ? "choose" : "play"));
  const [discreet, setDiscreet] = useState(() => search.get("mode") === "quick");
  const [step, setStep] = useState(0);
  const [found, setFound] = useState(0);
  const [banked, setBanked] = useState(0);
  const [taken, setTaken] = useState<number[]>([]);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<number[]>([]);
  const [rising, setRising] = useState(false);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const jarRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const sparkId = useRef(0);

  function later(fn: () => void, ms: number) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  useEffect(() => {
    if (search.get("intro") === "1") {
      setPhase("choose");
      return;
    }
    setDiscreet(search.get("mode") === "quick");
    setRoute(search.get("assist") === "garden" ? "garden" : "real");
    setPhase("play");
  }, [search]);

  useEffect(() => {
    if (phase !== "sky" || placed.length < STARS.length) return;
    const timer = window.setTimeout(() => setPhase("complete"), 3200);
    return () => window.clearTimeout(timer);
  }, [phase, placed.length]);

  const current = senses[step];
  const SenseIcon = current.icon;
  const level = phase === "choose" ? 0 : phase === "play" ? step : phase === "sky" ? 4 : 5;

  function reset(next: Route) {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setRoute(next);
    setStep(0);
    setFound(0);
    setBanked(0);
    setTaken([]);
    setCaption("");
    setBusy(false);
    setPlaced([]);
    setRising(false);
    setSparks([]);
  }

  function begin(next: Route) {
    reset(next);
    setPhase("play");
  }

  function launchSpark(origin: HTMLElement | null) {
    const originRect = origin?.getBoundingClientRect();
    const jarRect = jarRef.current?.getBoundingClientRect();
    if (!originRect || !jarRect) return;
    const sx = originRect.left + originRect.width / 2;
    const sy = originRect.top + originRect.height / 2;
    const id = ++sparkId.current;
    setSparks((all) => [...all, { id, sx, sy, dx: jarRect.left + jarRect.width / 2 - sx, dy: jarRect.top + jarRect.height / 2 - sy }]);
    later(() => setSparks((all) => all.filter((spark) => spark.id !== id)), 950);
  }

  function collect(origin: HTMLElement | null, gardenIndex?: number, line?: string) {
    if (busy || phase !== "play") return;
    setBusy(true);
    if (!discreet) {
      navigator.vibrate?.(18);
      launchSpark(origin);
    }
    if (gardenIndex !== undefined) setTaken((items) => [...items, gardenIndex]);
    const nextFound = found + 1;
    setFound(nextFound);
    setCaption(line ?? affirm[(banked + step) % affirm.length]);
    later(() => setBanked((value) => value + 1), discreet ? 0 : 860);

    const finished = nextFound >= current.count;
    later(() => {
      setBusy(false);
      if (!finished) return;
      setCaption("");
      setTaken([]);
      setFound(0);
      if (step === senses.length - 1) setPhase("sky");
      else setStep((value) => value + 1);
    }, discreet ? 250 : finished ? 1300 : 700);
  }

  function light(index: number) {
    if (placed.includes(index)) return;
    if (!discreet) navigator.vibrate?.(12);
    setPlaced((items) => (items.includes(index) ? items : [...items, index]));
  }

  function riseAll() {
    if (rising) return;
    setRising(true);
    STARS.map((_, index) => index)
      .filter((index) => !placed.includes(index))
      .forEach((index, order) => later(() => setPlaced((items) => (items.includes(index) ? items : [...items, index])), 170 * (order + 1)));
  }

  const closeQuickly = () => router.replace("/account");
  const remaining = senses[step].garden
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !taken.includes(index))
    .slice(0, current.count - found);
  const hint = current.hints[Math.min(found, current.hints.length - 1)];
  const lit = (index: number) => placed.includes(index);

  return (
    <main className={`${styles.page} ${styles[`lv${level}`]} ${discreet ? styles.discreet : ""}`} style={{ "--glow": current.glow } as CSSProperties}>
      <Scene />
      <header className={styles.top}>
        <button type="button" onClick={() => router.back()}><ArrowLeft size={16} />Back</button>
        <button type="button" aria-pressed={discreet} onClick={() => setDiscreet(!discreet)}><ShieldX size={16} />{discreet ? "Discreet is on" : "Discreet mode"}</button>
        <button type="button" onClick={closeQuickly}><X size={16} />Quick close</button>
      </header>

      {phase === "choose" && (
        <section className={styles.intro}>
          <h1>Come back to this moment.</h1>
          <p className={styles.lede}>Find five small things around you, then four, three, two and one. Each one becomes a light in tonight&apos;s sky.</p>
          <ol className={styles.ladder} aria-label="The five steps">
            {senses.map((sense) => {
              const IconComponent = sense.icon;
              return <li key={sense.name} style={{ "--glow": sense.glow } as CSSProperties}><IconComponent size={18} /><b>{sense.count}</b><span>{sense.name}</span></li>;
            })}
          </ol>
          <div className={styles.routeChoices}>
            <button type="button" onClick={() => begin("real")}><Eye size={26} /><span>Look around me</span><small>Notice real things where you are right now.</small></button>
            <button type="button" onClick={() => begin("garden")}><TreePine size={26} /><span>Explore the garden</span><small>Tap glowing things in a quiet garden. Pick this if looking around doesn&apos;t feel safe.</small></button>
          </div>
          <p className={styles.note}>Nothing you notice is checked, saved or sent.</p>
        </section>
      )}

      {phase === "play" && (
        <section className={styles.play}>
          <div className={styles.hud}>
            <div className={styles.jar} ref={jarRef} role="img" aria-label={`${banked} of ${TOTAL} lights collected`}>
              <span className={styles.jarFill} style={{ height: `${(banked / TOTAL) * 100}%` }} />
              <i key={banked} className={styles.jarFlash} />
              <b>{banked}</b>
            </div>
            <ol className={styles.steps} aria-label={`Step ${step + 1} of 5`}>
              {senses.map((sense, index) => <li key={sense.name} className={index < step ? styles.done : index === step ? styles.active : ""}>{sense.count}</li>)}
            </ol>
          </div>

          <div className={styles.stage} key={step}>
            <div className={styles.badge}><SenseIcon size={32} /></div>
            <p className={styles.eyebrow}>{route === "real" ? "Look around you" : "Garden path"}</p>
            <h1>{current.prompt}</h1>
            <ul className={styles.pips} aria-label={`${found} of ${current.count} found`}>
              {Array.from({ length: current.count }, (_, index) => <li key={index} className={index < found ? styles.on : ""} />)}
            </ul>

            {route === "real" ? (
              <button type="button" className={styles.orb} disabled={busy} onClick={(event) => collect(event.currentTarget)}>
                <span className={styles.ring} /><span className={styles.ring} /><Sparkles size={26} /><strong>I noticed one</strong>
              </button>
            ) : (
              <div className={styles.tiles}>
                {remaining.map(({ item, index }, order) => {
                  const IconComponent = item.icon;
                  return <button type="button" key={item.name} className={styles.tile} style={{ "--d": `${order * 0.45}s` } as CSSProperties} disabled={busy} onClick={(event) => collect(event.currentTarget, index, item.line)}><IconComponent size={26} /><span>{item.name}</span></button>;
                })}
              </div>
            )}

            <p className={styles.caption} aria-live="polite" key={caption || hint}>{caption || (route === "real" ? `Try: ${hint}` : "Tap a glowing thing to explore it.")}</p>
          </div>

          <button type="button" className={styles.switchRoute} onClick={() => { setRoute(route === "real" ? "garden" : "real"); setCaption(""); }}>
            {route === "real" ? "Explore the garden instead" : "Look around me instead"}
          </button>
        </section>
      )}

      {phase === "sky" && (
        <section className={styles.sky}>
          <h1>{placed.length === STARS.length ? "The Jacaranda" : "Light up your sky."}</h1>
          <p className={styles.lede}>{placed.length === STARS.length ? "Fifteen things you noticed, shining together." : "Tap each star. Every one is something you noticed."}</p>
          <div className={styles.constellation} aria-label={`${placed.length} of ${STARS.length} stars lit`}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {EDGES.filter(([a, b]) => lit(a) && lit(b)).map(([a, b]) => <line key={`${a}-${b}`} x1={STARS[a][0]} y1={STARS[a][1]} x2={STARS[b][0]} y2={STARS[b][1]} pathLength={1} className={styles.edge} />)}
            </svg>
            {STARS.map(([x, y], index) => (
              <button type="button" key={index} className={`${styles.star} ${lit(index) ? styles.lit : ""}`} style={{ left: `${x}%`, top: `${y}%`, "--d": `${(index % 5) * 0.4}s` } as CSSProperties} aria-label={lit(index) ? `Star ${index + 1} lit` : `Light star ${index + 1}`} onClick={() => light(index)}>
                {lit(index) ? <MoonStar size={18} /> : <Sparkles size={18} />}
              </button>
            ))}
          </div>
          <span className={styles.skyCount}>{placed.length} of {STARS.length} lit</span>
          {placed.length < STARS.length && <button type="button" className={styles.ghost} onClick={riseAll} disabled={rising}>Let them rise</button>}
        </section>
      )}

      {phase === "complete" && (
        <section className={styles.complete}>
          <div className={styles.sunrise}><SunMedium size={40} /></div>
          <h1>You made space.</h1>
          <p className={styles.lede}>You noticed fifteen things. That was enough. Nothing from this was saved.</p>
          <ul className={styles.recap}>{senses.map((sense) => <li key={sense.name}><b>{sense.count}</b> {sense.past}</li>)}</ul>
          <div className={styles.endActions}>
            <button type="button" onClick={() => { reset("real"); setPhase("choose"); }}>Go again</button>
            <button type="button" className={styles.ghost} onClick={() => router.back()}>I&apos;m done</button>
          </div>
        </section>
      )}

      <Link className={styles.person} href="/account/guardians"><HeartHandshake size={18} />I need a person</Link>

      {sparks.map((spark) => (
        <span key={spark.id} className={styles.sparkX} style={{ left: spark.sx, top: spark.sy, "--dx": `${spark.dx}px`, "--dy": `${spark.dy}px` } as CSSProperties}>
          <span className={styles.sparkY}><i /></span>
        </span>
      ))}
    </main>
  );
}

function Scene() {
  return (
    <div className={styles.scene} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((level) => <div key={level} className={`${styles.sky_} ${styles[`sky${level}`]}`} />)}
      <div className={styles.sun} />
      <div className={styles.moon} />
      <div className={styles.stars}>
        {Array.from({ length: 44 }, (_, index) => (
          <span key={index} style={{ left: `${(index * 37 + 11) % 100}%`, top: `${(index * 23 + 5) % 58}%`, width: 1 + (index % 3), height: 1 + (index % 3), animationDelay: `${(index % 7) * 0.6}s` }} />
        ))}
      </div>
      <svg className={styles.hills} viewBox="0 0 400 220" preserveAspectRatio="none">
        <path d="M0 120 Q80 70 170 110 T400 90 V220 H0Z" className={styles.hillFar} />
        <path d="M0 160 Q110 110 210 150 T400 135 V220 H0Z" className={styles.hillNear} />
      </svg>
      <svg className={styles.tree} viewBox="0 0 160 220">
        <path d="M78 220 C80 170 74 140 80 100 L88 100 C84 140 92 170 92 220Z" className={styles.trunk} />
        <g className={styles.canopy}>
          <circle cx="80" cy="70" r="46" /><circle cx="42" cy="92" r="30" /><circle cx="120" cy="90" r="32" /><circle cx="80" cy="34" r="28" />
        </g>
      </svg>
      <div className={styles.flies}>
        {Array.from({ length: 16 }, (_, index) => <span key={index} style={{ left: `${(index * 61 + 7) % 100}%`, top: `${42 + ((index * 17) % 48)}%`, animationDelay: `${(index % 6) * -1.7}s`, animationDuration: `${8 + (index % 5) * 2}s` }} />)}
      </div>
    </div>
  );
}
