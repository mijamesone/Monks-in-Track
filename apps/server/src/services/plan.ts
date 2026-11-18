/**
 * Plan board moves (spec screen 2) and the Dashboard's extra cards (spec screen 1, cards A–K).
 */
import { RuleError, findOverlaps, localDayKey, MINUTE } from '@monkstracker/core';
import type { Ctx } from '../lib/context.ts';
import { mapEntry, mapTask, type Task } from './rows.ts';
import { getTask, listBucket, listStatuses, openSubtaskIds } from './structure.ts';

type Row = Record<string, unknown>;
export type Bucket = 'backlog' | 'this_week' | 'today';

/**
 * Moves one or more tasks into a column, keeping their order: right before `beforeTaskId`, or at `index`
 * (0 = top), or at the end. Prefer `beforeTaskId`: the board hides some tasks (e.g. finished earlier),
 * so a position counted on screen would not match the stored column.
 * `withSubtasks` also moves each task's open subtasks right after it (the board asks first).
 * The whole column is renumbered, so the order you see is exactly the order stored.
 */
export function movePlan(ctx: Ctx, input: { taskIds: string[]; bucket: Bucket; index?: number; beforeTaskId?: string | null; withSubtasks?: boolean }) {
  if (!input.taskIds.length) throw new RuleError('nothing_to_move', 'Choose at least one task.');
  return ctx.db.transaction(() => {
    const moving: string[] = [];
    for (const id of input.taskIds) {
      const t = getTask(ctx, id);
      if (t.archivedAt !== null) throw new RuleError('task_archived', 'An archived task cannot be planned.');
      if (!moving.includes(id)) moving.push(id);
      if (input.withSubtasks) for (const sub of openSubtaskIds(ctx, id)) if (!moving.includes(sub)) moving.push(sub);
    }
    const column = (ctx.db.prepare(`SELECT id FROM tasks WHERE plan_bucket = ? AND archived_at IS NULL ORDER BY sort_order`).all(input.bucket) as { id: string }[])
      .map((r) => r.id)
      .filter((id) => !moving.includes(id));
    const anchor = input.beforeTaskId ? column.indexOf(input.beforeTaskId) : -1;
    const at = anchor >= 0 ? anchor : Math.max(0, Math.min(input.index ?? column.length, column.length));
    const order = [...column.slice(0, at), ...moving, ...column.slice(at)];
    const now = ctx.now();
    const set = ctx.db.prepare(`UPDATE tasks SET plan_bucket = ?, sort_order = ?, updated_at = CASE WHEN id IN (${moving.map(() => '?').join(', ')}) THEN ? ELSE updated_at END WHERE id = ?`);
    order.forEach((id, i) => set.run(input.bucket, i + 1, ...moving, now, id));
    return listBucket(ctx, input.bucket);
  })();
}

/** Everything the Plan board shows, in one request: the three columns plus parent names for subtasks. */
export function planBoard(ctx: Ctx, companyId?: string) {
  const statuses = listStatuses(ctx);
  const done = new Set(statuses.filter((s) => s.isDone).map((s) => s.id));
  const rejected = new Set(statuses.filter((s) => s.isRejected).map((s) => s.id));
  const startOfToday = new Date(new Date(ctx.now()).setHours(0, 0, 0, 0)).getTime();
  // Done tasks stay visible only in Today and only on the day they were finished; rejected tasks never show.
  const keep = (t: Task, bucket: Bucket) => !rejected.has(t.statusId) && (!done.has(t.statusId) || (bucket === 'today' && (t.completedAt ?? 0) >= startOfToday));
  const columns = {
    backlog: listBucket(ctx, 'backlog', companyId).filter((t) => keep(t, 'backlog')),
    this_week: listBucket(ctx, 'this_week', companyId).filter((t) => keep(t, 'this_week')),
    today: listBucket(ctx, 'today', companyId).filter((t) => keep(t, 'today')),
  };
  const parentIds = [...new Set(Object.values(columns).flatMap((c) => c.map((t) => t.parentId)).filter((x): x is string => !!x))];
  const parents: Record<string, string> = {};
  for (const id of parentIds) {
    const r = ctx.db.prepare(`SELECT name FROM tasks WHERE id = ?`).get(id) as { name: string } | undefined;
    if (r) parents[id] = r.name;
  }
  const subtaskCounts: Record<string, number> = {};
  for (const t of Object.values(columns).flat()) {
    const n = openSubtaskIds(ctx, t.id).length;
    if (n) subtaskCounts[t.id] = n;
  }
  return { columns, parents, subtaskCounts };
}

