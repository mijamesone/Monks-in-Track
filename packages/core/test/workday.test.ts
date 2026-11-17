import { describe, expect, it } from 'vitest';
import {
  HOUR,
  MINUTE,
  balanceMinutes,
  expectedFor,
  overtimeNote,
  runningBalanceMinutes,
  summarizeWorkday,
  weekdayOf,
  type TimeEntry,
  type Workday,
} from '../src/index.ts';

const checkIn = new Date(2026, 10, 17, 9, 4).getTime();
const wd: Workday = { id: 'w1', date: '2026-11-17', checkInAt: checkIn, checkOutAt: checkIn + 9 * HOUR + 30 * MINUTE, expectedMs: 9 * HOUR };
const e = (kind: TimeEntry['kind'], startMin: number, lenMin: number, workdayId = 'w1'): TimeEntry => ({
  id: `${kind}${startMin}`,
  projectId: kind === 'break' || kind === 'lunch' ? null : 'A',
  taskId: null,
  kind,
  revisionRoundId: kind === 'revision' ? 'r1' : null,
  workdayId,
  startedAt: checkIn + startMin * MINUTE,
  endedAt: checkIn + (startMin + lenMin) * MINUTE,
});

describe('summarizeWorkday (rule 8, acceptance criterion)', () => {
  it('separates duration, tracked work, breaks and untracked time', () => {
    const entries = [e('work', 0, 240), e('lunch', 266, 60), e('revision', 326, 68), e('work', 394, 170), e('break', 564, 5), e('work', 0, 600, 'other-day')];
    const s = summarizeWorkday(wd, entries, wd.checkOutAt!);
    expect(s.durationMs).toBe(9 * HOUR + 30 * MINUTE);
    expect(s.trackedMs).toBe((240 + 68 + 170) * MINUTE);
    expect(s.breakMs).toBe(65 * MINUTE);
    expect(s.untrackedMs).toBe(s.durationMs - s.trackedMs - s.breakMs);
    expect(s.balanceMs).toBe(30 * MINUTE);
  });

  it('has no balance until checkout', () => {
    expect(summarizeWorkday({ ...wd, checkOutAt: null }, [], checkIn + HOUR).balanceMs).toBeNull();
  });
});

describe('expected hours (J1, J10, J11)', () => {
  it('17 Nov 2026 is a Tuesday', () => {
    expect(weekdayOf('2026-11-17')).toBe(2);
  });
  it('a working day expects 9 hours including lunch', () => {
    expect(expectedFor('2026-11-17', [])).toBe(9 * HOUR);
  });
  it('weekend and full leave expect nothing, so any work is overtime', () => {
    expect(expectedFor('2026-11-21', [])).toBe(0);
    expect(expectedFor('2026-11-24', [{ date: '2026-11-24', type: 'annual', halfDay: false }])).toBe(0);
  });
  it('a half day expects 4 hours', () => {
    expect(expectedFor('2026-11-24', [{ date: '2026-11-24', type: 'sick', halfDay: true }])).toBe(4 * HOUR);
  });
});

describe('balance and the overtime note', () => {
  it('reproduces your wording', () => {
    expect(overtimeNote(30)).toBe('Worked 30 mins extra today, will adjust on another office day.');
    expect(overtimeNote(75)).toBe('Worked 1 hr 15 mins extra today, will adjust on another office day.');
    expect(overtimeNote(-20)).toBe('Worked 20 mins less today, will cover it on another office day.');
  });
  it('stays silent within ±5 minutes', () => {
    expect(overtimeNote(4)).toBeNull();
    expect(overtimeNote(-4)).toBeNull();
  });
  it('rounds toward zero and sums the ledger', () => {
    expect(balanceMinutes(30 * MINUTE + 59_000)).toBe(30);
    expect(balanceMinutes(-(30 * MINUTE + 59_000))).toBe(-30);
    expect(runningBalanceMinutes([{ date: 'a', minutes: 30, reason: 'workday' }, { date: 'b', minutes: 38, reason: 'workday' }, { date: 'c', minutes: -480, reason: 'alter_leave_used' }])).toBe(-412);
  });
});
