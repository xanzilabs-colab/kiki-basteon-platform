"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./games.module.css";

/* ════════════════════════════════════════════════════════════
   WORRY BOATS
   Write a worry → it folds into a paper boat → it drifts down a
   moonlit river into the mist → and rises as a star. Every worry
   you let go lights the sky a little more, until dawn.
   ════════════════════════════════════════════════════════════ */

const MAX_CHARS = 200;
const BOAT_W = 76;
const BOAT_H = 66;
const TRAVEL_SECONDS = 26;

const PROMPTS = [
  "What's sitting on your chest tonight?",
  "What keeps looping in your head?",
  "What are you afraid might happen?",
  "What do you wish you could put down?",
];
const STARTERS = ["Something I can't control", "Something I said", "Something coming up", "I just feel heavy"];
const LAUNCH_LINES = [
  "Folded. Floating. Let it go.",
  "It's not yours to carry tonight.",
  "Already getting smaller.",
  "Breathe out. Watch it drift.",
  "You made it through today.",
];

/* ── small helpers ─────────────────────────────────────────── */
type Rgb = [number, number, number];
const hexRgb = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: Rgb, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const waveOff = (x: number, t: number) => Math.sin(x * 0.018 + t * 1.4) * 2.2 + Math.sin(x * 0.041 - t * 0.9) * 1.3;
const waveSlope = (x: number, t: number) => Math.cos(x * 0.018 + t * 1.4) * 0.018 * 2.2 + Math.cos(x * 0.041 - t * 0.9) * 0.041 * 1.3;

const PAPERS = [
  { light: "#fff6e8", dark: "#ebd3b6" },
  { light: "#f3e6ff", dark: "#c7aaf0" },
  { light: "#ffe6ee", dark: "#f1a9c0" },
  { light: "#e6f0ff", dark: "#a8c3ef" },
  { light: "#fff0e0", dark: "#f5bf98" },
];

const NIGHT = { top: hexRgb("#0f0830"), mid: hexRgb("#2b1757"), low: hexRgb("#5e2d74") };
const DAWN = { top: hexRgb("#4b3a8c"), mid: hexRgb("#a85d9c"), low: hexRgb("#ffbe94") };
const DEEP = hexRgb("#180a38");

/* ════════════════════════════════════════════════════════════
   AUDIO — all synthesised, nothing to download
   ════════════════════════════════════════════════════════════ */
function createAudioEngine() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let echoIn: GainNode | null = null;
  let on = false;

  const ensure = () => {
    if (ctx) return ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // river bed: slow brown noise through a drifting low-pass
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 420;
    const bed = ctx.createGain();
    bed.gain.value = 0.45;
    source.connect(lowpass);
    lowpass.connect(bed);
    bed.connect(master);
    source.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(lowpass.frequency);
    lfo.start();

    // echo for chimes
    echoIn = ctx.createGain();
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.34;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.36;
    echoIn.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(master);
    echoIn.connect(master);
    return ctx;
  };

  const burst = (type: BiquadFilterType, freq: number, duration: number, volume: number, offset = 0) => {
    if (!on || !ctx || !master) return;
    const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    const t = ctx.currentTime + offset;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
  };

  return {
    setOn(value: boolean) {
      on = value;
      const c = ensure();
      if (!c || !master) return;
      void c.resume();
      master.gain.setTargetAtTime(value ? 0.9 : 0, c.currentTime, 0.4);
    },
    crinkle() {
      [0, 0.07, 0.15, 0.23].forEach((o) => burst("highpass", 2600, 0.07, 0.13, o));
    },
    splash() {
      burst("lowpass", 900, 0.38, 0.28);
    },
    chime(index: number) {
      if (!on || !ctx || !master || !echoIn) return;
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      const freq = notes[index % notes.length];
      const t = ctx.currentTime;
      [1, 2].forEach((mult, i) => {
        const osc = ctx!.createOscillator();
        osc.type = i === 0 ? "sine" : "triangle";
        osc.frequency.value = freq * mult;
        const gain = ctx!.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(i === 0 ? 0.16 : 0.04, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0008, t + 2.4);
        osc.connect(gain);
        gain.connect(echoIn!);
        osc.start(t);
        osc.stop(t + 2.5);
      });
    },
  };
}

/* ════════════════════════════════════════════════════════════
   THE RIVER — canvas scene
   ════════════════════════════════════════════════════════════ */
type SceneHooks = {
  onStar: (total: number) => void;
  onAfloat: (count: number) => void;
  onSplash: () => void;
  reduced: boolean;
};

type Boat = { id: number; u: number; seed: number; palette: number; lane: number; boost: number; lines: number; ripT: number };
type Ripple = { x: number; y: number; r: number; max: number; a: number; speed: number };
type Drop = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number };
type Flight = { x0: number; y0: number; cx: number; cy: number; nx: number; ny: number; t: number; trail: { x: number; y: number; age: number }[] };
type UserStar = { nx: number; ny: number; born: number; size: number };