/** Extra Dashboard cards: revisions due, quick switch, deadlines, completed today, alerts, productivity. */
export function dashboard(ctx: Ctx, companyId?: string) {
  const now = ctx.now();
  const startOfToday = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  const d = new Date(startOfToday);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  const inCompany = (projectCompany: unknown) => !companyId || projectCompany === companyId;
  const statuses = listStatuses(ctx);
  const closed = new Set(statuses.filter((s) => s.isDone || s.isRejected).map((s) => s.id));

  const revisionsDue = (
    ctx.db
      .prepare(
        `SELECT r.*, p.name AS project_name, p.company_id FROM revision_rounds r JOIN projects p ON p.id = r.project_id
         WHERE r.status <> 'done' AND p.archived_at IS NULL ORDER BY r.requested_at`,
      )
      .all() as Row[]
  )
    .filter((r) => inCompany(r.company_id))
    .map((r) => ({ id: String(r.id), projectId: String(r.project_id), projectName: String(r.project_name), number: Number(r.number), title: String(r.title), status: String(r.status), taskId: r.task_id ? String(r.task_id) : null }));

  // Quick switch: the last open tasks you tracked time on, most recent first.
  const recent = ctx.db
    .prepare(
      `SELECT e.task_id, MAX(e.started_at) AS last FROM time_entries e
       WHERE e.task_id IS NOT NULL AND e.kind IN ('work', 'revision', 'meeting') GROUP BY e.task_id ORDER BY last DESC LIMIT 20`,
    )
    .all() as { task_id: string; last: number }[];
  const recentTasks: (Task & { lastTrackedAt: number })[] = [];
  for (const r of recent) {
    const row = ctx.db.prepare(`SELECT t.*, p.company_id AS pc, p.archived_at AS pa FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`).get(r.task_id) as Row | undefined;
    if (!row || row.pa !== null || row.archived_at !== null || !inCompany(row.pc)) continue;
    const t = mapTask(row);
    if (closed.has(t.statusId)) continue;
    recentTasks.push({ ...t, lastTrackedAt: Number(r.last) });
    if (recentTasks.length === 5) break;
  }

  // Deadlines in the next 7 days (and overdue): open tasks by due date, active projects by deadline.
  const today = localDayKey(now);
  const in7 = localDayKey(startOfToday + 7 * 24 * 60 * MINUTE);
  const taskDeadlines = (
    ctx.db
      .prepare(
        `SELECT t.*, p.company_id AS pc, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.due_date IS NOT NULL AND t.due_date <= ? AND t.archived_at IS NULL AND p.archived_at IS NULL ORDER BY t.due_date`,
      )
      .all(in7) as Row[]
  )
    .filter((r) => inCompany(r.pc) && !closed.has(String(r.status_id)))
    .map((r) => ({ kind: 'task' as const, id: String(r.id), name: String(r.name), projectName: String(r.project_name), projectId: String(r.project_id), date: String(r.due_date), overdue: String(r.due_date) < today }));
  const projectDeadlines = (
    ctx.db.prepare(`SELECT * FROM projects WHERE deadline IS NOT NULL AND deadline <= ? AND archived_at IS NULL ORDER BY deadline`).all(in7) as Row[]
  )
    .filter((r) => inCompany(r.company_id) && !closed.has(String(r.status_id)))
    .map((r) => ({ kind: 'project' as const, id: String(r.id), name: String(r.name), projectName: String(r.name), projectId: String(r.id), date: String(r.deadline), overdue: String(r.deadline) < today }));
  const deadlines = [...taskDeadlines, ...projectDeadlines].sort((a, b) => a.date.localeCompare(b.date));

  const completedToday = (ctx.db.prepare(`SELECT t.*, p.company_id AS pc FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.completed_at >= ? ORDER BY t.completed_at`).all(startOfToday) as Row[])
    .filter((r) => inCompany(r.pc))
    .map(mapTask);

  // Productivity: tracked today and this week (company filter applies), entries overlapping today.
  const entries = (
    ctx.db
      .prepare(
        `SELECT e.*, p.company_id AS pc FROM time_entries e LEFT JOIN projects p ON p.id = e.project_id
         WHERE e.started_at < ? AND (e.ended_at IS NULL OR e.ended_at > ?)`,
      )
      .all(now + 1, monday) as Row[]
  ).map((r) => ({ e: mapEntry(r), company: r.pc }));
  const tracked = (from: number) =>
    entries
      .filter(({ e, company }) => ['work', 'revision', 'meeting'].includes(e.kind) && inCompany(company))
      .reduce((s, { e }) => s + Math.max(0, Math.min(e.endedAt ?? now, now) - Math.max(e.startedAt, from)), 0);
  const todays = entries.map(({ e }) => e).filter((e) => (e.endedAt ?? now) > startOfToday);
  const overlapsToday = findOverlaps(todays, now).length;

  const todayEstimateMinutes = listBucket(ctx, 'today', companyId)
    .filter((t) => !closed.has(t.statusId))
    .reduce((s, t) => s + (t.estimateMinutes ?? 0), 0);

  return {
    revisionsDue,
    recentTasks,
    deadlines,
    completedToday,
    productivity: { todayTrackedMs: tracked(startOfToday), weekTrackedMs: tracked(monday), completedToday: completedToday.length },
    alerts: { overlapsToday, todayEstimateMinutes, overdue: deadlines.filter((x) => x.overdue).length },
  };
}
