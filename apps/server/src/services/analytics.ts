/**
 * Basic analytics (spec module 10, Phase 1): totals for a period, filtered by company, project or category.
 * Everything is computed from time entries, so the numbers always match the Time screen to the minute.
 */
import { entryDuration, isBreak, isTracked, compareEstimate, MINUTE } from '@monkstracker/core';
import type { Ctx } from '../lib/context.ts';
import { mapEntry } from './rows.ts';

type Row = Record<string, unknown>;

export interface AnalyticsFilter {
  from: number;
  to: number;
  companyId?: string;
  projectId?: string;
  categoryId?: string;
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
      `SELECT e.*, p.company_id, p.category_id, p.name AS project_name, c.name AS company_name, cat.name AS category_name
       FROM time_entries e
       LEFT JOIN projects p ON p.id = e.project_id
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN categories cat ON cat.id = p.category_id
       WHERE e.started_at < ? AND (e.ended_at IS NULL OR e.ended_at > ?)`,
    )
    .all(f.to, f.from) as Row[];

  const filtered = rows.filter((r) => {
    if (f.companyId && r.company_id !== f.companyId) return false;
    if (f.projectId && r.project_id !== f.projectId) return false;
    if (f.categoryId && r.category_id !== f.categoryId) return false;
    return true;
  });
  const narrowed = Boolean(f.companyId || f.projectId || f.categoryId);

  const add = (m: Map<string, { id: string; name: string; ms: number }>, id: string, name: string, ms: number) => {
    const cur = m.get(id) ?? { id, name, ms: 0 };
    cur.ms += ms;
    m.set(id, cur);
  };
  const byCompany = new Map<string, { id: string; name: string; ms: number }>();
  const byProject = new Map<string, { id: string; name: string; ms: number }>();
  const byCategory = new Map<string, { id: string; name: string; ms: number }>();
  const byKind: Record<string, number> = { work: 0, revision: 0, meeting: 0, break: 0, lunch: 0 };
  let trackedMs = 0;
  let breakMs = 0;

  for (const r of filtered) {
    const e = mapEntry(r);
    const ms = clipped(e, f.from, f.to, now);
    byKind[e.kind] = (byKind[e.kind] ?? 0) + ms;
    if (isBreak(e.kind)) {
      if (!narrowed) breakMs += ms;
      continue;
    }
    if (!isTracked(e.kind)) continue;
    trackedMs += ms;
    if (r.company_id) add(byCompany, String(r.company_id), String(r.company_name), ms);
    if (e.projectId) add(byProject, e.projectId, String(r.project_name), ms);
    if (r.category_id) add(byCategory, String(r.category_id), String(r.category_name), ms);
  }

  // Workdays that started inside the period.
  const workdays = ctx.db.prepare(`SELECT * FROM workdays WHERE check_in_at >= ? AND check_in_at < ?`).all(f.from, f.to) as Row[];
  const workdayMs = workdays.reduce((s, w) => s + (Number(w.check_out_at ?? now) - Number(w.check_in_at)), 0);

  const done = ctx.db
    .prepare(
      `SELECT t.id, t.estimate_minutes, p.company_id, p.category_id, t.project_id FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.completed_at >= ? AND t.completed_at < ?`,
    )
    .all(f.from, f.to) as Row[];
  const doneFiltered = done.filter(
    (t) => (!f.companyId || t.company_id === f.companyId) && (!f.projectId || t.project_id === f.projectId) && (!f.categoryId || t.category_id === f.categoryId),
  );
  // Estimate accuracy over completed tasks that had an estimate (all-time task time, each entry once).
  let estimated = 0;
  let over = 0;
  for (const t of doneFiltered) {
    if (t.estimate_minutes === null) continue;
    estimated++;
    const ents = (ctx.db.prepare(`SELECT * FROM time_entries WHERE task_id = ? AND kind IN ('work', 'revision', 'meeting')`).all(String(t.id)) as Row[]).map(mapEntry);
    const actual = ents.reduce((s, e) => s + entryDuration(e, now), 0);
    if ((compareEstimate(Number(t.estimate_minutes) * MINUTE, actual).overBudget ?? 0) > 0) over++;
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
    tasksCompleted: doneFiltered.length,
    estimates: { withEstimate: estimated, overEstimate: over },
  };
}
