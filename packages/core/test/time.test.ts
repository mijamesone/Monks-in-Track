import { describe, expect, it } from 'vitest';
import {
  HOUR,
  MINUTE,
  RuleError,
  compareEstimate,
  findOverlaps,
  formatDuration,
  localDayKey,
  projectTotals,
  splitByLocalDay,
  subtreeIds,
  taskTotals,
  validateEntry,
  type TaskRef,
  type TimeEntry,
} from '../src/index.ts';

const T0 = new Date(2026, 10, 17, 9, 0).getTime(); // Tue 17 Nov 2026 09:00 local
let seq = 0;
const entry = (p: Partial<TimeEntry> & { startedAt: number; endedAt: number | null }): TimeEntry => ({
  id: `e${++seq}`,
  projectId: 'A',
  taskId: null,
  kind: 'work',
  revisionRoundId: null,
  workdayId: 'w1',
  ...p,
});

describe('totals (spec rule 2, acceptance criterion)', () => {
  // Project A: 1h direct, 1h on Task 1, 30m on Task 2, 45m on a subtask of Task 2.
  const tasks: TaskRef[] = [
    { id: 't1', projectId: 'A', parentId: null },
    { id: 't2', projectId: 'A', parentId: null },
    { id: 't2a', projectId: 'A', parentId: 't2' },
  ];
  const entries: TimeEntry[] = [
    entry({ startedAt: T0, endedAt: T0 + HOUR }),
    entry({ taskId: 't1', startedAt: T0 + HOUR, endedAt: T0 + 2 * HOUR }),
    entry({ taskId: 't2', startedAt: T0 + 2 * HOUR, endedAt: T0 + 2 * HOUR + 30 * MINUTE }),
    entry({ taskId: 't2a', startedAt: T0 + 3 * HOUR, endedAt: T0 + 3 * HOUR + 45 * MINUTE }),
    // Another project's time must not leak in.
    entry({ projectId: 'B', startedAt: T0 + 5 * HOUR, endedAt: T0 + 6 * HOUR }),
  ];

  it('project total is 3h 15m with 1h direct', () => {
    const t = projectTotals('A', entries, T0 + 10 * HOUR);
    expect(t.total).toBe(3 * HOUR + 15 * MINUTE);
    expect(t.direct).toBe(HOUR);
  });

  it('task 2 shows 1h 15m including its subtask, and its own time is 30m', () => {
    const t = taskTotals(tasks, entries, T0 + 10 * HOUR);
    expect(t.get('t2')).toEqual({ own: 30 * MINUTE, total: HOUR + 15 * MINUTE });
    expect(t.get('t2a')).toEqual({ own: 45 * MINUTE, total: 45 * MINUTE });
    expect(t.get('t1')).toEqual({ own: HOUR, total: HOUR });
  });

  it('project total equals direct + sum of top-level task totals (no double counting)', () => {
    const now = T0 + 10 * HOUR;
    const p = projectTotals('A', entries, now);
    const t = taskTotals(tasks, entries, now);
    const topLevel = tasks.filter((x) => x.parentId === null).reduce((s, x) => s + t.get(x.id)!.total, 0);
    expect(p.direct + topLevel).toBe(p.total);
  });

  it('a running entry counts up to now', () => {
    const running = entry({ taskId: 't1', startedAt: T0, endedAt: null });
    expect(projectTotals('A', [running], T0 + 25 * MINUTE).total).toBe(25 * MINUTE);
  });

  it('revision and meeting time are included once and broken out', () => {
    const list = [
      entry({ kind: 'revision', revisionRoundId: 'r1', startedAt: T0, endedAt: T0 + 15 * MINUTE }),
      entry({ kind: 'meeting', startedAt: T0 + HOUR, endedAt: T0 + HOUR + 30 * MINUTE }),
    ];
    const t = projectTotals('A', list, T0 + 3 * HOUR);
    expect(t).toEqual({ direct: 45 * MINUTE, total: 45 * MINUTE, revision: 15 * MINUTE, meeting: 30 * MINUTE });
  });

  it('breaks never count toward a project', () => {
    const lunch = entry({ kind: 'lunch', projectId: null, startedAt: T0, endedAt: T0 + HOUR });
    expect(projectTotals('A', [lunch], T0 + 2 * HOUR).total).toBe(0);
  });

  it('detects a cycle in task parents', () => {
    const loop: TaskRef[] = [
      { id: 'x', projectId: 'A', parentId: 'y' },
      { id: 'y', projectId: 'A', parentId: 'x' },
    ];
    expect(() => taskTotals(loop, [], T0)).toThrow(RuleError);
  });

  it('subtreeIds includes the root and all descendants', () => {
    expect(new Set(subtreeIds(tasks, 't2'))).toEqual(new Set(['t2', 't2a']));
  });
});

