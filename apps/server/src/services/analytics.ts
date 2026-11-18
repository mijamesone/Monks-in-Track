/**
 * Basic analytics (spec module 10, Phase 1): totals for a period, filtered by company, project or category.
 * Everything is computed from time entries, so the numbers always match the Time screen to the minute.
 */
import { entryDuration, isBreak, isTracked, compareEstimate, localDayKey, splitByLocalDay, MINUTE } from '@monkstracker/core';
import type { Ctx } from '../lib/context.ts';
import { mapEntry } from './rows.ts';

type Row = Record<string, unknown>;

export interface AnalyticsFilter {
  from: number;
  to: number;
  companyId?: string;
  projectId?: string;
  categoryId?: string;
  /** Matches time whose project or task carries the tag. */
  tagId?: string;
}

/** Clips an entry to the [from, to) window so a period never counts time outside it. */
function clipped(e: { startedAt: number; endedAt: number | null }, from: number, to: number, now: number): number {
  const start = Math.max(e.startedAt, from);
  const end = Math.min(e.endedAt ?? now, to);
  return Math.max(0, end - start);
}

export function analytics(ctx: Ctx, f: AnalyticsFilter) {
  const now = ctx.now();
  const rows = ctx.db
    .prepare(
      `SELECT e.*, p.company_id, p.category_id, p.name AS project_name, c.name AS company_name, cat.name AS category_name, t.name AS task_name
       FROM time_entries e
       LEFT JOIN tasks t ON t.id = e.task_id
       LEFT JOIN projects p ON p.id = e.project_id
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN categories cat ON cat.id = p.category_id
       WHERE e.started_at < ? AND (e.ended_at IS NULL OR e.ended_at > ?)`,
    )
    .all(f.to, f.from) as Row[];

  const tagged = f.tagId ? taggedIds(ctx, f.tagId) : null;
  const hasTag = (projectId: unknown, taskId: unknown) => !tagged || tagged.projects.has(String(projectId)) || tagged.tasks.has(String(taskId));
  const filtered = rows.filter((r) => {
    if (f.companyId && r.company_id !== f.companyId) return false;
    if (f.projectId && r.project_id !== f.projectId) return false;
    if (f.categoryId && r.category_id !== f.categoryId) return false;
    if (tagged && !hasTag(r.project_id, r.task_id)) return false;
    return true;
  });
  const narrowed = Boolean(f.companyId || f.projectId || f.categoryId || f.tagId);

  const add = (m: Map<string, { id: string; name: string; ms: number }>, id: string, name: string, ms: number) => {
    const cur = m.get(id) ?? { id, name, ms: 0 };
    cur.ms += ms;
    m.set(id, cur);
  };
  const byCompany = new Map<string, { id: string; name: string; ms: number }>();
  const byProject = new Map<string, { id: string; name: string; ms: number }>();
  const byCategory = new Map<string, { id: string; name: string; ms: number }>();
  const byTask = new Map<string, { id: string; name: string; ms: number; projectId: string; projectName: string }>();
  // Per local day, for the trend chart.
  const days = new Map<string, { trackedMs: number; breakMs: number }>();
  const day = (k: string) => days.get(k) ?? (days.set(k, { trackedMs: 0, breakMs: 0 }), days.get(k)!);
  const byKind: Record<string, number> = { work: 0, revision: 0, meeting: 0, break: 0, lunch: 0 };
  let trackedMs = 0;
  let breakMs = 0;

  for (const r of filtered) {
    const e = mapEntry(r);
    const ms = clipped(e, f.from, f.to, now);
    byKind[e.kind] = (byKind[e.kind] ?? 0) + ms;
    const pieces = ms <= 0 ? [] : splitByLocalDay({ startedAt: Math.max(e.startedAt, f.from), endedAt: Math.min(e.endedAt ?? now, f.to) }, now);
    if (isBreak(e.kind)) {
      if (!narrowed) {
        breakMs += ms;
        for (const p of pieces) day(p.day).breakMs += p.end - p.start;
      }
      continue;
    }
    if (!isTracked(e.kind)) continue;
    trackedMs += ms;
    for (const p of pieces) day(p.day).trackedMs += p.end - p.start;
    if (e.taskId) {
      const cur = byTask.get(e.taskId) ?? { id: e.taskId, name: String(r.task_name), ms: 0, projectId: String(e.projectId), projectName: String(r.project_name) };
      cur.ms += ms;
      byTask.set(e.taskId, cur);
    }
    if (r.company_id) add(byCompany, String(r.company_id), String(r.company_name), ms);
    if (e.projectId) add(byProject, e.projectId, String(r.project_name), ms);
    if (r.category_id) add(byCategory, String(r.category_id), String(r.category_name), ms);
  }

  // Workdays that started inside the period.
  const workdays = ctx.db.prepare(`SELECT * FROM workdays WHERE check_in_at >= ? AND check_in_at < ?`).all(f.from, f.to) as Row[];
  const workdayMs = workdays.reduce((s, w) => s + (Number(w.check_out_at ?? now) - Number(w.check_in_at)), 0);

  const done = ctx.db
    .prepare(
      `SELECT t.id, t.name, t.estimate_minutes, p.company_id, p.category_id, t.project_id, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.completed_at >= ? AND t.completed_at < ?`,
    )
    .all(f.from, f.to) as Row[];
  const matchesTask = (t: Row) =>
    (!f.companyId || t.company_id === f.companyId) &&
    (!f.projectId || t.project_id === f.projectId) &&
    (!f.categoryId || t.category_id === f.categoryId) &&
    hasTag(t.project_id, t.id);
  const doneFiltered = done.filter(matchesTask);
  // Estimate accuracy over completed tasks that had an estimate (all-time task time, each entry once).
  let estimated = 0;
  let over = 0;
  const estimateRows: { taskId: string; name: string; projectName: string; estimateMs: number; actualMs: number }[] = [];
  for (const t of doneFiltered) {
    if (t.estimate_minutes === null) continue;
    estimated++;
    const ents = (ctx.db.prepare(`SELECT * FROM time_entries WHERE task_id = ? AND kind IN ('work', 'revision', 'meeting')`).all(String(t.id)) as Row[]).map(mapEntry);
    const actual = ents.reduce((s, e) => s + entryDuration(e, now), 0);
    const estimateMs = Number(t.estimate_minutes) * MINUTE;
    if ((compareEstimate(estimateMs, actual).overBudget ?? 0) > 0) over++;
    estimateRows.push({ taskId: String(t.id), name: String(t.name), projectName: String(t.project_name), estimateMs, actualMs: actual });
  }

  // Still open in Today and This Week (the plan you have not finished).
  const closed = new Set((ctx.db.prepare(`SELECT id FROM statuses WHERE is_done = 1 OR is_rejected = 1`).all() as { id: string }[]).map((r) => r.id));
  const unfinished = (
    ctx.db
      .prepare(
        `SELECT t.id, t.status_id, p.company_id, p.category_id, t.project_id FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.plan_bucket IN ('today', 'this_week') AND t.archived_at IS NULL AND p.archived_at IS NULL`,
      )
      .all() as Row[]
  ).filter((t) => !closed.has(String(t.status_id)) && matchesTask(t)).length;

  // Daily series and the time balance trend (balance is per workday, so it ignores filters).
  const series: { date: string; trackedMs: number; breakMs: number; workdayMs: number; balanceMinutes: number | null; runningBalanceMinutes: number }[] = [];
  const fromDay = localDayKey(f.from);
  let running = Number((ctx.db.prepare(`SELECT COALESCE(SUM(minutes), 0) AS m FROM balance_entries WHERE date < ?`).get(fromDay) as { m: number }).m);
  const balanceByDay = new Map(
    (ctx.db.prepare(`SELECT date, SUM(minutes) AS m FROM balance_entries WHERE date >= ? AND date <= ? GROUP BY date`).all(fromDay, localDayKey(f.to - 1)) as { date: string; m: number }[]).map((r) => [r.date, Number(r.m)]),
  );
  const workdayByDay = new Map(workdays.map((w) => [String(w.date), Number(w.check_out_at ?? now) - Number(w.check_in_at)]));
  for (let t = f.from; t < f.to; ) {
    const d = new Date(t);
    const key = localDayKey(t);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const bal = balanceByDay.get(key) ?? null;
    running += bal ?? 0;
    series.push({
      date: key,
      trackedMs: days.get(key)?.trackedMs ?? 0,
      breakMs: days.get(key)?.breakMs ?? 0,
      workdayMs: workdayByDay.get(key) ?? 0,
      balanceMinutes: bal,
      runningBalanceMinutes: running,
    });
    t = next;
  }

  const sorted = (m: Map<string, { id: string; name: string; ms: number }>) => [...m.values()].sort((a, b) => b.ms - a.ms);
  return {
    period: { from: f.from, to: f.to },
    workdayMs: narrowed ? null : workdayMs,
    trackedMs,
    breakMs: narrowed ? null : breakMs,
    byKind,
    revisionShare: trackedMs ? byKind.revision! / trackedMs : 0,
    byCompany: sorted(byCompany),
    byProject: sorted(byProject),
    byCategory: sorted(byCategory),
    byTask: [...byTask.values()].sort((a, b) => b.ms - a.ms).slice(0, 10),
    tasksCompleted: doneFiltered.length,
    tasksUnfinished: unfinished,
    estimates: {
      withEstimate: estimated,
      overEstimate: over,
      tasks: estimateRows.sort((a, b) => b.actualMs - b.estimateMs - (a.actualMs - a.estimateMs)).slice(0, 8),
    },
    series,
  };
}

function taggedIds(ctx: Ctx, tagId: string) {
  const projects = new Set((ctx.db.prepare(`SELECT project_id AS id FROM project_tags WHERE tag_id = ?`).all(tagId) as { id: string }[]).map((r) => r.id));
  const tasks = new Set((ctx.db.prepare(`SELECT task_id AS id FROM task_tags WHERE tag_id = ?`).all(tagId) as { id: string }[]).map((r) => r.id));
  return { projects, tasks };
}
