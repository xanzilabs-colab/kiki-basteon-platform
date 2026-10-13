import { hapticPattern, type PhaseKind } from "./breath/engine";

export function vibratePhase(kind: PhaseKind, ms: number): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  return navigator.vibrate(hapticPattern(kind, ms)) !== false;
}
