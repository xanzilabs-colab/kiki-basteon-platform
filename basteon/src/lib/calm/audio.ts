import type { PhaseKind } from "./breath/engine";

let context: AudioContext | null = null;

export function unlockCalmAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  context ??= new AudioContextConstructor();
  if (context.state === "suspended") void context.resume();
  return context;
}

export function playPhaseTone(kind: PhaseKind) {
  const audioContext = unlockCalmAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const notes = kind === "topup" ? [440, 560] : [kind === "inhale" ? 320 : 520];
  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now + index * 0.13);
    if (kind === "inhale" || kind === "exhale") {
      oscillator.frequency.linearRampToValueAtTime(kind === "inhale" ? 520 : 320, now + 0.42);
    }
    gain.gain.setValueAtTime(0.0001, now + index * 0.13);
    gain.gain.exponentialRampToValueAtTime(0.035, now + index * 0.13 + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.13 + (kind === "topup" ? 0.18 : 0.44));
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now + index * 0.13);
    oscillator.stop(now + index * 0.13 + (kind === "topup" ? 0.2 : 0.46));
  });
}
