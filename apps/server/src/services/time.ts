/**
 * Time engine (spec module 3): timer, breaks, manual entries, edits, heartbeat and forgotten-timer review.
 * Every change runs in a transaction; the database's unique indexes are the last line of defence.
 */
import {
  DEFAULT_SCHEDULE,
  RuleError,
  expectedFor,
  localDayKey,
  planStart,
  planStop,
  resolveReview,
  reviewRunningTimer,
  validateEntry,
  validateNewStart,
  MINUTE,
  type EntryKind,
  type LeaveDay,
  type ReviewChoice,
  type TimeEntry,
  type TimerTarget,
} from '@monkstracker/core';
import { ConflictError, NotFoundError, type Ctx } from '../lib/context.ts';
import { mapEntry, mapTask, toTaskRef, type Entry } from './rows.ts';
import { getProjectRow, getSettings, getTask } from './structure.ts';

type Row = Record<string, unknown>;

// ───────────────────────── small state store ─────────────────────────

function getState(ctx: Ctx, key: string): string | null {
  const r = ctx.db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

function setState(ctx: Ctx, key: string, value: string | null): void {
  if (value === null) ctx.db.prepare(`DELETE FROM app_state WHERE key = ?`).run(key);
  else ctx.db.prepare(`INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

// ───────────────────────── reads ─────────────────────────

export function getEntry(ctx: Ctx, id: string): Entry {
  const r = ctx.db.prepare(`SELECT * FROM time_entries WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError('Time entry');
  return mapEntry(r);
}

export function runningTimer(ctx: Ctx): Entry | null {
  const r = ctx.db.prepare(`SELECT * FROM time_entries WHERE ended_at IS NULL AND kind IN ('work', 'revision', 'meeting')`).get() as Row | undefined;
  return r ? mapEntry(r) : null;
}

export function runningBreak(ctx: Ctx): Entry | null {
  const r = ctx.db.prepare(`SELECT * FROM time_entries WHERE ended_at IS NULL AND kind IN ('break', 'lunch')`).get() as Row | undefined;
  return r ? mapEntry(r) : null;
}

/** The workday that is open now (checked in, not checked out), if any. */
export function openWorkdayId(ctx: Ctx): string | null {
  const r = ctx.db.prepare(`SELECT id FROM workdays WHERE check_out_at IS NULL ORDER BY check_in_at DESC LIMIT 1`).get() as { id: string } | undefined;
  return r?.id ?? null;
}

export function listEntries(ctx: Ctx, range: { from: number; to: number; projectId?: string; kind?: EntryKind }): Entry[] {
  const where = ['started_at < ?', '(ended_at IS NULL OR ended_at > ?)'];
  const values: unknown[] = [range.to, range.from];
  if (range.projectId) {
    where.push('project_id = ?');
    values.push(range.projectId);
  }
  if (range.kind) {
    where.push('kind = ?');
    values.push(range.kind);
  }
  return (ctx.db.prepare(`SELECT * FROM time_entries WHERE ${where.join(' AND ')} ORDER BY started_at DESC`).all(...values) as Row[]).map(mapEntry);
}

// ───────────────────────── validation helpers ─────────────────────────

function checkTarget(ctx: Ctx, t: TimerTarget): void {
  if (t.projectId) {
    const p = getProjectRow(ctx, t.projectId);
    if (p.archivedAt !== null) throw new RuleError('project_archived', 'This project is archived.');
  }
  if (t.taskId) {
    const task = getTask(ctx, t.taskId);
    if (task.archivedAt !== null) throw new RuleError('task_archived', 'This task is archived.');
  }
  if (t.revisionRoundId) {
    const r = ctx.db.prepare(`SELECT project_id FROM revision_rounds WHERE id = ?`).get(t.revisionRoundId) as { project_id: string } | undefined;
    if (!r) throw new NotFoundError('Revision round');
    if (r.project_id !== t.projectId) throw new RuleError('revision_other_project', 'That revision round belongs to another project.');
  }
}

function taskMapFor(ctx: Ctx, entry: Pick<TimeEntry, 'taskId'>) {
  if (!entry.taskId) return undefined;
  const t = getTask(ctx, entry.taskId);
  return new Map([[t.id, toTaskRef(t)]]);
}

function insertEntry(ctx: Ctx, e: Omit<TimeEntry, 'id'>, source: string, note: string | null = null): Entry {
  const id = ctx.id();
  const full: TimeEntry = { ...e, id };
  validateEntry(full, taskMapFor(ctx, full));
  const now = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO time_entries (id, project_id, task_id, kind, revision_round_id, workday_id, started_at, ended_at, source, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, e.projectId, e.taskId, e.kind, e.revisionRoundId ?? null, e.workdayId ?? null, e.startedAt, e.endedAt, source, note, now, now);
  return getEntry(ctx, id);
}

function closeEntry(ctx: Ctx, id: string, endedAt: number): void {
  ctx.db.prepare(`UPDATE time_entries SET ended_at = ?, updated_at = ? WHERE id = ?`).run(endedAt, ctx.now(), id);
}

function interacted(ctx: Ctx, at: number): void {
  setState(ctx, 'last_interaction_at', String(at));
  setState(ctx, 'last_heartbeat_at', String(at));
}

// ───────────────────────── timer ─────────────────────────

export interface StartOptions {
  at?: number;
  /** The "Start workday now?" answer: start a workday if none is open. */
  startWorkday?: boolean;
}

/**
 * Flows 4 and 5: start or switch. A running break ends at the same instant.
 * Without an open workday this refuses with `no_workday` unless startWorkday is true.
 */
export function startTimer(ctx: Ctx, target: TimerTarget, opts: StartOptions = {}): Entry {
  if (target.kind === 'break' || target.kind === 'lunch') throw new RuleError('use_break', 'Use the break endpoints for breaks and lunch.');
  checkTarget(ctx, target);
  const at = opts.at ?? ctx.now();
  return ctx.db.transaction(() => {
    let workdayId = openWorkdayId(ctx);
    if (!workdayId) {
      if (!opts.startWorkday) throw new ConflictError('no_workday', 'No workday is running. Start your workday first?');
      workdayId = startWorkdayInternal(ctx, at);
    }
    const brk = runningBreak(ctx);
    if (brk) {
      if (at <= brk.startedAt) throw new RuleError('switch_before_start', 'Cannot start before the break started.');
      closeEntry(ctx, brk.id, at);
    }
    const running = runningTimer(ctx);
    const plan = planStart(running, target, at, workdayId);
    if (plan.close) closeEntry(ctx, plan.close.id, plan.close.endedAt);
    interacted(ctx, at);
    if (!plan.open) return running!;
    return insertEntry(ctx, plan.open, 'timer');
  })();
}

/** Pause and stop are the same operation (rule 5); resume is startTimer on the same target. */
export function stopTimer(ctx: Ctx, at?: number): Entry {
  const when = at ?? ctx.now();
  return ctx.db.transaction(() => {
    const running = runningTimer(ctx);
    const plan = planStop(running, when);
    closeEntry(ctx, plan.close!.id, plan.close!.endedAt);
    interacted(ctx, when);
    return getEntry(ctx, plan.close!.id);
  })();
}

/** Deletes the running entry ("reset a temporary timer before saving"). */
export function discardTimer(ctx: Ctx): { discarded: string } {
  const running = runningTimer(ctx);
  if (!running) throw new RuleError('nothing_running', 'No timer is running.');
  ctx.db.prepare(`DELETE FROM time_entries WHERE id = ?`).run(running.id);
  interacted(ctx, ctx.now());
  return { discarded: running.id };
}

/** Edit the start of the running timer (Clockify feature). Must not overlap the previous entry, including lunch and breaks. */
export function adjustRunningStart(ctx: Ctx, newStart: number): Entry {
  const running = runningTimer(ctx);
  if (!running) throw new RuleError('nothing_running', 'No timer is running.');
  const prev = ctx.db
    .prepare(
      `SELECT MAX(ended_at) AS e FROM time_entries
       WHERE id <> ? AND ended_at IS NOT NULL AND ended_at <= ?`,
    )
    .get(running.id, running.startedAt) as { e: number | null };
  validateNewStart(running, newStart, ctx.now(), prev.e);
  ctx.db.prepare(`UPDATE time_entries SET started_at = ?, updated_at = ? WHERE id = ?`).run(newStart, ctx.now(), running.id);
  interacted(ctx, ctx.now());
  return getEntry(ctx, running.id);
}

/** Restart a past entry's target in one click (Clockify "continue"). */
export function restartEntry(ctx: Ctx, entryId: string, opts: StartOptions = {}): Entry {
  const e = getEntry(ctx, entryId);
  if (e.kind === 'break' || e.kind === 'lunch') throw new RuleError('use_break', 'Breaks cannot be restarted as work.');
  return startTimer(ctx, { projectId: e.projectId, taskId: e.taskId, kind: e.kind, revisionRoundId: e.revisionRoundId }, opts);
}

/**
 * Completes a task (flow 6): stops its running timer if it is the one running,
 * optionally completes its open subtasks, and sets a done status.
 */
export function completeTask(ctx: Ctx, taskId: string, opts: { completeSubtasks?: boolean; at?: number } = {}) {
  const at = opts.at ?? ctx.now();
  const done = ctx.db.prepare(`SELECT id FROM statuses WHERE is_done = 1 ORDER BY sort_order LIMIT 1`).get() as { id: string } | undefined;
  if (!done) throw new RuleError('no_done_status', 'Add a status that counts as done first.');
  return ctx.db.transaction(() => {
    const running = runningTimer(ctx);
    let stopped: string | null = null;
    if (running && running.taskId === taskId && at > running.startedAt) {
      closeEntry(ctx, running.id, at);
      stopped = running.id;
    }
    const ids = [taskId];
    if (opts.completeSubtasks) {
      const all = ctx.db.prepare(`SELECT * FROM tasks WHERE project_id = (SELECT project_id FROM tasks WHERE id = ?)`).all(taskId) as Row[];
      const tasks = all.map(mapTask);
      const stack = [taskId];
      while (stack.length) {
        const id = stack.pop()!;
        for (const t of tasks) if (t.parentId === id && t.archivedAt === null) (ids.push(t.id), stack.push(t.id));
      }
    }
    const stmt = ctx.db.prepare(
      `UPDATE tasks SET status_id = ?, completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE id = ? AND status_id NOT IN (SELECT id FROM statuses WHERE is_rejected = 1)`,
    );
    for (const id of ids) stmt.run(done.id, at, at, id);
    interacted(ctx, at);
    return { completed: ids, stoppedEntryId: stopped };
  })();
}

// ───────────────────────── breaks and lunch ─────────────────────────

/** Starts a break or lunch: the running work timer stops and is remembered for "Resume". */
export function startBreak(ctx: Ctx, kind: 'break' | 'lunch', at?: number): { entry: Entry; paused: Entry | null } {
  const when = at ?? ctx.now();
  return ctx.db.transaction(() => {
    const workdayId = openWorkdayId(ctx);
    if (!workdayId) throw new ConflictError('no_workday', 'Breaks belong to a workday. Start your workday first.');
    if (runningBreak(ctx)) throw new ConflictError('break_running', 'A break is already running.');
    const running = runningTimer(ctx);
    let paused: Entry | null = null;
    if (running && when > running.startedAt) {
      closeEntry(ctx, running.id, when);
      paused = getEntry(ctx, running.id);
      setState(ctx, 'resume_target', JSON.stringify({ projectId: running.projectId, taskId: running.taskId, kind: running.kind, revisionRoundId: running.revisionRoundId }));
    } else {
      setState(ctx, 'resume_target', null);
    }
    const entry = insertEntry(ctx, { projectId: null, taskId: null, kind, workdayId, startedAt: when, endedAt: null, revisionRoundId: null }, 'timer');
    // The planned end drives the "1 minute before" alarm; it is stored so a refresh never loses it.
    const s = getSettings(ctx);
    setState(ctx, 'break_planned_end', String(when + (kind === 'lunch' ? s.lunchMinutes : s.breakMinutes) * MINUTE));
    interacted(ctx, when);
    return { entry, paused };
  })();
}

/** Ends the running break; optionally resumes the work that was paused for it. */
export function endBreak(ctx: Ctx, opts: { at?: number; resume?: boolean } = {}): { entry: Entry; resumed: Entry | null } {
  const when = opts.at ?? ctx.now();
  return ctx.db.transaction(() => {
    const brk = runningBreak(ctx);
    if (!brk) throw new RuleError('no_break', 'No break is running.');
    if (when <= brk.startedAt) throw new RuleError('stop_before_start', 'The break cannot end before it started.');
    closeEntry(ctx, brk.id, when);
    let resumed: Entry | null = null;
    const target = getState(ctx, 'resume_target');
    if (opts.resume && target) resumed = startTimer(ctx, JSON.parse(target) as TimerTarget, { at: when });
    setState(ctx, 'resume_target', null);
    setState(ctx, 'break_planned_end', null);
    interacted(ctx, when);
    return { entry: getEntry(ctx, brk.id), resumed };
  })();
}

/** Lunch flow: "+5 / +10 / +15 min" moves the planned end (and so the alarm) later. */
export function extendBreak(ctx: Ctx, minutes: number): { plannedEnd: number } {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new RuleError('extend_range', 'Extend by 1 to 120 minutes.');
  const brk = runningBreak(ctx);
  if (!brk) throw new RuleError('no_break', 'No break is running.');
  const current = Number(getState(ctx, 'break_planned_end') ?? brk.startedAt);
  const plannedEnd = Math.max(current, ctx.now()) + minutes * MINUTE;
  setState(ctx, 'break_planned_end', String(plannedEnd));
  interacted(ctx, ctx.now());
  return { plannedEnd };
}

// ───────────────────────── manual entries and edits ─────────────────────────

export interface ManualEntryInput {
  projectId: string | null;
  taskId: string | null;
  kind: EntryKind;
  revisionRoundId?: string | null;
  startedAt: number;
  endedAt: number;
  note?: string | null;
}

function workdayFor(ctx: Ctx, at: number): string | null {
  const r = ctx.db
    .prepare(`SELECT id FROM workdays WHERE check_in_at <= ? AND (check_out_at IS NULL OR check_out_at >= ?) ORDER BY check_in_at DESC LIMIT 1`)
    .get(at, at) as { id: string } | undefined;
  return r?.id ?? null;
}

/** Adds time you forgot to track. It joins whichever workday covers its start, if any. */
export function addManualEntry(ctx: Ctx, input: ManualEntryInput): Entry {
  checkTarget(ctx, { projectId: input.projectId, taskId: input.taskId, kind: input.kind, revisionRoundId: input.revisionRoundId ?? null });
  if (input.endedAt > ctx.now()) throw new RuleError('end_in_future', 'A manual entry cannot end in the future.');
  return insertEntry(
    ctx,
    {
      projectId: input.projectId,
      taskId: input.taskId,
      kind: input.kind,
      revisionRoundId: input.revisionRoundId ?? null,
      workdayId: workdayFor(ctx, input.startedAt),
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    },
    'manual',
    input.note ?? null,
  );
}

export type EntryPatch = Partial<Pick<ManualEntryInput, 'projectId' | 'taskId' | 'kind' | 'revisionRoundId' | 'startedAt' | 'note'>> & {
  endedAt?: number | null;
};

/** Rule 11: edits are validated as a whole; totals update automatically because they are never stored. */
export function updateEntry(ctx: Ctx, id: string, patch: EntryPatch): Entry {
  const e = getEntry(ctx, id);
  const next: TimeEntry = {
    id,
    projectId: patch.projectId === undefined ? e.projectId : patch.projectId,
    taskId: patch.taskId === undefined ? e.taskId : patch.taskId,
    kind: patch.kind ?? e.kind,
    revisionRoundId: patch.revisionRoundId === undefined ? (e.revisionRoundId ?? null) : patch.revisionRoundId,
    workdayId: e.workdayId,
    startedAt: patch.startedAt ?? e.startedAt,
    endedAt: patch.endedAt === undefined ? e.endedAt : patch.endedAt,
  };
  if (e.endedAt !== null && next.endedAt === null) throw new RuleError('cannot_reopen', 'A finished entry cannot be made running again; start a timer instead.');
  if (next.endedAt !== null && next.endedAt > ctx.now()) throw new RuleError('end_in_future', 'An entry cannot end in the future.');
  if (next.endedAt === null && next.startedAt >= ctx.now()) throw new RuleError('start_in_future', 'The start time must be in the past.');
  checkTarget(ctx, next);
  validateEntry(next, taskMapFor(ctx, next));
  ctx.db
    .prepare(
      `UPDATE time_entries SET project_id = ?, task_id = ?, kind = ?, revision_round_id = ?, started_at = ?, ended_at = ?, note = ?, updated_at = ? WHERE id = ?`,
    )
    .run(next.projectId, next.taskId, next.kind, next.revisionRoundId ?? null, next.startedAt, next.endedAt, patch.note === undefined ? e.note : patch.note, ctx.now(), id);
  return getEntry(ctx, id);
}

export function deleteEntry(ctx: Ctx, id: string): { deleted: string } {
  getEntry(ctx, id);
  ctx.db.prepare(`DELETE FROM time_entries WHERE id = ?`).run(id);
  return { deleted: id };
}

/** Splits a finished entry at `at` into two entries with the same owner. */
export function splitEntry(ctx: Ctx, id: string, at: number): [Entry, Entry] {
  const e = getEntry(ctx, id);
  if (e.endedAt === null) throw new RuleError('split_running', 'Stop the timer before splitting it.');
  if (at <= e.startedAt || at >= e.endedAt) throw new RuleError('split_outside', 'The split point must be inside the entry.');
  return ctx.db.transaction(() => {
    const end = e.endedAt!;
    closeEntry(ctx, id, at);
    const second = insertEntry(
      ctx,
      { projectId: e.projectId, taskId: e.taskId, kind: e.kind, revisionRoundId: e.revisionRoundId ?? null, workdayId: e.workdayId, startedAt: at, endedAt: end },
      e.source,
      e.note,
    );
    return [getEntry(ctx, id), second] as [Entry, Entry];
  })();
}

// ───────────────────────── heartbeat and review ─────────────────────────

/** Called by the open app every 30 s; `interaction` is true after a user action. */
export function heartbeat(ctx: Ctx, interaction = false): { review: ReturnType<typeof timerReview> } {
  // Check first, so a long gap since the previous heartbeat is caught before it is overwritten.
  const review = timerReview(ctx);
  if (!review) {
    const at = ctx.now();
    setState(ctx, 'last_heartbeat_at', String(at));
    if (interaction) setState(ctx, 'last_interaction_at', String(at));
  }
  return { review };
}

export function timerReview(ctx: Ctx) {
  const s = getSettings(ctx);
  const num = (k: string) => {
    const v = getState(ctx, k);
    return v === null ? null : Number(v);
  };
  return reviewRunningTimer(runningTimer(ctx), ctx.now(), num('last_heartbeat_at'), num('last_interaction_at'), {
    heartbeatGapMs: s.heartbeatGapMinutes * MINUTE,
    forgottenAfterMs: s.forgottenTimerMinutes * MINUTE,
  });
}

/** Applies the answer to the forgotten-timer review. */
export function resolveTimerReview(ctx: Ctx, choice: ReviewChoice) {
  const running = runningTimer(ctx);
  const review = timerReview(ctx);
  if (!running || !review) throw new RuleError('no_review', 'Nothing needs reviewing.');
  const end = resolveReview(running, review, choice);
  if (end !== null && end > ctx.now()) throw new RuleError('end_in_future', 'An entry cannot end in the future.');
  ctx.db.transaction(() => {
    if (end !== null) {
      closeEntry(ctx, running.id, end);
      ctx.db.prepare(`UPDATE time_entries SET source = 'review' WHERE id = ?`).run(running.id);
    }
    interacted(ctx, ctx.now());
  })();
  return getEntry(ctx, running.id);
}

// ───────────────────────── workday bootstrap (used by the timer) ─────────────────────────

export function leaveDays(ctx: Ctx): LeaveDay[] {
  return (ctx.db.prepare(`SELECT date, type, half_day FROM leave_days`).all() as Row[]).map((r) => ({
    date: String(r.date),
    type: String(r.type) as LeaveDay['type'],
    halfDay: r.half_day === 1,
  }));
}

/** Inserts a workday row for the check-in instant. Throws if that date already has one. */
export function startWorkdayInternal(ctx: Ctx, checkInAt: number): string {
  const date = localDayKey(checkInAt);
  const existing = ctx.db.prepare(`SELECT id, check_out_at FROM workdays WHERE date = ?`).get(date) as
    | { id: string; check_out_at: number | null }
    | undefined;
  if (existing) {
    if (existing.check_out_at === null) return existing.id;
    throw new ConflictError('workday_ended', 'Today’s workday has already ended. Reopen it to continue.');
  }
  const s = getSettings(ctx);
  const expected = expectedFor(date, leaveDays(ctx), {
    ...DEFAULT_SCHEDULE,
    workingDays: s.workingDays,
    fullDayMs: s.fullDayMinutes * MINUTE,
    halfDayMs: s.halfDayMinutes * MINUTE,
  });
  const id = ctx.id();
  ctx.db
    .prepare(`INSERT INTO workdays (id, date, check_in_at, expected_minutes) VALUES (?, ?, ?, ?)`)
    .run(id, date, checkInAt, Math.round(expected / MINUTE));
  return id;
}

export const _internals = { getState, setState };

// ───────────────────────── timer state for the app ─────────────────────────

/** Names the app needs to label an entry (project, task, company, Huly link, estimate). */
export function entryContext(ctx: Ctx, e: Entry | null) {
  if (!e) return null;
  const project = e.projectId
    ? (ctx.db.prepare(`SELECT id, name, report_name, company_id, huly_url FROM projects WHERE id = ?`).get(e.projectId) as Row | undefined)
    : undefined;
  const task = e.taskId
    ? (ctx.db.prepare(`SELECT id, name, huly_url, huly_key, estimate_minutes FROM tasks WHERE id = ?`).get(e.taskId) as Row | undefined)
    : undefined;
  const round = e.revisionRoundId
    ? (ctx.db.prepare(`SELECT number, title FROM revision_rounds WHERE id = ?`).get(e.revisionRoundId) as Row | undefined)
    : undefined;
  return {
    projectName: project ? String(project.name) : null,
    companyId: project ? String(project.company_id) : null,
    taskName: task ? String(task.name) : null,
    hulyKey: task?.huly_key ? String(task.huly_key) : null,
    hulyUrl: task?.huly_url ? String(task.huly_url) : project?.huly_url ? String(project.huly_url) : null,
    estimateMinutes: task?.estimate_minutes === null || task?.estimate_minutes === undefined ? null : Number(task.estimate_minutes),
    revision: round ? { number: Number(round.number), title: String(round.title) } : null,
    /** Time already spent on this task before the running entry, for the estimate countdown. */
    priorMs: e.taskId
      ? Number(
          (ctx.db
            .prepare(`SELECT COALESCE(SUM(ended_at - started_at), 0) AS ms FROM time_entries WHERE task_id = ? AND ended_at IS NOT NULL AND id <> ? AND kind IN ('work', 'revision', 'meeting')`)
            .get(e.taskId, e.id) as { ms: number }).ms,
        )
      : 0,
  };
}

/** Everything the timer bar shows in one call. */
export function timerState(ctx: Ctx) {
  const running = runningTimer(ctx);
  const brk = runningBreak(ctx);
  const last = running
    ? null
    : ((ctx.db
        .prepare(`SELECT * FROM time_entries WHERE ended_at IS NOT NULL AND kind IN ('work', 'revision', 'meeting') ORDER BY ended_at DESC LIMIT 1`)
        .get() as Row | undefined) ?? null);
  const lastEntry = last ? mapEntry(last) : null;
  const workdayId = openWorkdayId(ctx);
  const resume = getState(ctx, 'resume_target');
  const resumeTarget = resume ? (JSON.parse(resume) as TimerTarget) : null;
  return {
    now: ctx.now(),
    running,
    runningContext: entryContext(ctx, running),
    break: brk,
    breakPlannedEnd: brk ? Number(getState(ctx, 'break_planned_end') ?? 0) || null : null,
    /** What "Back to work" will resume, if anything. */
    resumeContext: brk && resumeTarget ? entryContext(ctx, { id: '', projectId: resumeTarget.projectId, taskId: resumeTarget.taskId, kind: resumeTarget.kind, revisionRoundId: resumeTarget.revisionRoundId ?? null, workdayId: null, startedAt: 0, endedAt: 0, source: 'timer', note: null, meetingId: null }) : null,
    /** Lunch already taken in the open workday (the reminders stop). */
    lunchTaken: workdayId ? !!ctx.db.prepare(`SELECT 1 FROM time_entries WHERE workday_id = ? AND kind = 'lunch'`).get(workdayId) : false,
    lastStopped: lastEntry,
    lastStoppedContext: entryContext(ctx, lastEntry),
    review: timerReview(ctx),
    workdayId,
  };
}
