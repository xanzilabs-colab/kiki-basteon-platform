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