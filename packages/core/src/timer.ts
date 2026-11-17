/**
 * Timer transitions as pure plans (spec flows 4 and 5, rules 3–5).
 *
 * The server applies a plan inside one database transaction, so the
 * "only one running timer" rule holds even if the app crashes mid-way.
 */
import { HOUR, MINUTE, RuleError, isTracked, type EntryKind, type TimeEntry } from './time.ts';

export interface TimerTarget {
  projectId: string | null;
  taskId: string | null;
  kind: EntryKind;
  revisionRoundId?: string | null;
}

export interface TimerPlan {
  /** The running entry to close, and when. */
  close: { id: string; endedAt: number } | null;
  /** The entry to open, if any. */
  open: Omit<TimeEntry, 'id'> | null;
}

const sameTarget = (e: TimeEntry, t: TimerTarget): boolean =>
  e.projectId === t.projectId &&
  e.taskId === t.taskId &&
  e.kind === t.kind &&
  (e.revisionRoundId ?? null) === (t.revisionRoundId ?? null);

/**
 * Start (or switch to) a target at `at`.
 * Switching closes the running entry at the same instant the new one starts,
 * so there is no gap and no overlap. Starting the target that is already running is a no-op.
 */
export function planStart(
  running: TimeEntry | null,
  target: TimerTarget,
  at: number,
  workdayId: string | null,
): TimerPlan {
  if (running && sameTarget(running, target)) return { close: null, open: null };
  if (running && at <= running.startedAt) {
    throw new RuleError('switch_before_start', 'Cannot switch before the running timer started.');
  }
  return {
    close: running ? { id: running.id, endedAt: at } : null,
    open: {
      projectId: target.projectId,
      taskId: target.taskId,
      kind: target.kind,
      revisionRoundId: target.revisionRoundId ?? null,
      workdayId,
      startedAt: at,
      endedAt: null,
    },
  };
}

/** Rule 5: pause and stop both end the running entry; resume is a new start on the same target. */
export function planStop(running: TimeEntry | null, at: number): TimerPlan {
  if (!running) throw new RuleError('nothing_running', 'No timer is running.');
  if (at <= running.startedAt) {
    // A stop within the same millisecond would leave a zero-length entry: discard it instead.
    throw new RuleError('stop_before_start', 'The timer cannot stop before it started.');
  }
  return { close: { id: running.id, endedAt: at }, open: null };
}

/**
 * Edit the start time of the running timer (for when you started it late).
 * The new start must be in the past and must not overlap the previous entry.
 */
export function validateNewStart(
  running: TimeEntry,
  newStart: number,
  now: number,
  previousEnd: number | null,
): void {
  if (running.endedAt !== null) throw new RuleError('not_running', 'Only a running timer can be adjusted here.');
  if (newStart >= now) throw new RuleError('start_in_future', 'The start time must be in the past.');
  if (previousEnd !== null && newStart < previousEnd) {
    throw new RuleError('start_overlaps_previous', 'The new start overlaps the previous entry.');
  }
}

/** A running timer that only `isTracked` kinds can occupy (breaks run separately from work). */
export const occupiesTimer = (kind: EntryKind): boolean => isTracked(kind);

export interface ReliabilitySettings {
  /** Heartbeat gap that counts as unattended (sleep, closed browser). Default 5 min. */
  heartbeatGapMs: number;
  /** Running without interaction for this long is flagged. Default 3 h. */
  forgottenAfterMs: number;
}

export const DEFAULT_RELIABILITY: ReliabilitySettings = {
  heartbeatGapMs: 5 * MINUTE,
  forgottenAfterMs: 3 * HOUR,
};

export type ReviewReason = 'unattended_gap' | 'long_running';

export interface TimerReview {
  reason: ReviewReason;
  entryId: string;
  /** The last moment we know you were there. "Keep until" defaults to this. */
  lastSeenAt: number;
  unattendedMs: number;
}

/**
 * Decides whether the running timer needs a forgotten-timer review.
 * `lastHeartbeatAt` comes from the open app page; `lastInteractionAt` from any user action.
 */
export function reviewRunningTimer(
  running: TimeEntry | null,
  now: number,
  lastHeartbeatAt: number | null,
  lastInteractionAt: number | null,
  settings: ReliabilitySettings = DEFAULT_RELIABILITY,
): TimerReview | null {
  if (!running || running.endedAt !== null) return null;
  const heartbeat = Math.max(lastHeartbeatAt ?? running.startedAt, running.startedAt);
  if (now - heartbeat > settings.heartbeatGapMs) {
    return { reason: 'unattended_gap', entryId: running.id, lastSeenAt: heartbeat, unattendedMs: now - heartbeat };
  }
  const interaction = Math.max(lastInteractionAt ?? running.startedAt, running.startedAt);
  if (now - interaction > settings.forgottenAfterMs) {
    return { reason: 'long_running', entryId: running.id, lastSeenAt: interaction, unattendedMs: now - interaction };
  }
  return null;
}

export type ReviewChoice =
  | { action: 'keep_all' }
  | { action: 'keep_until'; until: number }
  | { action: 'discard_unattended' };

/** Turns a review answer into the end time to apply (null = keep running). */
export function resolveReview(running: TimeEntry, review: TimerReview, choice: ReviewChoice): number | null {
  switch (choice.action) {
    case 'keep_all':
      return null;
    case 'discard_unattended':
      return review.lastSeenAt;
    case 'keep_until':
      if (choice.until <= running.startedAt) {
        throw new RuleError('end_before_start', 'An entry must end after it starts.');
      }
      return choice.until;
  }
}
