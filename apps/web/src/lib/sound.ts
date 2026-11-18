/**
 * Short tones made with the Web Audio API: no sound files, works offline.
 * Browsers only allow sound after you have clicked or typed on the page once, so the
 * audio engine is unlocked on the first interaction of each session.
 */
let ctx: AudioContext | null = null;

function engine(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function unlockAudioOnFirstInteraction() {
  const unlock = () => {
    engine();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function tone(freq: number, start: number, length: number, volume: number) {
  const a = engine();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + length + 0.05);
}

/** A soft two-note chime for reminders. */
export function chime() {
  tone(880, 0, 0.35, 0.18);
  tone(1320, 0.18, 0.5, 0.14);
}

/** A brighter three-note alarm for "lunch ends in 1 minute". */
export function alarm() {
  tone(988, 0, 0.22, 0.28);
  tone(1319, 0.25, 0.22, 0.28);
  tone(1568, 0.5, 0.45, 0.28);
}

/** Shows a system notification if you allowed them; silent otherwise. */
export function notify(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/favicon.svg', tag: title });
  } catch {
    /* notifications unavailable */
  }
}

export async function askNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}
