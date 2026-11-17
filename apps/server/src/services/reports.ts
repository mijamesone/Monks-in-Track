/**
 * Morning and evening reports from real data (spec flow 9, Appendix A1), plus report history.
 */
import {
  RuleError,
  generateEveningReport,
  generateMorningReport,
  overtimeNote,
  LUNCH_MESSAGES,
  type ReportProject,
} from '@monkstracker/core';
import { ConflictError, NotFoundError, type Ctx } from '../lib/context.ts';
import { mapEntry, mapReport, mapTask, type Task } from './rows.ts';
import { getCatalog, getProjectRow, getSettings, listBucket, listStatuses } from './structure.ts';
import { currentWorkday, getWorkday, tasksCompletedIn, workdaySummary } from './workday.ts';

type Row = Record<string, unknown>;
export type ReportType = 'morning' | 'evening' | 'lunch_start' | 'lunch_end';

function common(ctx: Ctx) {
  const cat = getCatalog(ctx);
  return {
    categories: cat.categories.filter((c) => c.archivedAt === null).map((c) => ({ id: c.id, name: c.name, order: c.reportOrder })),
    statuses: cat.statuses.map((s) => ({ id: s.id, emoji: s.emoji, reportText: s.reportText })),
    groups: (cat.reportGroups as { id: string; label: string }[]).map((g) => ({ id: g.id, label: g.label })),
    settings: cat.settings,
  };
}

/** Projects in first-appearance order of the given tasks, each with those tasks' Huly links. */
function projectLines(ctx: Ctx, tasks: readonly Task[], extraProjectIds: readonly string[] = []): ReportProject[] {
  const order: string[] = [];
  const links = new Map<string, string[]>();
  for (const t of tasks) {
    if (!order.includes(t.projectId)) order.push(t.projectId);
    if (t.hulyUrl) {
      const list = links.get(t.projectId) ?? [];
      if (!list.includes(t.hulyUrl)) list.push(t.hulyUrl);
      links.set(t.projectId, list);
    }
  }
  for (const id of extraProjectIds) if (!order.includes(id)) order.push(id);
  return order.map((id) => {
    const p = getProjectRow(ctx, id);
    return {
      id,
      reportName: p.reportName || p.name,
      categoryId: p.categoryId,
      statusId: p.statusId,
      groupId: p.reportGroupId,
      hulyUrl: p.hulyUrl,
      taskLinks: links.get(id) ?? [],
    };
  });
}

function activeWorkdayId(ctx: Ctx, workdayId?: string): string {
  if (workdayId) return getWorkday(ctx, workdayId).id;
  const wd = currentWorkday(ctx);
  if (!wd) throw new ConflictError('no_workday', 'Start your workday to generate a report.');
  return wd.id;
}

/** Morning: projects of the tasks in Today (focus order), with focus tasks' Huly links (decision R5). */
export function buildMorningReport(ctx: Ctx, opts: { workdayId?: string; blocker?: string } = {}): { workdayId: string; text: string } {
  const workdayId = activeWorkdayId(ctx, opts.workdayId);
  const wd = getWorkday(ctx, workdayId);
  const c = common(ctx);
  const open = new Set(listStatuses(ctx).filter((s) => !s.isRejected).map((s) => s.id));
  const focus = listBucket(ctx, 'today').filter((t) => open.has(t.statusId));
  const text = generateMorningReport({
    categories: c.categories,
    statuses: c.statuses,
    groups: c.groups,
    projects: projectLines(ctx, focus),
    blocker: opts.blocker ?? wd.morningBlocker ?? 'None',
    includeFocusLine: c.settings.report.includeFocusLine,
    mergeGroups: c.settings.report.mergeGroups,
  });
  return { workdayId, text };
}

/**
 * Evening (decision J3): projects you tracked time on today plus Today's Focus projects;
 * links are the tasks you worked on or completed today. Header note from the time balance.
 */
