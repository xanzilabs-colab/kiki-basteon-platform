"use client";

import { useEffect, useRef, useState } from "react";
import { MedicalBubble } from "@/components/sos/MedicalBubble";
import { useSosGesture } from "@/hooks/useSosGesture";
import type { SosType } from "@/lib/sos/sosGesture";

type Props = {
  className: string;
  title: string;
  children: React.ReactNode;
  onSelect: (type: SosType, source: "tap" | "hold_slide") => void;
};

const COACH_KEY = "kiki-sos-hold-coach";

function buzz(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* haptics are best-effort */
  }
}

export function SosActionButton({ className, title, children, onSelect }: Props) {
  const gesture = useSosGesture(onSelect);
  const [coach, setCoach] = useState(false);
  const phase = gesture.state.phase;
  const armed = gesture.state.phase === "holding" && gesture.state.armed;
  const prevPhase = useRef(phase);
  const prevArmed = useRef(armed);

  useEffect(() => {
    try {
      if (localStorage.getItem(COACH_KEY)) return;
      localStorage.setItem(COACH_KEY, "shown");
    } catch {
      return;
    }
    setCoach(true);
  }, []);

  useEffect(() => {
    if (!coach) return;
    const timeout = window.setTimeout(() => setCoach(false), 5_000);
    return () => window.clearTimeout(timeout);
  }, [coach]);

  useEffect(() => {
    if (phase === "holding") setCoach(false);
  }, [phase]);

  useEffect(() => {
    if (phase === "holding" && prevPhase.current !== "holding") buzz(12);
    prevPhase.current = phase;
  }, [phase]);

  useEffect(() => {
    if (armed && !prevArmed.current) buzz([10, 40, 18]);
    prevArmed.current = armed;
  }, [armed]);

  return (
    <>
      <style>{`
        @keyframes kikiCoachIn {
          0% { opacity: 0; transform: translateY(8px) scale(.85); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes kikiCoachDrop {
          0%, 100% { border-radius: 58% 42% 55% 45% / 48% 58% 42% 52%; transform: translateY(0) rotate(0deg); }
          50% { border-radius: 42% 58% 45% 55% / 58% 42% 58% 42%; transform: translateY(-2px) rotate(25deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .kiki-coach, .kiki-coach-drop { animation: none !important; }
        }
      `}</style>

      <button
        type="button"
        className={className}
        title={title}
        aria-label="SOS. Tap to send an emergency alert. Press and hold for more options."
        style={{ touchAction: "none", userSelect: "none", WebkitTouchCallout: "none" }}
        {...gesture.buttonProps}
        onContextMenu={gesture.onContextMenu}
        onClick={(event) => {
          if (event.detail === 0) onSelect("sos", "tap");
        }}
      >
        {children}
      </button>

      {coach && (
        <span
          className="sos-hold-coach kiki-coach"
          role="status"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px 8px 10px",
            borderRadius: 999,
            background: "linear-gradient(135deg, rgba(255,255,255,.16), rgba(255,255,255,.04)), rgba(18,18,28,.8)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            border: "1px solid rgba(255,255,255,.2)",
            boxShadow: "0 10px 28px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.25)",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: ".01em",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            animation: "kikiCoachIn .45s cubic-bezier(.34,1.56,.64,1) both",
          }}
        >
          <span
            aria-hidden="true"
            className="kiki-coach-drop"
            style={{
              width: 14,
              height: 14,
              background: "radial-gradient(circle at 32% 28%, #ffd0dc, #ff4d73 55%, #c8103c)",
              boxShadow: "0 0 10px rgba(255,77,115,.7)",
              animation: "kikiCoachDrop 2.2s ease-in-out infinite",
            }}
          />
          Hold for more options
        </span>
      )}

      {phase === "holding" && gesture.anchor && (
        <MedicalBubble anchor={gesture.anchor} armed={armed} bubbleRef={gesture.bubbleRef} />
      )}
    </>
  );
}
