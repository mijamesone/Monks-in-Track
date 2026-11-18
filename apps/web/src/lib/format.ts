export const MINUTE = 60_000;

/** 00:42:10 */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}

/** 1h 05m · 45m */
export function duration(ms: number): string {
  const total = Math.floor(Math.abs(ms) / MINUTE);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const sign = ms < 0 ? '−' : '';
  return h ? `${sign}${h}h ${String(m).padStart(2, '0')}m` : `${sign}${m}m`;
}

/** +30m · −1h 05m */
export function signedMinutes(min: number): string {
  if (min === 0) return '0m';
  return `${min > 0 ? '+' : '−'}${duration(Math.abs(min) * MINUTE)}`;
}

/** 09:04 */
export function timeOfDay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function greeting(now: number): string {
  const h = new Date(now).getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function longDate(now: number): string {
  return new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