export function buildEveningReport(ctx: Ctx, opts: { workdayId?: string; blocker?: string; includeNote?: boolean } = {}) {
  const workdayId = activeWorkdayId(ctx, opts.workdayId);
  const wd = getWorkday(ctx, workdayId);
  const c = common(ctx);
  const entries = (ctx.db.prepare(`SELECT * FROM time_entries WHERE workday_id = ? AND kind IN ('work', 'revision', 'meeting') ORDER BY started_at`).all(workdayId) as Row[]).map(mapEntry);
  const workedTaskIds = [...new Set(entries.map((e) => e.taskId).filter((x): x is string => !!x))];
  const worked = workedTaskIds.map((id) => mapTask(ctx.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Row));
  const completed = tasksCompletedIn(ctx, workdayId);
  const tasks = [...worked, ...completed.filter((t) => !workedTaskIds.includes(t.id))];
  const projectLevel = entries.filter((e) => !e.taskId && e.projectId).map((e) => e.projectId!);
  const focusProjects = listBucket(ctx, 'today').map((t) => t.projectId);
  const summary = workdaySummary(ctx, workdayId);
  const note = (opts.includeNote ?? true) ? overtimeNote(summary.balanceTodayMinutes) : null;

  let revisions: { line: string; links: string[] }[] | null = null;
  if (c.settings.report.revisionsSection) {
    const done = ctx.db
      .prepare(`SELECT r.*, t.huly_url AS task_url FROM revision_rounds r LEFT JOIN tasks t ON t.id = r.task_id WHERE r.completed_at >= ? AND r.completed_at <= ?`)
      .all(wd.checkInAt, wd.checkOutAt ?? ctx.now()) as Row[];
    const doneStatus = listStatuses(ctx).find((s) => s.isDone);
    const doneLabel = doneStatus ? [doneStatus.emoji, doneStatus.reportText].filter(Boolean).join(' ') : 'Done';
    revisions = done.map((r) => ({
      line: `${String(r.title)} ${doneLabel}`.trim(),
      links: r.task_url ? [String(r.task_url)] : [],
    }));
  }

  const text = generateEveningReport({
    categories: c.categories,
    statuses: c.statuses,
    groups: c.groups,
    projects: projectLines(ctx, tasks, [...projectLevel, ...focusProjects]),
    blocker: opts.blocker ?? wd.eveningBlocker ?? wd.morningBlocker ?? 'None',
    headerNote: note,
    mergeGroups: c.settings.report.mergeGroups,
    revisions,
  });
  return { workdayId, text, note };
}

export function buildReport(ctx: Ctx, type: ReportType, opts: { workdayId?: string; blocker?: string } = {}) {
  if (type === 'morning') return buildMorningReport(ctx, opts);
  if (type === 'evening') return buildEveningReport(ctx, opts);
  const wd = currentWorkday(ctx);
  return { workdayId: wd?.id ?? null, text: type === 'lunch_start' ? LUNCH_MESSAGES.start : LUNCH_MESSAGES.end };
}

/**
 * Saves the message you copied (decision Q31: locked once copied or sent).
 * Copying the same type again on the same workday creates a new history row, so nothing is overwritten.
 */
export function recordReport(
  ctx: Ctx,
  input: { type: ReportType; workdayId: string | null; generatedText: string; finalText: string; via: 'copy' | 'discord' },
) {
  if (!input.finalText.trim()) throw new RuleError('empty_report', 'The message is empty.');
  const id = ctx.id();
  const now = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO reports (id, workday_id, type, generated_text, final_text, copied_at, sent_at, locked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(id, input.workdayId, input.type, input.generatedText, input.finalText, input.via === 'copy' ? now : null, input.via === 'discord' ? now : null, now);
  return getReport(ctx, id);
}

export function getReport(ctx: Ctx, id: string) {
  const r = ctx.db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError('Report');
  return mapReport(r);
}

export function reportHistory(ctx: Ctx, limit = 50) {
  return (ctx.db.prepare(`SELECT * FROM reports ORDER BY created_at DESC LIMIT ?`).all(limit) as Row[]).map(mapReport);
}

/** Has this type already been sent to Discord for the workday? (duplicate guard for Phase 3) */
export function alreadySent(ctx: Ctx, workdayId: string, type: ReportType): boolean {
  return !!ctx.db.prepare(`SELECT 1 FROM reports WHERE workday_id = ? AND type = ? AND sent_at IS NOT NULL`).get(workdayId, type);
}

export { getSettings };
