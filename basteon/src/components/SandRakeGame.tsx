"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./SandRake.module.css";

type Stone = { x: number; y: number; radius: number };

const drawStone = (ctx: CanvasRenderingContext2D, stone: Stone) => {
  ctx.beginPath();
  ctx.fillStyle = "rgba(120, 95, 137, 0.55)";
  ctx.arc(stone.x, stone.y, stone.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.arc(stone.x - stone.radius * 0.2, stone.y - stone.radius * 0.2, stone.radius * 0.45, 0, Math.PI * 2);
  ctx.fill();
};

const clampedPoint = (x: number, y: number, stone: Stone) => {
  const dx = x - stone.x;
  const dy = y - stone.y;
  const distance = Math.hypot(dx, dy);
  const minDistance = stone.radius + 12;
  if (distance < minDistance) {
    const angle = Math.atan2(dy, dx) || 0;
    return {
      x: stone.x + Math.cos(angle) * minDistance,
      y: stone.y + Math.sin(angle) * minDistance,
    };
  }
  return { x, y };
};

export function SandRakeGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [patternOn, setPatternOn] = useState(false);
  const [raking, setRaking] = useState(false);
  const [touched, setTouched] = useState(false);
  const [calm, setCalm] = useState(0);
  const [toast, setToast] = useState("");
  const [stones, setStones] = useState<Stone[]>([]);
  const prevPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastCalmUpdateRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 1_800);
  };

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    const width = 720;
    const height = 420;
    const generated: Stone[] = [];
    while (generated.length < 5) {
      const radius = 20 + Math.random() * 16;
      const x = 60 + Math.random() * (width - 120);
      const y = 60 + Math.random() * (height - 120);
      const overlaps = generated.some((stone) => Math.hypot(stone.x - x, stone.y - y) < stone.radius + radius + 24);
      if (!overlaps) generated.push({ x, y, radius });
    }
    setStones(generated);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = 720 * dpr;
    canvas.height = 420 * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = 720;
    const height = 420;
    ctx.fillStyle = "#e7d3a8";
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 700; i += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.06})`;
      ctx.fillRect(x, y, 1.2, 1.2);
    }

    for (const stone of generatedTemplate()) {
      drawStone(ctx, stone);
    }

    if (patternOn) {
      ctx.save();
      ctx.strokeStyle = "rgba(84, 63, 101, 0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 10]);
      for (let i = 1; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(60, 60 + i * 90);
        ctx.lineTo(660, 60 + i * 90);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [patternOn]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 720;
    const y = ((event.clientY - rect.top) / rect.height) * 420;
    prevPointRef.current = { x, y };
    setTouched(true);
    setRaking(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!raking) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 720;
    const y = ((event.clientY - rect.top) / rect.height) * 420;
    const now = performance.now();
    if (now - lastCalmUpdateRef.current > 140) {
      lastCalmUpdateRef.current = now;
      setCalm((value) => Math.min(100, value + 1));
    }
    const prev = prevPointRef.current;
    if (!prev) {
      prevPointRef.current = { x, y };
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let current = { x, y };
    for (const stone of stones) {
      current = clampedPoint(current.x, current.y, stone);
    }
    const adjustedPrev = { x: prev.x, y: prev.y };
    let previous = adjustedPrev;
    for (const stone of stones) {
      previous = clampedPoint(previous.x, previous.y, stone);
    }

    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = "rgba(60,40,20,0.35)";
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.moveTo(previous.x - 1, previous.y - 1);
    ctx.lineTo(current.x - 1, current.y - 1);
    ctx.stroke();

    prevPointRef.current = { x: current.x, y: current.y };
  };

  const handlePointerUp = () => {
    prevPointRef.current = null;
    setRaking(false);
  };

  const smoothSand = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#e7d3a8";
    ctx.fillRect(0, 0, 720, 420);
    for (let i = 0; i < 700; i += 1) {
      const x = Math.random() * 720;
      const y = Math.random() * 420;
      ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.06})`;
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    for (const stone of generatedTemplate()) {
      drawStone(ctx, stone);
    }
    if (patternOn) {
      ctx.strokeStyle = "rgba(84, 63, 101, 0.2)";
      ctx.setLineDash([6, 10]);
      for (let i = 1; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(60, 60 + i * 90);
        ctx.lineTo(660, 60 + i * 90);
        ctx.stroke();
      }
    }
    showToast("The sand is smooth again.");
  };

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Sand Rake</p>
          <h2 className={styles.title}>Draw gentle lines in the sand.</h2>
        </div>
        <div className={styles.calm}>
          <span>Calm settling · {calm}%</span>
          <div className={styles.calmBar} role="progressbar" aria-label="Calm settling" aria-valuemin={0} aria-valuemax={100} aria-valuenow={calm}>
            <i style={{ width: `${calm}%` }} />
          </div>
        </div>
      </header>
      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        <div className={styles.vignette} />
        {!touched && <div className={styles.hint}>Drag your fingers through the sand</div>}
        {toast && <div className={styles.toast} role="status">{toast}</div>}
      </div>
      <div className={styles.tools}>
        <div className={styles.chips}>
          <button
            type="button"
            className={`${styles.chip} ${patternOn ? styles.on : ""}`}
            aria-pressed={patternOn}
            onClick={() => {
              setPatternOn((value) => !value);
              showToast(patternOn ? "Guides hidden." : "Guides shown.");
            }}
          >
            {patternOn ? "Hide guides" : "Pattern"}
          </button>
        </div>
        <button type="button" className={styles.primary} onClick={smoothSand}>Smooth the sand</button>
      </div>
      <p className={styles.note}>The sand resets when you leave. That is the point.</p>
    </section>
  );
}

function generatedTemplate() {
  return [
    { x: 150, y: 120, radius: 26 },
    { x: 340, y: 250, radius: 32 },
    { x: 520, y: 140, radius: 24 },
    { x: 600, y: 300, radius: 30 },
    { x: 230, y: 300, radius: 22 },
  ];
}
