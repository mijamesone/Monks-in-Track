/**
 * Workday module (spec flows 1 and 8): start, carry-over, Today's Focus, end with the time balance.
 */
import {
  RuleError,
  balanceMinutes,
  localDayKey,
  overtimeNote,
  runningBalanceMinutes,
  summarizeWorkday,
  MINUTE,
  type BalanceEntry,
} from '@monkstracker/core';
import { ConflictError, NotFoundError, type Ctx } from '../lib/context.ts';
import { mapEntry, mapTask, mapWorkday, type Task } from './rows.ts';
import { listBucket, listStatuses, updateTask } from './structure.ts';
import { openWorkdayId, runningBreak, runningTimer, startWorkdayInternal } from './time.ts';

type Row = Record<string, unknown>;

export function getWorkday(ctx: Ctx, id: string) {
  const r = ctx.db.prepare(`SELECT * FROM workdays WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError('Workday');
  return mapWorkday(r);
}

/** The open workday, else the most recent one dated today, else null. */
export function currentWorkday(ctx: Ctx) {
  const open = openWorkdayId(ctx);
  if (open) return getWorkday(ctx, open);
  const r = ctx.db.prepare(`SELECT * FROM workdays WHERE date = ?`).get(localDayKey(ctx.now())) as Row | undefined;
  return r ? mapWorkday(r) : null;
}

export function workdaySummary(ctx: Ctx, id: string) {
  const wd = getWorkday(ctx, id);
  const entries = (ctx.db.prepare(`SELECT * FROM time_entries WHERE workday_id = ?`).all(id) as Row[]).map(mapEntry);
  const now = ctx.now();
  const summary = summarizeWorkday(
    { id: wd.id, date: wd.date, checkInAt: wd.checkInAt, checkOutAt: wd.checkOutAt, expectedMs: wd.expectedMinutes * MINUTE },
    entries,
    now,
  );
  // Before checkout, show what the balance would be if you checked out now.
  const provisionalMs = (wd.checkOutAt ?? now) - wd.checkInAt - wd.expectedMinutes * MINUTE;
  return {
    workday: wd,
    ...summary,
    balanceTodayMinutes: balanceMinutes(summary.balanceMs ?? provisionalMs),
    runningBalanceMinutes: runningBalanceMinutes(listBalance(ctx)),
  };
}

export function listBalance(ctx: Ctx): BalanceEntry[] {
  return (ctx.db.prepare(`SELECT date, minutes, reason FROM balance_entries ORDER BY date`).all() as Row[]).map((r) => ({
    date: String(r.date),
    minutes: Number(r.minutes),
    reason: String(r.reason) as BalanceEntry['reason'],
  }));
}

function openStatusIds(ctx: Ctx): Set<string> {
  return new Set(listStatuses(ctx).filter((s) => !s.isDone && !s.isRejected).map((s) => s.id));
}

/** Flow 1 step 3: unfinished tasks still sitting in Today from before. */
export function carryOverSuggestions(ctx: Ctx): Task[] {
  const open = openStatusIds(ctx);
  return listBucket(ctx, 'today').filter((t) => open.has(t.statusId));
}

export interface StartWorkdayInput {
  checkInAt?: number;
  /** Carry-over tasks you unticked: they move to This Week. */
  dropTaskIds?: string[];
  /** Extra tasks to add to Today, in focus order (appended after the carried ones). */
  focusTaskIds?: string[];
  blocker?: string | null;
}

/** Flow 1. Check-in time defaults to now and can be set earlier. */
export function startWorkday(ctx: Ctx, input: StartWorkdayInput = {}) {
  const at = input.checkInAt ?? ctx.now();
  if (at > ctx.now()) throw new RuleError('start_in_future', 'Check-in cannot be in the future.');
  return ctx.db.transaction(() => {
    if (openWorkdayId(ctx)) throw new ConflictError('workday_running', 'A workday is already running.');
    const id = startWorkdayInternal(ctx, at);
    for (const taskId of input.dropTaskIds ?? []) updateTask(ctx, taskId, { planBucket: 'this_week' });
    for (const taskId of input.focusTaskIds ?? []) updateTask(ctx, taskId, { planBucket: 'today' });
    ctx.db.prepare(`UPDATE workdays SET morning_blocker = ? WHERE id = ?`).run(input.blocker?.trim() || null, id);
    return workdaySummary(ctx, id);
  })();
}

/** Corrects the check-in time afterwards (e.g. you started at 09:00 but opened the app at 09:07). */
export function editCheckIn(ctx: Ctx, id: string, checkInAt: number) {
  const wd = getWorkday(ctx, id);
  const first = ctx.db.prepare(`SELECT MIN(started_at) AS s FROM time_entries WHERE workday_id = ?`).get(id) as { s: number | null };
  if (first.s !== null && checkInAt > first.s) throw new RuleError('checkin_after_entries', 'Check-in must be before your first entry of the day.');
  if (wd.checkOutAt !== null && checkInAt >= wd.checkOutAt) throw new RuleError('end_before_start', 'Check-in must be before check-out.');
  ctx.db.prepare(`UPDATE workdays SET check_in_at = ? WHERE id = ?`).run(checkInAt, id);
  return workdaySummary(ctx, id);
}

export type RunningAction = { action: 'stop_now' } | { action: 'stop_at'; at: number } | { action: 'keep' };

export interface EndWorkdayInput {
  at?: number;
  /** Required when a timer is running (flow 8 step 2). */
  running?: RunningAction;
  blocker?: string | null;
}

/** Flow 8. Writes exactly one balance entry for the workday (replaced if the day is reopened and ended again). */
export function endWorkday(ctx: Ctx, input: EndWorkdayInput = {}) {
  const at = input.at ?? ctx.now();
  if (at > ctx.now()) throw new RuleError('end_in_future', 'Check-out cannot be in the future.');
  return ctx.db.transaction(() => {
    const id = openWorkdayId(ctx);
    if (!id) throw new ConflictError('no_workday', 'No workday is running.');
    const wd = getWorkday(ctx, id);
    if (at <= wd.checkInAt) throw new RuleError('end_before_start', 'Check-out must be after check-in.');

    const running = runningTimer(ctx);
    if (running) {
      if (!input.running) throw new ConflictError('timer_running', 'A timer is still running. Choose: stop now, stop at a time, or keep it running.');
      if (input.running.action !== 'keep') {
        const stopAt = input.running.action === 'stop_now' ? at : input.running.at;
        if (stopAt <= running.startedAt || stopAt > at) throw new RuleError('stop_outside', 'Stop time must be after the timer started and not after check-out.');
        ctx.db.prepare(`UPDATE time_entries SET ended_at = ?, updated_at = ? WHERE id = ?`).run(stopAt, ctx.now(), running.id);
      }
    }
    const brk = runningBreak(ctx);
    if (brk && at > brk.startedAt) ctx.db.prepare(`UPDATE time_entries SET ended_at = ?, updated_at = ? WHERE id = ?`).run(at, ctx.now(), brk.id);

    const blocker = input.blocker === undefined ? wd.morningBlocker : input.blocker?.trim() || null;
    ctx.db.prepare(`UPDATE workdays SET check_out_at = ?, evening_blocker = ? WHERE id = ?`).run(at, blocker, id);

    const summary = workdaySummary(ctx, id);
    const minutes = balanceMinutes(summary.balanceMs ?? 0);
    ctx.db.prepare(`DELETE FROM balance_entries WHERE workday_id = ? AND reason = 'workday'`).run(id);
    ctx.db
      .prepare(`INSERT INTO balance_entries (id, date, minutes, reason, workday_id, created_at) VALUES (?, ?, ?, 'workday', ?, ?)`)
      .run(ctx.id(), wd.date, minutes, id, ctx.now());
    return { ...workdaySummary(ctx, id), note: overtimeNote(minutes) };
  })();
}

/** Reopens today's ended workday (e.g. you checked out by mistake). Its balance entry is removed until it ends again. */
export function reopenWorkday(ctx: Ctx, id: string) {
  const wd = getWorkday(ctx, id);
  if (wd.checkOutAt === null) return workdaySummary(ctx, id);
  if (openWorkdayId(ctx)) throw new ConflictError('workday_running', 'Another workday is running.');
  ctx.db.transaction(() => {
    ctx.db.prepare(`UPDATE workdays SET check_out_at = NULL WHERE id = ?`).run(id);
    ctx.db.prepare(`DELETE FROM balance_entries WHERE workday_id = ? AND reason = 'workday'`).run(id);
  })();
  return workdaySummary(ctx, id);
}

/** Tasks completed during a workday (for the evening review and report). */
export function tasksCompletedIn(ctx: Ctx, workdayId: string): Task[] {
  const wd = getWorkday(ctx, workdayId);
  const end = wd.checkOutAt ?? ctx.now();
  return (ctx.db.prepare(`SELECT * FROM tasks WHERE completed_at >= ? AND completed_at <= ? ORDER BY completed_at`).all(wd.checkInAt, end) as Row[]).map(mapTask);
}

/**
 * Flow 1 steps 3–4: saves Today's Focus. `focusTaskIds` is the whole ordered Today list;
 * open Today tasks left out of it, and any `dropTaskIds`, move to This Week. Done tasks stay where they are.
 */
export function setFocus(ctx: Ctx, input: { focusTaskIds: string[]; dropTaskIds?: string[] }) {
  const open = openStatusIds(ctx);
  return ctx.db.transaction(() => {
    const keep = new Set(input.focusTaskIds);
    for (const t of listBucket(ctx, 'today')) if (open.has(t.statusId) && !keep.has(t.id)) updateTask(ctx, t.id, { planBucket: 'this_week' });
    for (const id of input.dropTaskIds ?? []) if (!keep.has(id)) updateTask(ctx, id, { planBucket: 'this_week' });
    input.focusTaskIds.forEach((id, i) => updateTask(ctx, id, { planBucket: 'today', sortOrder: i + 1 }));
    return listBucket(ctx, 'today');
  })();
}

/** Saves the morning blocker after the workday has started (Start Workday wizard, step "Blocker"). */
export function setBlocker(ctx: Ctx, id: string, which: 'morning' | 'evening', blocker: string | null) {
  getWorkday(ctx, id);
  const col = which === 'morning' ? 'morning_blocker' : 'evening_blocker';
  ctx.db.prepare(`UPDATE workdays SET ${col} = ? WHERE id = ?`).run(blocker?.trim() || null, id);
  return getWorkday(ctx, id);
}

/** Flow 8 step 3: what you did today, for the End Workday review. */
export function workdayReview(ctx: Ctx, id: string) {
  const wd = getWorkday(ctx, id);
  const end = wd.checkOutAt ?? ctx.now();
  const statuses = listStatuses(ctx);
  const done = new Set(statuses.filter((s) => s.isDone).map((s) => s.id));
  const rejected = new Set(statuses.filter((s) => s.isRejected).map((s) => s.id));
  const completed = tasksCompletedIn(ctx, id);
  const rows = ctx.db
    .prepare(
      `SELECT task_id, SUM(COALESCE(ended_at, ?) - started_at) AS ms FROM time_entries
       WHERE workday_id = ? AND task_id IS NOT NULL AND kind IN ('work', 'revision', 'meeting') GROUP BY task_id`,
    )
    .all(ctx.now(), id) as { task_id: string; ms: number }[];
  const trackedByTask = Object.fromEntries(rows.map((r) => [r.task_id, Number(r.ms)]));
  const task = (tid: string) => mapTask(ctx.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(tid) as Row);
  const inProgress = rows.map((r) => task(r.task_id)).filter((t) => !done.has(t.statusId) && !rejected.has(t.statusId));
  const worked = new Set(rows.map((r) => r.task_id));
  const unfinished = listBucket(ctx, 'today').filter((t) => !done.has(t.statusId) && !rejected.has(t.statusId) && !worked.has(t.id));
  const revisions = (
    ctx.db
      .prepare(
        `SELECT r.*, p.name AS project_name FROM revision_rounds r JOIN projects p ON p.id = r.project_id
         WHERE (r.completed_at >= ? AND r.completed_at <= ?) OR (r.requested_at >= ? AND r.requested_at <= ?) ORDER BY r.requested_at`,
      )
      .all(wd.checkInAt, end, wd.checkInAt, end) as Row[]
  ).map((r) => ({
    id: String(r.id),
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    number: Number(r.number),
    title: String(r.title),
    status: String(r.status),
    completedToday: r.completed_at !== null && Number(r.completed_at) >= wd.checkInAt && Number(r.completed_at) <= end,
  }));
  return { completed, inProgress, unfinished, revisions, trackedByTask, morningBlocker: wd.morningBlocker };
}
