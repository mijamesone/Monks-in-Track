/**
 * Time rules (spec section E, rules 1–12).
 *
 * Every instant is an epoch-millisecond number. Durations are milliseconds.
 * Time entries are the single source of truth: totals are always derived, never stored.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export type EntryKind = 'work' | 'revision' | 'meeting' | 'break' | 'lunch';

/** Kinds that count as tracked work and may be attached to a project. */
export const TRACKED_KINDS: readonly EntryKind[] = ['work', 'revision', 'meeting'];
/** Kinds that count towards the workday but never towards tracked work. */
export const BREAK_KINDS: readonly EntryKind[] = ['break', 'lunch'];

export const isTracked = (kind: EntryKind): boolean => TRACKED_KINDS.includes(kind);
export const isBreak = (kind: EntryKind): boolean => BREAK_KINDS.includes(kind);

export interface TimeEntry {
  id: string;
  /** Required for work and revision; optional for meeting; always null for break and lunch. */
  projectId: string | null;
  /** Null means project-level time. */
  taskId: string | null;
  kind: EntryKind;
  revisionRoundId?: string | null;
  workdayId?: string | null;
  startedAt: number;
  /** Null while the timer is running. */
  endedAt: number | null;
}

export interface TaskRef {
  id: string;
  projectId: string;
  parentId: string | null;
}

export class RuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}

/** Duration of an entry; a running entry is measured up to `now`. Never negative. */
export function entryDuration(entry: Pick<TimeEntry, 'startedAt' | 'endedAt'>, now: number): number {
  const end = entry.endedAt ?? now;
  return Math.max(0, end - entry.startedAt);
}

/** Validates the shape rules that every saved entry must satisfy. Throws RuleError. */
export function validateEntry(entry: TimeEntry, tasks?: ReadonlyMap<string, TaskRef>): void {
  if (!Number.isFinite(entry.startedAt)) throw new RuleError('start_invalid', 'Start time is not a valid time.');
  if (entry.endedAt !== null && entry.endedAt <= entry.startedAt) {
    throw new RuleError('end_before_start', 'An entry must end after it starts.');
  }
  if (isBreak(entry.kind)) {
    if (entry.projectId !== null || entry.taskId !== null) {
      throw new RuleError('break_with_owner', 'Breaks and lunch belong to the workday, not to a project.');
    }
    return;
  }
  if ((entry.kind === 'work' || entry.kind === 'revision') && entry.projectId === null) {
    throw new RuleError('project_required', 'Work and revision time must belong to a project.');
  }
  if (entry.taskId !== null && entry.projectId === null) {
    throw new RuleError('project_required', 'Time on a task must also name its project.');
  }
  if (entry.kind === 'revision' && !entry.revisionRoundId) {
    throw new RuleError('revision_round_required', 'Revision time must name its revision round.');
  }
  if (entry.kind !== 'revision' && entry.revisionRoundId) {
    throw new RuleError('revision_round_unexpected', 'Only revision time can name a revision round.');
  }
  if (tasks && entry.taskId !== null) {
    const task = tasks.get(entry.taskId);
    if (!task) throw new RuleError('task_missing', 'The task for this entry does not exist.');
    if (task.projectId !== entry.projectId) {
      throw new RuleError('task_project_mismatch', 'The task belongs to a different project.');
    }
  }
}

export interface ProjectTotals {
  /** Time logged directly on the project (no task). */
  direct: number;
  /** Every tracked entry of the project, each counted once. */
  total: number;
  revision: number;
  meeting: number;
}

/** Rule 2: a project's total is the sum of its tracked entries; nothing is counted twice. */
export function projectTotals(projectId: string, entries: readonly TimeEntry[], now: number): ProjectTotals {
  const totals: ProjectTotals = { direct: 0, total: 0, revision: 0, meeting: 0 };
  for (const e of entries) {
    if (e.projectId !== projectId || !isTracked(e.kind)) continue;
    const d = entryDuration(e, now);
    totals.total += d;
    if (e.taskId === null) totals.direct += d;
    if (e.kind === 'revision') totals.revision += d;
    if (e.kind === 'meeting') totals.meeting += d;
  }
  return totals;
}

