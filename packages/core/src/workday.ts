/**
 * Workday numbers and the time balance (spec rules 8 and 14, decisions J1, J10, J11).
 */
import { HOUR, MINUTE, entryDuration, isBreak, isTracked, type TimeEntry } from './time.ts';

export interface Workday {
  id: string;
  /** Local date of check-in, YYYY-MM-DD. */
  date: string;
  checkInAt: number;
  checkOutAt: number | null;
  /** Expected workday length for the balance. */
  expectedMs: number;
}

export interface WorkdaySummary {
  durationMs: number;
  trackedMs: number;
  breakMs: number;
  /** Duration − tracked − breaks, never below zero. */
  untrackedMs: number;
  /** Only once checked out: duration − expected. */
  balanceMs: number | null;
}

/** Rule 8. Entries are matched by workdayId; a running entry is measured up to `now`. */
export function summarizeWorkday(workday: Workday, entries: readonly TimeEntry[], now: number): WorkdaySummary {
  const end = workday.checkOutAt ?? now;
  const durationMs = Math.max(0, end - workday.checkInAt);
  let trackedMs = 0;
  let breakMs = 0;
  for (const e of entries) {
    if (e.workdayId !== workday.id) continue;
    const d = entryDuration(e, now);
    if (isTracked(e.kind)) trackedMs += d;
    else if (isBreak(e.kind)) breakMs += d;
  }
  return {
    durationMs,
    trackedMs,
    breakMs,
    untrackedMs: Math.max(0, durationMs - trackedMs - breakMs),
    balanceMs: workday.checkOutAt === null ? null : durationMs - workday.expectedMs,
  };
}

export type LeaveType = 'sick' | 'annual' | 'alter' | 'earned';

export interface LeaveDay {
  date: string;
  type: LeaveType;
  halfDay: boolean;
}

export interface WorkSchedule {
  /** 0 = Sunday … 6 = Saturday, as Date#getDay. Default Monday–Friday. */
  workingDays: readonly number[];
  /** J1: workday length including lunch. Default 9 h. */
  fullDayMs: number;
  /** J10: expected length on a half day of leave. Default 4 h. */
  halfDayMs: number;
}

export const DEFAULT_SCHEDULE: WorkSchedule = {
  workingDays: [1, 2, 3, 4, 5],
  fullDayMs: 9 * HOUR,
  halfDayMs: 4 * HOUR,
};

/** Day of week for a YYYY-MM-DD date, independent of time zone. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Expected workday length for a date.
 * J11: on a weekend or full leave day the expectation is 0, so any work there is all overtime.
 */
export function expectedFor(date: string, leave: readonly LeaveDay[], schedule: WorkSchedule = DEFAULT_SCHEDULE): number {
  if (!schedule.workingDays.includes(weekdayOf(date))) return 0;
  const onLeave = leave.find((l) => l.date === date);
  if (!onLeave) return schedule.fullDayMs;
  return onLeave.halfDay ? schedule.halfDayMs : 0;
}

export interface BalanceEntry {
  date: string;
  minutes: number;
  reason: 'workday' | 'alter_leave_used' | 'manual';
}

/** Running balance = sum of every balance entry. */
export function runningBalanceMinutes(entries: readonly BalanceEntry[]): number {
  return entries.reduce((sum, e) => sum + e.minutes, 0);
}

/** Rounds a balance to whole minutes toward zero, so seconds never create phantom overtime. */
export function balanceMinutes(balanceMs: number): number {
  return Math.trunc(balanceMs / MINUTE);
}

function humanMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hours = h === 1 ? '1 hr' : `${h} hrs`;
  const mins = m === 1 ? '1 min' : `${m} mins`;
  if (h === 0) return mins;
  if (m === 0) return hours;
  return `${hours} ${mins}`;
}

/**
 * The bracketed note in the evening header, in your own wording:
 * "Worked 30 mins extra today, will adjust on another office day."
 * Returns null when the balance is within ±threshold.
 */
export function overtimeNote(balanceMinutesToday: number, thresholdMinutes = 5): string | null {
  if (Math.abs(balanceMinutesToday) < thresholdMinutes) return null;
  if (balanceMinutesToday > 0) {
    return `Worked ${humanMinutes(balanceMinutesToday)} extra today, will adjust on another office day.`;
  }
  return `Worked ${humanMinutes(-balanceMinutesToday)} less today, will cover it on another office day.`;
}
