"use client";

import { useRef } from "react";
import { Radio } from "lucide-react";

export function HoldToTalkButton({ held, disabled, onHold }: { held: boolean; disabled: boolean; onHold: (held: boolean) => void }) {
  const pointer = useRef<number | null>(null);
  const release = () => { pointer.current = null; onHold(false); };
  return <button type="button" className="btn buddy-voice-hold" disabled={disabled} aria-pressed={held}
    onPointerDown={(event) => {
      if (disabled || pointer.current !== null || event.button !== 0) return;
      event.preventDefault(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); onHold(true);
    }}
    onPointerUp={(event) => { if (pointer.current === event.pointerId) release(); }}
    onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (!event.repeat && !disabled) onHold(true); }
      if (event.key === "Escape") release();
    }}
    onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); release(); } }}>
    <Radio size={18} />{held ? "Talking" : "Hold to talk"}
  </button>;
}