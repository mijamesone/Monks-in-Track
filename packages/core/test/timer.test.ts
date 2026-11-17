import { describe, expect, it } from 'vitest';
import {
  HOUR,
  MINUTE,
  RuleError,
  planStart,
  planStop,
  resolveReview,
  reviewRunningTimer,
  validateNewStart,
  type TimeEntry,
} from '../src/index.ts';

const T0 = new Date(2026, 10, 17, 9, 0).getTime();
const running: TimeEntry = {
  id: 'run',
  projectId: 'A',
  taskId: 't1',
  kind: 'work',
  revisionRoundId: null,
  workdayId: 'w1',
  startedAt: T0,
  endedAt: null,
};

describe('planStart (flows 4 and 5)', () => {
  it('starts when nothing runs', () => {
    const p = planStart(null, { projectId: 'A', taskId: 't1', kind: 'work' }, T0, 'w1');
    expect(p.close).toBeNull();
    expect(p.open).toMatchObject({ projectId: 'A', taskId: 't1', startedAt: T0, endedAt: null, workdayId: 'w1' });
  });

  it('switching closes the old entry at the exact instant the new one starts', () => {
    const at = T0 + 42 * MINUTE;
    const p = planStart(running, { projectId: 'B', taskId: null, kind: 'work' }, at, 'w1');
    expect(p.close).toEqual({ id: 'run', endedAt: at });
    expect(p.open?.startedAt).toBe(at);
  });

  it('switching on to revision mode for the same task is a real switch', () => {
    const p = planStart(running, { projectId: 'A', taskId: 't1', kind: 'revision', revisionRoundId: 'r2' }, T0 + MINUTE, 'w1');
    expect(p.close).not.toBeNull();
    expect(p.open).toMatchObject({ kind: 'revision', revisionRoundId: 'r2' });
  });

  it('starting the same target again is a no-op', () => {
    expect(planStart(running, { projectId: 'A', taskId: 't1', kind: 'work' }, T0 + MINUTE, 'w1')).toEqual({
      close: null,
      open: null,
    });
  });

  it('refuses to switch at or before the running start', () => {
    expect(() => planStart(running, { projectId: 'B', taskId: null, kind: 'work' }, T0, 'w1')).toThrow(RuleError);
  });
});

describe('planStop', () => {
  it('stops the running entry', () => {
    expect(planStop(running, T0 + HOUR)).toEqual({ close: { id: 'run', endedAt: T0 + HOUR }, open: null });
  });
  it('fails when nothing runs', () => {
    expect(() => planStop(null, T0)).toThrow(/No timer/);
  });
});

describe('validateNewStart (edit start time of running timer)', () => {
  const now = T0 + HOUR;
  it('accepts an earlier start after the previous entry', () => {
    expect(() => validateNewStart(running, T0 - 10 * MINUTE, now, T0 - 30 * MINUTE)).not.toThrow();
  });
  it('rejects a start in the future', () => {
    expect(() => validateNewStart(running, now + MINUTE, now, null)).toThrow(/past/);
  });
  it('rejects overlap with the previous entry', () => {
    expect(() => validateNewStart(running, T0 - 40 * MINUTE, now, T0 - 30 * MINUTE)).toThrow(/overlaps/);
  });
});

describe('forgotten-timer review', () => {
  it('flags a heartbeat gap longer than 5 minutes (sleep, closed browser)', () => {
    const r = reviewRunningTimer(running, T0 + 4 * HOUR, T0 + HOUR, T0 + HOUR);
    expect(r).toEqual({ reason: 'unattended_gap', entryId: 'run', lastSeenAt: T0 + HOUR, unattendedMs: 3 * HOUR });
  });

  it('flags 3 hours without interaction even when the page stayed open', () => {
    const now = T0 + 3 * HOUR + MINUTE;
    const r = reviewRunningTimer(running, now, now - MINUTE, T0);
    expect(r?.reason).toBe('long_running');
  });

  it('stays quiet in normal use', () => {
    const now = T0 + 2 * HOUR;
    expect(reviewRunningTimer(running, now, now - 30_000, now - 10 * MINUTE)).toBeNull();
  });

  it('resolves choices into an end time', () => {
    const review = reviewRunningTimer(running, T0 + 4 * HOUR, T0 + HOUR, null)!;
    expect(resolveReview(running, review, { action: 'keep_all' })).toBeNull();
    expect(resolveReview(running, review, { action: 'discard_unattended' })).toBe(T0 + HOUR);
    expect(resolveReview(running, review, { action: 'keep_until', until: T0 + 2 * HOUR })).toBe(T0 + 2 * HOUR);
    expect(() => resolveReview(running, review, { action: 'keep_until', until: T0 })).toThrow(RuleError);
  });
});
