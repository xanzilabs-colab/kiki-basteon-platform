"use client";

import { Mic, Radio } from "lucide-react";
import type { MicMode } from "@/lib/buddies/audio/types";

export function MicModeSwitch({ mode, onChange, disabled }: { mode: MicMode; onChange: (mode: MicMode) => void; disabled?: boolean }) {
  return <div className="buddy-voice-modes" role="group" aria-label="Your microphone mode">
    <button type="button" aria-pressed={mode === "open"} disabled={disabled} onClick={() => onChange("open")}><Mic size={16} />Open mic</button>
    <button type="button" aria-pressed={mode === "walkie-talkie"} disabled={disabled} onClick={() => onChange("walkie-talkie")}><Radio size={16} />Walkie-talkie</button>
  </div>;
}