/**
 * Estimate typed at the end of a task title (Blitzit-style quick add):
 *   "Prepare slides 28 min"      → "Prepare slides", 28
 *   "Write blog post 1 hr"       → "Write blog post", 60
 *   "Email campaign 2hr 15min"   → "Email campaign", 135
 *   "Blog cover 1h30m"           → "Blog cover", 90
 * Numbers without a unit are left alone: "10 web agency in NY" keeps its title.
 */

const HOURS = '(?:h|hr|hrs|hour|hours)';
const MINS = '(?:m|min|mins|minute|minutes)';
// (?![a-z]) instead of \b so that "1h30m" works (there is no word boundary between "h" and "3").
const END = '(?![a-z])';
const TRAILING = new RegExp(
  `\\s+(?:(\\d+(?:\\.\\d+)?)\\s*${HOURS}${END}\\s*(?:(\\d+)\\s*${MINS}${END})?|(\\d+)\\s*${MINS}${END})\\s*$`,
  'i',
);

export interface ParsedTitle {
  title: string;
  estimateMinutes: number | null;
}

export function parseTitleEstimate(input: string): ParsedTitle {
  const text = input.trim();
  const m = TRAILING.exec(text);
  if (!m) return { title: text, estimateMinutes: null };
  const title = text.slice(0, m.index).trim();
  if (!title) return { title: text, estimateMinutes: null };
  let minutes = 0;
  if (m[1] !== undefined) {
    minutes += Math.round(Number(m[1]) * 60);
    if (m[2] !== undefined) minutes += Number(m[2]);
  } else if (m[3] !== undefined) {
    minutes += Number(m[3]);
  }
  if (minutes <= 0) return { title: text, estimateMinutes: null };
  return { title, estimateMinutes: minutes };
}

/** Parses an HH:MM field (estimate or time-taken input). Returns minutes or null. */
export function parseHhMm(input: string): number | null {
  const m = /^\s*(\d{1,3}):([0-5]\d)\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
