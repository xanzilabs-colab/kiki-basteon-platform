let audioContext: AudioContext | null = null;

function getAudioContext() {
  audioContext ??= new AudioContext();
  return audioContext;
}

export async function unlockAlertSound() {
  await getAudioContext().resume();
}

export function playAlertSound() {
  try {
    const context = getAudioContext();
    if (context.state !== "running") return;

    Array.from({ length: 20 }, (_, index) => index * 0.25).forEach((delay) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + delay + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + delay);
      oscillator.stop(context.currentTime + delay + 0.18);
    });
  } catch {}
}

export function playMessageSound() {
  try {
    const context = getAudioContext();
    if (context.state !== "running") return;
    [740, 988].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.12;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  } catch {}
}

export function playTouchSound() {
  try {
    if (localStorage.getItem("basteon-sound") === "off") return;
    const context = getAudioContext();
    if (context.state !== "running") return;
    [523.25, 659.25].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.035;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.035, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.08);
    });
  } catch {}
}