export interface TaskTotals {
  /** Time logged on this task itself. */
  own: number;
  /** Own time plus every descendant's own time. */
  total: number;
}

/**
 * Rule 2 for the task tree: total(task) = own(task) + Σ total(child).
 * Throws on a cycle in parent links.
 */
export function taskTotals(
  tasks: readonly TaskRef[],
  entries: readonly TimeEntry[],
  now: number,
): Map<string, TaskTotals> {
  const own = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const t of tasks) {
    own.set(t.id, 0);
    if (t.parentId !== null) {
      const list = children.get(t.parentId) ?? [];
      list.push(t.id);
      children.set(t.parentId, list);
    }
  }
  for (const e of entries) {
    if (e.taskId === null || !isTracked(e.kind) || !own.has(e.taskId)) continue;
    own.set(e.taskId, (own.get(e.taskId) ?? 0) + entryDuration(e, now));
  }
  const result = new Map<string, TaskTotals>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const done = result.get(id);
    if (done) return done.total;
    if (visiting.has(id)) throw new RuleError('task_cycle', 'Task parents form a loop.');
    visiting.add(id);
    let total = own.get(id) ?? 0;
    for (const child of children.get(id) ?? []) total += visit(child);
    visiting.delete(id);
    result.set(id, { own: own.get(id) ?? 0, total });
    return total;
  };
  for (const t of tasks) visit(t.id);
  return result;
}

/** All ids in the subtree rooted at `rootId`, root included. Used when moving a task with its subtasks. */
export function subtreeIds(tasks: readonly TaskRef[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.parentId === null) continue;
    const list = children.get(t.parentId) ?? [];
    list.push(t.id);
    children.set(t.parentId, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export interface EstimateComparison {
  estimate: number | null;
  actual: number;
  /** Rule 12: never below zero. */
  remaining: number | null;
  /** Positive amount over the estimate, else 0. */
  overBudget: number | null;
  /** actual − estimate, signed. */
  difference: number | null;
}

export function compareEstimate(estimateMs: number | null, actualMs: number): EstimateComparison {
  if (estimateMs === null) {
    return { estimate: null, actual: actualMs, remaining: null, overBudget: null, difference: null };
  }
  const difference = actualMs - estimateMs;
  return {
    estimate: estimateMs,
    actual: actualMs,
    remaining: Math.max(0, estimateMs - actualMs),
    overBudget: Math.max(0, difference),
    difference,
  };
}

export interface Overlap {
  a: string;
  b: string;
  from: number;
  to: number;
}

/** Pairs of entries whose time ranges intersect (shown in amber in the Time screen). */
export function findOverlaps(entries: readonly TimeEntry[], now: number): Overlap[] {
  const sorted = [...entries].sort((x, y) => x.startedAt - y.startedAt);
  const out: Overlap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const aEnd = a.endedAt ?? now;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.startedAt >= aEnd) break;
      const bEnd = b.endedAt ?? now;
      out.push({ a: a.id, b: b.id, from: b.startedAt, to: Math.min(aEnd, bEnd) });
    }
  }
  return out;
}

/** Local calendar day of an instant, as YYYY-MM-DD in the machine's time zone. */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Start of the next local day after `ts`. */
export function nextLocalMidnight(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/**
 * Rule 9: an entry stays whole and belongs to the workday it started in,
 * but daily charts draw it split at local midnight.
 */
export function splitByLocalDay(
  entry: Pick<TimeEntry, 'startedAt' | 'endedAt'>,
  now: number,
): { day: string; start: number; end: number }[] {
  const end = entry.endedAt ?? now;
  const parts: { day: string; start: number; end: number }[] = [];
  let cursor = entry.startedAt;
  while (cursor < end) {
    const boundary = Math.min(nextLocalMidnight(cursor), end);
    parts.push({ day: localDayKey(cursor), start: cursor, end: boundary });
    cursor = boundary;
  }
  return parts;
}

/** Formats a duration as "1h 05m" or "45m". Seconds are dropped. */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(Math.abs(ms) / MINUTE);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const sign = ms < 0 ? '−' : '';
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
}
