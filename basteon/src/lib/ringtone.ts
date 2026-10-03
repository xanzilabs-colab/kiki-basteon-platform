let audioContext: AudioContext | null = null;

function context() {
  audioContext ??= new AudioContext();
  return audioContext;
}

export function primeRingtone() {
  void context().resume();
}

function defaultRingtone() {
  const audio = context();
  let timer: number | undefined;
  let maximum: number | undefined;
  const ring = () => {
    [0, 0.23].forEach((offset) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.setValueAtTime(880, audio.currentTime + offset);
      gain.gain.setValueAtTime(0.001, audio.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.11, audio.currentTime + offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + offset + 0.18);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(audio.currentTime + offset);
      oscillator.stop(audio.currentTime + offset + 0.2);
    });
  };
  ring();
  timer = window.setInterval(ring, 2_200);
  const stop = () => {
    if (timer) window.clearInterval(timer);
    if (maximum) window.clearTimeout(maximum);
  };
  maximum = window.setTimeout(stop, 20_000);
  return stop;
}

export function startRingtone(url?: string | null) {
  if (url) {
    const audio = new Audio(url);
    audio.loop = true;
    audio.play().catch(() => undefined);
    let stopFallback: (() => void) | undefined;
    const fallback = window.setTimeout(() => {
      if (audio.paused) stopFallback = defaultRingtone();
    }, 400);
    let maximum: number | undefined;
    const stop = () => {
      window.clearTimeout(fallback);
      if (maximum) window.clearTimeout(maximum);
      stopFallback?.();
      audio.pause();
      audio.currentTime = 0;
    };
    maximum = window.setTimeout(stop, 20_000);
    return stop;
  }
  return defaultRingtone();
}