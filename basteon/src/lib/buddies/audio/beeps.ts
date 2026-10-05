import { playMessageSound, unlockAlertSound } from "@/lib/alertSound";

export async function unlockVoiceBeeps() {
  await unlockAlertSound().catch(() => undefined);
}
export function voiceBeep() { playMessageSound(); }