function createRiverScene(canvas: HTMLCanvasElement, hooks: SceneHooks) {
  const ctx = canvas.getContext("2d")!;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let horizon = 0;
  let time = 0;
  let lastFrame = 0;
  let raf = 0;
  let dawn = 0;
  let launchedCount = 0;
  let boatId = 1;
  let reduced = hooks.reduced;
  let lastPointerRipple = 0;

  const boats: Boat[] = [];
  const ripples: Ripple[] = [];
  const drops: Drop[] = [];
  const flights: Flight[] = [];
  const userStars: UserStar[] = [];

  const baseStars = Array.from({ length: 130 }, (_, i) => ({
    x: hash(i),
    y: Math.pow(hash(i + 500), 1.3),
    size: 0.4 + hash(i + 900) * 1.1,
    phase: hash(i + 1300) * 6.28,
    speed: 0.8 + hash(i + 1700) * 2.2,
  }));
  const fireflies = Array.from({ length: 16 }, (_, i) => ({
    bx: hash(i + 40),
    by: hash(i + 80),
    phase: hash(i + 120) * 6.28,
    speed: 0.4 + hash(i + 160) * 0.8,
    ox: 0,
    oy: 0,
  }));
  const clouds = Array.from({ length: 5 }, (_, i) => ({
    y: 0.1 + hash(i + 200) * 0.38,
    x: hash(i + 240),
    speed: 3 + hash(i + 280) * 5,
    size: 90 + hash(i + 320) * 120,
  }));

  const HILLS = [
    { b: 0.07, a: [0.05, 0.025, 0.012], f: [0.0045, 0.011, 0.026], ph: 1.2, mixT: 0.55, trees: false },
    { b: 0.05, a: [0.04, 0.02, 0.01], f: [0.0062, 0.014, 0.03], ph: 3.7, mixT: 0.72, trees: true },
    { b: 0.028, a: [0.03, 0.016, 0.008], f: [0.008, 0.019, 0.04], ph: 5.1, mixT: 0.88, trees: true },
  ];
  const hillY = (layer: number, x: number) => {
    const h = HILLS[layer];
    return (
      horizon -
      H * (h.b + h.a[0] * (0.5 + 0.5 * Math.sin(x * h.f[0] + h.ph)) + h.a[1] * Math.sin(x * h.f[1] + h.ph * 2) + h.a[2] * Math.sin(x * h.f[2] + h.ph * 3))
    );
  };

  const pendingLane = () => (launchedCount * 0.382) % 1;
  const yNearOf = (lane: number) => H * 0.82 - lane * H * 0.05;

  const boatPose = (b: Boat) => {
    const u = b.u;
    const e = u * 0.65 + smooth(u) * 0.35;
    const x0 = W * 0.1;
    const x1 = W * 0.9;
    const yFar = horizon + (H - horizon) * 0.1;
    const yNear = yNearOf(b.lane);
    const x = x0 + (x1 - x0) * e;
    const baseY = yNear + (yFar - yNear) * Math.pow(u, 0.75) + Math.sin(u * 7 + b.seed * 6.28) * 4 * (1 - u);
    const s = 1 - 0.74 * Math.pow(u, 0.85);
    return {
      x,
      y: baseY + waveOff(x, time) * s,
      s,
      rot: Math.atan(waveSlope(x, time)) * 0.6 + Math.sin(time * 1.1 + b.seed * 9) * 0.035,
      alpha: u < 0.78 ? 1 : 1 - smooth((u - 0.78) / 0.22),
    };
  };

  /* ── effects ──────────────────────────────────────── */
  const addRipple = (x: number, y: number, max: number, a = 0.5, start = 0) =>
    ripples.push({ x, y, r: start, max, a, speed: 28 + max * 0.25 });

  const splash = (x: number, y: number) => {
    hooks.onSplash();
    addRipple(x, y + 4, 70, 0.6);
    addRipple(x, y + 4, 70, 0.45, -10);
    addRipple(x, y + 4, 70, 0.3, -20);
    for (let i = 0; i < 12; i++) {
      drops.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 140,
        vy: -(120 + Math.random() * 160),
        life: 0,
        max: 0.9,
        size: 1 + Math.random() * 1.8,
      });
    }
  };

  const pickStarSpot = () => {
    const last = userStars[userStars.length - 1];
    let nx = 0.25 + Math.random() * 0.5;
    let ny = 0.14 + Math.random() * 0.4;
    if (last) {
      for (let tries = 0; tries < 10; tries++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 90;
        const tx = last.nx + (Math.cos(angle) * dist) / W;
        const ty = last.ny + (Math.sin(angle) * dist) / horizon;
        if (tx > 0.07 && tx < 0.93 && ty > 0.08 && ty < 0.78) {
          nx = tx;
          ny = ty;
          break;
        }
      }
    }
    return { nx, ny };
  };

  /* ── drawing ──────────────────────────────────────── */
  const P = (xp: number, yp: number): [number, number] => [(xp / 100 - 0.5) * BOAT_W, (yp / 100 - 1) * BOAT_H];
  const poly = (c: CanvasRenderingContext2D, pts: [number, number][]) => {
    c.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    c.closePath();
  };

  const drawBoat = (b: Boat, mirror: boolean) => {
    const pose = boatPose(b);
    if (pose.alpha <= 0.01) return;
    const paper = PAPERS[b.palette];
    const c = ctx;
    c.save();
    c.translate(pose.x, pose.y + 5 * pose.s);
    c.rotate(mirror ? -pose.rot : pose.rot);
    c.scale(pose.s, mirror ? -pose.s : pose.s);
    c.globalAlpha = pose.alpha * (mirror ? 0.2 : 1);

    if (!mirror) {
      c.fillStyle = "rgba(6,0,22,0.38)";
      c.beginPath();
      c.ellipse(0, 2, BOAT_W * 0.44, 4, 0, 0, Math.PI * 2);
      c.fill();
    }

    const hullL = c.createLinearGradient(0, -BOAT_H * 0.42, 0, 0);
    hullL.addColorStop(0, paper.light);
    hullL.addColorStop(1, css(mix(hexRgb(paper.light), hexRgb(paper.dark), 0.35)));
    const hullR = c.createLinearGradient(0, -BOAT_H * 0.42, 0, 0);
    hullR.addColorStop(0, paper.dark);
    hullR.addColorStop(1, css(mix(hexRgb(paper.dark), [40, 20, 70], 0.25)));

    c.fillStyle = hullL;
    poly(c, [P(0, 58), P(50, 58), P(50, 100), P(18, 100)]);
    c.fill();
    c.fillStyle = hullR;
    poly(c, [P(50, 58), P(100, 58), P(82, 100), P(50, 100)]);
    c.fill();
    c.fillStyle = paper.light;
    poly(c, [P(26, 58), P(50, 0), P(50, 58)]);
    c.fill();
    c.fillStyle = css(mix(hexRgb(paper.dark), [255, 255, 255], 0.25));
    poly(c, [P(50, 0), P(74, 58), P(50, 58)]);
    c.fill();

    // worry scribbles on the sail (private: only the shape of writing)
    c.strokeStyle = "rgba(92,60,128,0.5)";
    c.lineWidth = 1.1;
    c.lineCap = "round";
    for (let i = 0; i < b.lines; i++) {
      const yp = 50 - i * 9;
      const half = (58 - yp) / 58;
      const [xa, y] = P(50 - 22 * half + 3, yp);
      const [xb] = P(50 - 3, yp);
      c.beginPath();
      c.moveTo(xa, y);
      for (let k = 1; k <= 4; k++) c.lineTo(xa + ((xb - xa) * k) / 4, y + Math.sin(k * 2.2 + b.seed * 9 + i) * 1.2);
      c.stroke();
    }

    c.strokeStyle = "rgba(84,52,120,0.38)";
    c.lineWidth = 0.9;
    poly(c, [P(0, 58), P(100, 58), P(82, 100), P(18, 100)]);
    c.stroke();
    c.beginPath();
    c.moveTo(...P(50, 0));
    c.lineTo(...P(50, 100));
    c.moveTo(...P(26, 58));
    c.lineTo(...P(50, 0));
    c.lineTo(...P(74, 58));
    c.stroke();
    c.restore();
  };

  const drawFrame = (dt: number) => {
    const c = ctx;
    const t = time;

    // dawn creeps in as stars are born
    const dawnTarget = Math.min(1, userStars.length / 9) * 0.8;
    dawn += (dawnTarget - dawn) * Math.min(1, dt * 0.6);

    const top = mix(NIGHT.top, DAWN.top, dawn);
    const mid = mix(NIGHT.mid, DAWN.mid, dawn);
    const low = mix(NIGHT.low, DAWN.low, dawn);

    /* sky */
    const sky = c.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, css(top));
    sky.addColorStop(0.55, css(mid));
    sky.addColorStop(1, css(low));
    c.fillStyle = sky;
    c.fillRect(0, 0, W, horizon + 2);

    /* background stars */
    for (const s of baseStars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      const a = (0.28 + 0.62 * tw) * (1 - dawn * 0.8);
      c.fillStyle = `rgba(255,248,235,${a.toFixed(3)})`;
      c.beginPath();
      c.arc(s.x * W, s.y * horizon * 0.92, s.size, 0, Math.PI * 2);
      c.fill();
    }

    /* moon */
    const mx = W * 0.8;
    const my = horizon * 0.34;
    const moonA = 1 - dawn * 0.45;
    const halo = c.createRadialGradient(mx, my, 6, mx, my, 120);
    halo.addColorStop(0, `rgba(255,238,205,${0.34 * moonA})`);
    halo.addColorStop(1, "rgba(255,238,205,0)");
    c.fillStyle = halo;
    c.fillRect(mx - 130, my - 130, 260, 260);
    const disc = c.createRadialGradient(mx - 6, my - 6, 2, mx, my, 24);
    disc.addColorStop(0, `rgba(255,251,238,${moonA})`);
    disc.addColorStop(1, `rgba(247,226,190,${moonA})`);
    c.fillStyle = disc;
    c.beginPath();
    c.arc(mx, my, 23, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = `rgba(190,160,140,${0.22 * moonA})`;
    [[-7, -4, 5], [6, 7, 4], [8, -8, 3], [-8, 9, 3]].forEach(([dx, dy, r]) => {
      c.beginPath();
      c.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
      c.fill();
    });

    /* drifting clouds */
    for (const cl of clouds) {
      const x = ((cl.x * (W + 400) + t * cl.speed) % (W + 400)) - 200;
      const y = cl.y * horizon;
      const g = c.createRadialGradient(x, y, 4, x, y, cl.size);
      g.addColorStop(0, css(mix(low, [255, 255, 255], 0.12), 0.2));
      g.addColorStop(1, css(low, 0));
      c.fillStyle = g;
      c.save();
      c.translate(x, y);
      c.scale(1, 0.28);
      c.translate(-x, -y);
      c.fillRect(x - cl.size, y - cl.size, cl.size * 2, cl.size * 2);
      c.restore();
    }

    /* constellation lines + user stars */
    if (userStars.length > 1) {
      c.lineWidth = 1;
      for (let i = 1; i < userStars.length; i++) {
        const a = userStars[i - 1];
        const b = userStars[i];
        const age = clamp((t - b.born) / 2.2, 0, 1);
        c.strokeStyle = `rgba(255,236,190,${(0.28 * age * (1 - dawn * 0.5)).toFixed(3)})`;
        c.beginPath();
        c.moveTo(a.nx * W, a.ny * horizon);
        c.lineTo(a.nx * W + (b.nx * W - a.nx * W) * age, a.ny * horizon + (b.ny * horizon - a.ny * horizon) * age);
        c.stroke();
      }
    }
    for (const s of userStars) {
      const age = t - s.born;
      const pop = age < 1.2 ? 1 + Math.sin(clamp(age / 1.2, 0, 1) * Math.PI) * 0.9 * (1 - age / 1.2) + (1 - clamp(age / 0.5, 0, 1)) * -1 : 1;
      const pulse = 0.82 + 0.18 * Math.sin(t * 2.1 + s.nx * 20);
      const r = s.size * clamp(pop, 0, 2) * pulse;
      const x = s.nx * W;
      const y = s.ny * horizon;
      const g = c.createRadialGradient(x, y, 0, x, y, r * 7);
      g.addColorStop(0, "rgba(255,240,200,0.55)");
      g.addColorStop(1, "rgba(255,240,200,0)");
      c.fillStyle = g;
      c.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
      c.fillStyle = "#fff6dc";
      c.beginPath();
      c.moveTo(x, y - r * 3.2);
      c.quadraticCurveTo(x, y, x + r * 3.2, y);
      c.quadraticCurveTo(x, y, x, y + r * 3.2);
      c.quadraticCurveTo(x, y, x - r * 3.2, y);
      c.quadraticCurveTo(x, y, x, y - r * 3.2);
      c.fill();
    }

    /* hills + pines */
    HILLS.forEach((h, li) => {
      const col = mix(low, DEEP, h.mixT);
      c.fillStyle = css(col);
      c.beginPath();
      c.moveTo(0, horizon + 1);
      for (let x = 0; x <= W + 6; x += 6) c.lineTo(x, hillY(li, x));
      c.lineTo(W, horizon + 1);
      c.closePath();
      c.fill();
      if (h.trees) {
        c.fillStyle = css(mix(col, [4, 0, 16], 0.35));
        for (let x = 8, i = 0; x < W; i++, x += 14 + hash(i + li * 90) * 22) {
          const base = hillY(li, x) + 3;
          const th = (9 + hash(i * 3 + li) * 17) * (li === 2 ? 1.25 : 0.9);
          for (let tier = 0; tier < 3; tier++) {
            const w = th * (0.5 - tier * 0.1);
            const yb = base - tier * th * 0.3;
            c.beginPath();
            c.moveTo(x - w, yb);
            c.lineTo(x, yb - th * 0.62);
            c.lineTo(x + w, yb);
            c.closePath();
            c.fill();
          }
        }
      }
    });

    /* horizon glow */
    const glow = c.createRadialGradient(W * 0.5, horizon, 10, W * 0.5, horizon, W * 0.7);
    glow.addColorStop(0, css(mix(low, [255, 200, 150], 0.4), 0.18 + dawn * 0.55));
    glow.addColorStop(1, css(low, 0));
    c.fillStyle = glow;
    c.fillRect(0, horizon - W * 0.35, W, W * 0.35 + 2);

    /* water */
    const water = c.createLinearGradient(0, horizon, 0, H);
    water.addColorStop(0, css(mix(low, DEEP, 0.55)));
    water.addColorStop(0.35, css(mix(hexRgb("#1a1040"), hexRgb("#3b2a78"), dawn)));
    water.addColorStop(1, css(mix(hexRgb("#0a0722"), hexRgb("#241a55"), dawn)));
    c.fillStyle = water;
    c.fillRect(0, horizon, W, H - horizon);

    const ROWS = 26;
    for (let k = 0; k < ROWS; k++) {
      const f = k / ROWS;
      const y = horizon + (H - horizon) * Math.pow(f, 1.7) + 2;
      const amp = 0.5 + f * 3.1;
      const wl = 30 + f * 120;
      const speed = 12 + f * 55;
      c.strokeStyle = css(mix([170, 150, 235], [255, 220, 230], dawn), 0.05 + f * 0.11);
      c.lineWidth = 0.7 + f * 1.1;
      c.beginPath();
      for (let x = -10; x <= W + 10; x += 12) {
        const yy = y + Math.sin(((x - t * speed) / wl) * Math.PI * 2 + k) * amp;
        if (x === -10) c.moveTo(x, yy);
        else c.lineTo(x, yy);
      }
      c.stroke();

      // moon glitter
      for (let i = -6; i <= 6; i++) {
        const fall = 1 - Math.abs(i) / 7;
        const gx = mx + i * (5 + f * 11) + Math.sin(t * 1.3 + k * 1.7 + i) * (2 + f * 4);
        const len = (8 + f * 34) * fall;
        c.strokeStyle = `rgba(255,243,212,${(0.5 * fall * (0.35 + 0.65 * Math.abs(Math.sin(t * 1.9 + k + i * 2))) * moonA).toFixed(3)})`;
        c.lineWidth = 1 + f;
        c.beginPath();
        c.moveTo(gx - len / 2, y);
        c.lineTo(gx + len / 2, y);
        c.stroke();
      }
    }

    // star reflections
    for (const s of userStars) {
      const x = s.nx * W;
      const y = horizon + (horizon - s.ny * horizon) * 0.5;
      c.fillStyle = `rgba(255,240,200,${(0.22 + 0.2 * Math.sin(t * 2.4 + x)).toFixed(3)})`;
      c.fillRect(x - 5 - Math.sin(t * 1.5 + x) * 2, y, 10, 1.4);
    }

    /* boats: reflections, ripples, then boats far → near */
    const sorted = [...boats].sort((a, b) => boatPose(a).y - boatPose(b).y);
    sorted.forEach((b) => drawBoat(b, true));

    for (const r of ripples) {
      if (r.r <= 0) continue;
      c.strokeStyle = `rgba(228,210,255,${(r.a * (1 - r.r / r.max)).toFixed(3)})`;
      c.lineWidth = 1.2;
      c.beginPath();
      c.ellipse(r.x, r.y, r.r, r.r * 0.28, 0, 0, Math.PI * 2);
      c.stroke();
    }
    sorted.forEach((b) => drawBoat(b, false));

    for (const d of drops) {
      c.fillStyle = `rgba(238,228,255,${(1 - d.life / d.max).toFixed(3)})`;
      c.beginPath();
      c.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      c.fill();
    }

    /* fog */
    const fog = c.createLinearGradient(0, horizon - 36, 0, horizon + 70);
    fog.addColorStop(0, css(low, 0));
    fog.addColorStop(0.45, css(mix(low, [255, 255, 255], 0.1), 0.5));
    fog.addColorStop(1, css(low, 0));
    c.fillStyle = fog;
    c.fillRect(0, horizon - 36, W, 106);
    for (let i = 0; i < 4; i++) {
      const fx = ((hash(i + 700) * (W + 500) + t * (6 + i * 2)) % (W + 500)) - 250;
      const g = c.createRadialGradient(fx, horizon + 12, 6, fx, horizon + 12, 170);
      g.addColorStop(0, css(mix(low, [255, 255, 255], 0.15), 0.22));
      g.addColorStop(1, css(low, 0));
      c.fillStyle = g;
      c.fillRect(fx - 170, horizon - 40, 340, 110);
    }

    /* star flights */
    c.globalCompositeOperation = "lighter";
    for (const f of flights) {
      for (const p of f.trail) {
        const a = Math.max(0, 1 - p.age / 0.9);
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7 * a + 1);
        g.addColorStop(0, `rgba(255,236,180,${(0.7 * a).toFixed(3)})`);
        g.addColorStop(1, "rgba(255,236,180,0)");
        c.fillStyle = g;
        c.fillRect(p.x - 8, p.y - 8, 16, 16);
      }
      const e = smooth(f.t);
      const hx = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * f.cx + e * e * f.nx;
      const hy = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * f.cy + e * e * f.ny;
      const g = c.createRadialGradient(hx, hy, 0, hx, hy, 16);
      g.addColorStop(0, "rgba(255,246,214,1)");
      g.addColorStop(0.3, "rgba(255,226,160,0.5)");
      g.addColorStop(1, "rgba(255,226,160,0)");
      c.fillStyle = g;
      c.fillRect(hx - 16, hy - 16, 32, 32);
    }

    /* fireflies */
    for (const ff of fireflies) {
      const x = (ff.bx + Math.sin(t * ff.speed + ff.phase) * 0.04) * W + ff.ox;
      const y = horizon - 6 + ff.by * H * 0.5 + Math.sin(t * ff.speed * 1.3 + ff.phase) * 10 + ff.oy;
      const pulse = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * 1.6 + ff.phase * 3), 2);
      const g = c.createRadialGradient(x, y, 0, x, y, 11);
      g.addColorStop(0, `rgba(255,236,160,${(0.9 * pulse).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,236,160,0)");
      c.fillStyle = g;
      c.fillRect(x - 11, y - 11, 22, 22);
    }
    c.globalCompositeOperation = "source-over";

    /* foreground reeds */
    c.lineCap = "round";
    for (let i = 0; i < 22; i++) {
      const left = i < 11;
      const baseX = left ? hash(i + 900) * W * 0.15 : W - hash(i + 900) * W * 0.15;
      const height = (60 + hash(i + 950) * 110) * (H / 420);
      const lean = (left ? 1 : -1) * (6 + hash(i + 990) * 20);
      const sway = Math.sin(t * 0.8 + i * 1.7) * 6;
      const tipX = baseX + lean + sway;
      const tipY = H - height;
      c.strokeStyle = "rgba(10,5,28,0.95)";
      c.lineWidth = 2 + hash(i + 1010) * 1.4;
      c.beginPath();
      c.moveTo(baseX, H + 6);
      c.quadraticCurveTo(baseX + lean * 0.2, H - height * 0.55, tipX, tipY);
      c.stroke();
      if (i % 3 === 0) {
        c.fillStyle = "rgba(24,12,48,1)";
        c.beginPath();
        c.ellipse(tipX, tipY + 8, 3.2, 10, (lean + sway) * 0.02, 0, Math.PI * 2);
        c.fill();
      }
    }

    /* vignette */
    const vig = c.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.78);
    vig.addColorStop(0, "rgba(6,0,20,0)");
    vig.addColorStop(1, "rgba(6,0,20,0.5)");
    c.fillStyle = vig;
    c.fillRect(0, 0, W, H);
  };

  /* ── simulation ───────────────────────────────────── */
  const update = (dt: number) => {
    let changed = false;
    for (let i = boats.length - 1; i >= 0; i--) {
      const b = boats[i];
      b.u += (dt / TRAVEL_SECONDS) * (1 + b.boost);
      b.boost *= Math.exp(-dt * 0.9);
      b.ripT -= dt;
      const pose = boatPose(b);
      if (b.ripT <= 0) {
        b.ripT = 0.5 + Math.random() * 0.3;
        addRipple(pose.x - BOAT_W * 0.38 * pose.s, pose.y + 3 * pose.s, 24 + 18 * pose.s, 0.5 * pose.alpha);
      }
      if (b.u >= 1) {
        // the boat dissolves into the mist and rises as a star
        const spot = pickStarSpot();
        flights.push({
          x0: pose.x,
          y0: pose.y - 10,
          cx: (pose.x + spot.nx * W) / 2 + (Math.random() - 0.5) * 80,
          cy: Math.min(pose.y, spot.ny * horizon) - 90,
          nx: spot.nx * W,
          ny: spot.ny * horizon,
          t: 0,
          trail: [],
        });
        boats.splice(i, 1);
        changed = true;
      }
    }
    if (changed) hooks.onAfloat(boats.length);

    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      f.t += dt / 2.4;
      const e = smooth(Math.min(1, f.t));
      f.trail.push({
        x: (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * f.cx + e * e * f.nx,
        y: (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * f.cy + e * e * f.ny,
        age: 0,
      });
      f.trail.forEach((p) => (p.age += dt));
      f.trail = f.trail.filter((p) => p.age < 0.9);
      if (f.t >= 1) {
        userStars.push({ nx: f.nx / W, ny: f.ny / horizon, born: time, size: 2.1 + Math.random() * 0.8 });
        flights.splice(i, 1);
        hooks.onStar(userStars.length);
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.r += dt * r.speed;
      if (r.r >= r.max) ripples.splice(i, 1);
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life += dt;
      d.vy += 520 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.life >= d.max) drops.splice(i, 1);
    }
    for (const ff of fireflies) {
      const k = Math.exp(-dt * 1.2);
      ff.ox *= k;
      ff.oy *= k;
    }
  };

  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    const scale = reduced ? 0.35 : 1;
    time += dt * scale;
    update(dt * scale);
    drawFrame(dt * scale);
    raf = requestAnimationFrame(loop);
  };

  return {
    resize(w: number, h: number, ratio: number) {
      W = w;
      H = h;
      dpr = ratio;
      horizon = H * 0.47;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    start() {
      lastFrame = performance.now();
      raf = requestAnimationFrame(loop);
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
    setReduced(value: boolean) {
      reduced = value;
    },
    /** centre of the paper boat when it lands on the water (canvas coords) */
    getLaunchTarget() {
      return { x: W * 0.1, y: yNearOf(pendingLane()) + 5 - BOAT_H / 2 + waveOff(W * 0.1, time) };
    },
    spawnBoat(textLength: number) {
      const boat: Boat = {
        id: boatId++,
        u: 0,
        seed: Math.random(),
        palette: launchedCount % PAPERS.length,
        lane: pendingLane(),
        boost: 0,
        lines: textLength === 0 ? 0 : Math.min(4, Math.ceil(textLength / 24)),
        ripT: 0.4,
      };
      launchedCount++;
      boats.push(boat);
      hooks.onAfloat(boats.length);
      const pose = boatPose(boat);
      splash(pose.x, pose.y);
    },
    pointerMove(x: number, y: number) {
      if (y < horizon + 8) return;
      const now = performance.now();
      if (now - lastPointerRipple > 70) {
        lastPointerRipple = now;
        addRipple(x, y, 44, 0.4);
      }
      for (const b of boats) {
        const p = boatPose(b);
        if (Math.hypot(p.x - x, p.y - y) < 90 * p.s + 40) b.boost = Math.min(2.5, b.boost + 0.22);
      }
    },
    pointerDown(x: number, y: number) {
      if (y >= horizon + 8) {
        addRipple(x, y, 95, 0.6);
        addRipple(x, y, 95, 0.4, -12);
      }
      for (const ff of fireflies) {
        const fx = (ff.bx + Math.sin(time * ff.speed + ff.phase) * 0.04) * W + ff.ox;
        const fy = horizon - 6 + ff.by * H * 0.5 + ff.oy;
        const dist = Math.hypot(fx - x, fy - y);
        if (dist < 170) {
          const push = (1 - dist / 170) * 60;
          ff.ox += ((fx - x) / (dist || 1)) * push;
          ff.oy += ((fy - y) / (dist || 1)) * push;
        }
      }
      for (const b of boats) {
        const p = boatPose(b);
        if (Math.hypot(p.x - x, p.y - y) < 80) b.boost = Math.min(3, b.boost + 1.6);
      }
    },
    reset() {
      boats.length = 0;
      ripples.length = 0;
      drops.length = 0;
      flights.length = 0;
      userStars.length = 0;
      launchedCount = 0;
      hooks.onAfloat(0);
    },
  };
}

type Scene = ReturnType<typeof createRiverScene>;

/* ════════════════════════════════════════════════════════════
   THE GAME — UI, paper folding, flow
   ════════════════════════════════════════════════════════════ */
const RECT_CLIP = "polygon(0% 0%, 50% 0%, 100% 0%, 100% 50%, 100% 100%, 50% 100%, 0% 100%, 0% 50%)";
const BOAT_CLIP = "polygon(26% 58%, 50% 0%, 74% 58%, 100% 58%, 82% 100%, 50% 100%, 18% 100%, 0% 58%)";

export function WorryBoatsGame({ fullScreen = false }: { fullScreen?: boolean }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [launched, setLaunched] = useState(0);
  const [afloat, setAfloat] = useState(0);
  const [sound, setSound] = useState(false);
  const [touched, setTouched] = useState(false);
  const [paperKey, setPaperKey] = useState(0);
  const [paperHidden, setPaperHidden] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [caption, setCaption] = useState<{ id: number; text: string } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const sceneBoxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const flyerRef = useRef<HTMLDivElement>(null);
  const flyerTextRef = useRef<HTMLParagraphElement>(null);
  const creaseRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const audioRef = useRef<ReturnType<typeof createAudioEngine> | null>(null);
  const aliveRef = useRef(true);
  const captionId = useRef(0);
  const captionTimer = useRef<number | undefined>(undefined);
  const launchedRef = useRef(0);

  const showCaption = useCallback((text: string) => {
    captionId.current += 1;
    setCaption({ id: captionId.current, text });
    window.clearTimeout(captionTimer.current);
    captionTimer.current = window.setTimeout(() => setCaption(null), 4600);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    audioRef.current = createAudioEngine();
    return () => {
      aliveRef.current = false;
      window.clearTimeout(captionTimer.current);
    };
  }, []);

  /* scene lifecycle */
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = sceneBoxRef.current;
    if (!canvas || !box) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = createRiverScene(canvas, {
      reduced,
      onAfloat: (n) => setAfloat(n),
      onSplash: () => audioRef.current?.splash(),
      onStar: (n) => {
        setStars(n);
        audioRef.current?.chime(n - 1);
        if (n === 3) showCaption("A constellation is forming.");
        else if (n === 9) showCaption("Dawn is coming.");
        else showCaption("A worry became a star.");
      },
    });
    sceneRef.current = scene;

    const fit = () => {
      const w = box.clientWidth;
      const h = fullScreen ? box.clientHeight : Math.round(clamp(w * 0.6, 300, 470));
      if (!w || !h) return;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      scene.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    scene.start();
    return () => {
      observer.disconnect();
      scene.destroy();
      sceneRef.current = null;
    };
  }, [showCaption, fullScreen]);

  /* rotating placeholder */
  useEffect(() => {
    if (draft) return;
    const timer = window.setInterval(() => setPromptIndex((i) => (i + 1) % PROMPTS.length), 5500);
    return () => window.clearInterval(timer);
  }, [draft]);

  const toCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const launch = async (withWords: boolean) => {
    const scene = sceneRef.current;
    const stage = stageRef.current;
    const paper = paperRef.current;
    const flyer = flyerRef.current;
    const flyerText = flyerTextRef.current;
    const crease = creaseRef.current;
    if (!scene || busy) return;

    const text = withWords ? draft.trim() : "";
    setBusy(true);
    setTouched(true);
    audioRef.current?.crinkle();
    try {
      navigator.vibrate?.(12);
    } catch {
      /* haptics are best-effort */
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      if (!aliveRef.current) return;
      launchedRef.current += 1;
      setLaunched(launchedRef.current);
      setDraft("");
      setPaperKey((k) => k + 1);
      setPaperHidden(false);
      setBusy(false);
      showCaption(LAUNCH_LINES[launchedRef.current % LAUNCH_LINES.length]);
    };

    if (reduced || !stage || !paper || !flyer || !flyerText || !crease) {
      scene.spawnBoat(text.length);
      finish();
      return;
    }

    /* put the flyer exactly on top of the paper, then hide the paper */
    const sRect = stage.getBoundingClientRect();
    const pRect = paper.getBoundingClientRect();
    const w = pRect.width;
    const h = pRect.height;
    const left = pRect.left - sRect.left;
    const top = pRect.top - sRect.top;
    Object.assign(flyer.style, {
      display: "block",
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`,
      opacity: "1",
      transform: "none",
      clipPath: RECT_CLIP,
    });
    flyer.dataset.folded = "false";
    flyerText.textContent = text;
    flyerText.style.opacity = "1";
    crease.style.opacity = "0";
    setPaperHidden(true);

    const target = scene.getLaunchTarget();
    const dx = target.x - (left + w / 2);
    const dy = target.y - (top + h / 2);
    const finalScale = `scale(${BOAT_W / w}, ${BOAT_H / h})`;

    try {
      // 1 — fold in half
      flyerText.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards" });
      crease.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, fill: "forwards" });
      await flyer.animate(
        [{ transform: "scaleY(1)" }, { transform: "scaleY(0.55)" }],
        { duration: 380, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" },
      ).finished;

      // 2 — fold the corners into a boat
      flyer.dataset.folded = "true";
      await flyer.animate(
        [
          { transform: "scaleY(0.55)", clipPath: RECT_CLIP },
          { transform: "scale(0.6, 0.85)", clipPath: BOAT_CLIP },
        ],
        { duration: 440, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
      ).finished;

      // 3 — lift, arc and set it on the water
      await flyer.animate(
        [
          { transform: "translate(0px, 0px) scale(0.6, 0.85) rotate(0deg)", clipPath: BOAT_CLIP, offset: 0 },
          {
            transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 80}px) scale(${(0.6 + BOAT_W / w) / 2 + 0.1}, ${(0.85 + BOAT_H / h) / 2 + 0.1}) rotate(-9deg)`,
            clipPath: BOAT_CLIP,
            offset: 0.42,
          },
          { transform: `translate(${dx}px, ${dy}px) ${finalScale} rotate(-3deg)`, clipPath: BOAT_CLIP, offset: 1 },
        ],
        { duration: 900, easing: "cubic-bezier(.35,.05,.45,1)", fill: "forwards" },
      ).finished;

      if (!aliveRef.current) return;
      scene.spawnBoat(text.length);
      await flyer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" }).finished;
    } catch {
      scene.spawnBoat(text.length);
    } finally {
      flyer.getAnimations().forEach((a) => a.cancel());
      flyerText.getAnimations().forEach((a) => a.cancel());
      crease.getAnimations().forEach((a) => a.cancel());
      flyer.style.display = "none";
      finish();
    }
  };

  const addStarter = (starter: string) => {
    setDraft((prev) => {
      const next = `${prev ? `${prev} ` : ""}${starter}: `;
      return next.slice(0, MAX_CHARS);
    });
    textareaRef.current?.focus();
  };

  const clearRiver = () => {
    sceneRef.current?.reset();
    launchedRef.current = 0;
    setStars(0);
    setLaunched(0);
    setAfloat(0);
    setCaption(null);
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    audioRef.current?.setOn(next);
  };

  const hasText = draft.trim().length > 0;

  return (
    <section className={`${styles.card} ${fullScreen ? styles.fullScreenCard : ""}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Worry Boats</p>
          <h2 className={styles.title}>Fold it. Float it. Let it go.</h2>
          <p className={styles.subtitle}>
            Write the worry. It becomes a paper boat, drifts into the mist, and comes back as a star.
          </p>
        </div>
        <div className={styles.headerSide}>
          <button
            type="button"
            className={`${styles.soundBtn} ${sound ? styles.soundOn : ""}`}
            onClick={toggleSound}
            aria-pressed={sound}
            aria-label={sound ? "Turn sound off" : "Turn sound on"}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5 6 9H3v6h3l5 4V5z" />
              {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6m0-6-5 6" />}
            </svg>
            <span>{sound ? "Sound on" : "Sound off"}</span>
          </button>
          <div className={styles.stats}>
            <span key={`b${launched}`} className={`${styles.stat} ${styles.pop}`}>
              <b>{afloat}</b> afloat
            </span>
            <span key={`s${stars}`} className={`${styles.stat} ${styles.starStat} ${stars ? styles.pop : ""}`}>
              <b>{stars}</b> {stars === 1 ? "star" : "stars"}
            </span>
          </div>
        </div>
      </header>

      <div className={styles.stage} ref={stageRef}>
        <div className={styles.scene} ref={sceneBoxRef}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            role="img"
            aria-label="A moonlit river. Paper boats drift away and turn into stars."
            onPointerMove={(e) => {
              const p = toCanvasPoint(e);
              sceneRef.current?.pointerMove(p.x, p.y);
            }}
            onPointerDown={(e) => {
              const p = toCanvasPoint(e);
              setTouched(true);
              sceneRef.current?.pointerDown(p.x, p.y);
            }}
          />
          {!touched && <div className={styles.hint}>Touch the water</div>}
          <div className={styles.caption} aria-live="polite">
            {caption && (
              <p key={caption.id} className={styles.captionText}>
                {caption.text}
              </p>
            )}
          </div>
        </div>

        <div className={styles.desk}>
          <div
            key={paperKey}
            ref={paperRef}
            className={`${styles.paper} ${paperHidden ? styles.paperHidden : ""}`}
          >
            <span className={styles.tape} aria-hidden="true" />
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={draft}
              maxLength={MAX_CHARS}
              rows={4}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              data-lpignore="true"
              disabled={busy}
              aria-label="Write a worry"
              placeholder={PROMPTS[promptIndex]}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && hasText) void launch(true);
              }}
            />
            <span className={styles.counter}>
              {draft.length}/{MAX_CHARS}
            </span>
          </div>

          <div className={styles.starters} aria-label="Ways to start">
            {STARTERS.map((starter) => (
              <button key={starter} type="button" className={styles.starter} disabled={busy} onClick={() => addStarter(starter)}>
                {starter}
              </button>
            ))}
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy || !hasText} onClick={() => void launch(true)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M12 2 17 13H12V2Zm-1.5 3.5L6 13h4.5V5.5ZM3 15h18l-3 5H6l-3-5Z" />
              </svg>
              Fold &amp; launch
            </button>
            <button type="button" className={styles.soft} disabled={busy} onClick={() => void launch(false)}>
              Launch without words
            </button>
            {(launched > 0 || stars > 0) && (
              <button type="button" className={styles.ghost} disabled={busy} onClick={clearRiver}>
                Clear the river
              </button>
            )}
          </div>
          <p className={styles.privacy}>Nothing you write is saved or sent. When the boat leaves, so does the text.</p>
        </div>

        {/* the paper that folds itself into a boat */}
        <div ref={flyerRef} className={styles.flyer} data-folded="false" aria-hidden="true">
          <p ref={flyerTextRef} className={styles.flyerText} />
          <div ref={creaseRef} className={styles.crease} />
        </div>
      </div>
    </section>
  );
}