describe('validateEntry', () => {
  const tasks = new Map<string, TaskRef>([['t1', { id: 't1', projectId: 'A', parentId: null }]]);

  it('rejects an end before the start (acceptance criterion)', () => {
    expect(() => validateEntry(entry({ startedAt: T0, endedAt: T0 - MINUTE }))).toThrow(/end after it starts/);
    expect(() => validateEntry(entry({ startedAt: T0, endedAt: T0 }))).toThrow(RuleError);
  });

  it('requires a project for work and revision', () => {
    expect(() => validateEntry(entry({ projectId: null, startedAt: T0, endedAt: null }))).toThrow(/project/);
  });

  it('allows a meeting without a project', () => {
    expect(() => validateEntry(entry({ kind: 'meeting', projectId: null, startedAt: T0, endedAt: null }))).not.toThrow();
  });

  it('keeps breaks free of projects', () => {
    expect(() => validateEntry(entry({ kind: 'break', startedAt: T0, endedAt: null }))).toThrow(/Breaks/);
    expect(() => validateEntry(entry({ kind: 'break', projectId: null, startedAt: T0, endedAt: null }))).not.toThrow();
  });

  it('requires a revision round for revision time, and only for it', () => {
    expect(() => validateEntry(entry({ kind: 'revision', startedAt: T0, endedAt: null }))).toThrow(/revision round/);
    expect(() => validateEntry(entry({ revisionRoundId: 'r1', startedAt: T0, endedAt: null }))).toThrow(/Only revision/);
  });

  it('rejects a task from another project', () => {
    expect(() => validateEntry(entry({ projectId: 'B', taskId: 't1', startedAt: T0, endedAt: null }), tasks)).toThrow(
      /different project/,
    );
  });
});

describe('estimates (rule 12)', () => {
  it('6h estimate vs 8h actual is +2h over, 0 remaining', () => {
    expect(compareEstimate(6 * HOUR, 8 * HOUR)).toEqual({
      estimate: 6 * HOUR,
      actual: 8 * HOUR,
      remaining: 0,
      overBudget: 2 * HOUR,
      difference: 2 * HOUR,
    });
  });

  it('under estimate shows remaining time', () => {
    const c = compareEstimate(90 * MINUTE, 42 * MINUTE);
    expect(c.remaining).toBe(48 * MINUTE);
    expect(c.overBudget).toBe(0);
  });

  it('no estimate gives nulls', () => {
    expect(compareEstimate(null, HOUR).remaining).toBeNull();
  });
});

describe('overlaps', () => {
  it('finds intersecting entries, including a running one', () => {
    const a = entry({ startedAt: T0, endedAt: T0 + HOUR });
    const b = entry({ startedAt: T0 + 50 * MINUTE, endedAt: T0 + 2 * HOUR });
    const c = entry({ startedAt: T0 + 2 * HOUR, endedAt: null });
    const o = findOverlaps([c, b, a], T0 + 3 * HOUR);
    expect(o).toEqual([{ a: a.id, b: b.id, from: T0 + 50 * MINUTE, to: T0 + HOUR }]);
  });
});

describe('midnight (rule 9, acceptance criterion)', () => {
  it('a 23:30–01:10 session splits into two chart segments but stays one entry', () => {
    const start = new Date(2026, 10, 17, 23, 30).getTime();
    const end = new Date(2026, 10, 18, 1, 10).getTime();
    const parts = splitByLocalDay({ startedAt: start, endedAt: end }, end);
    expect(parts.map((p) => [p.day, (p.end - p.start) / MINUTE])).toEqual([
      ['2026-11-17', 30],
      ['2026-11-18', 70],
    ]);
    expect(localDayKey(start)).toBe('2026-11-17');
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(3 * HOUR + 15 * MINUTE)).toBe('3h 15m');
    expect(formatDuration(45 * MINUTE + 59_000)).toBe('45m');
    expect(formatDuration(HOUR + 5 * MINUTE)).toBe('1h 05m');
    expect(formatDuration(-30 * MINUTE)).toBe('−30m');
  });
});
