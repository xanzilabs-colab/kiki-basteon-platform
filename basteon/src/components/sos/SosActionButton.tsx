"use client";

import { useEffect, useState } from "react";
import { MedicalBubble } from "@/components/sos/MedicalBubble";
import { useSosGesture } from "@/hooks/useSosGesture";
import type { SosType } from "@/lib/sos/sosGesture";

type Props = {
  className?: string;
  title: string;
  children: React.ReactNode;
  onSelect: (type: SosType, source: "tap" | "hold_slide") => void;
};

export function SosActionButton({ className = "", title, children, onSelect }: Props) {
  const gesture = useSosGesture(onSelect);
  const [coach, setCoach] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("kiki-sos-hold-coach")) return;
    localStorage.setItem("kiki-sos-hold-coach", "shown");
    setCoach(true);
    const timeout = window.setTimeout(() => setCoach(false), 5_000);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <>
      <button
        type="button"
        className={`relative transition-transform active:scale-95 duration-200 focus:outline-none ${className}`}
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

      {/* Floating Coach Tooltip */}
      {coach && (
        <span
          className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-slate-900/90 text-white text-xs font-semibold backdrop-blur-md border border-white/10 shadow-xl animate-bounce"
          role="status"
        >
          Hold button for liquid options
        </span>
      )}

      {/* Fluid Bubble Interaction Modal Layer */}
      {gesture.state.phase === "holding" && gesture.anchor && (
        <MedicalBubble
          anchor={gesture.anchor}
          armed={gesture.state.armed}
          bubbleRef={gesture.bubbleRef}
        />
      )}
    </>
  );
}