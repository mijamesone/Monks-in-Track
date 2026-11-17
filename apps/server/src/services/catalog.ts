/**
 * Editable lists from Settings (spec screen 10): categories, statuses, project types, tags,
 * report groups and leave days. Anything in use is archived or refused, never silently deleted.
 */
import { RuleError } from '@monkstracker/core';
import { ConflictError, NotFoundError, type Ctx } from '../lib/context.ts';
import { listStatuses } from './structure.ts';

type Row = Record<string, unknown>;

const used = (ctx: Ctx, sql: string, id: string): boolean => !!ctx.db.prepare(sql).get(id);

function must(ctx: Ctx, table: string, id: string, what: string): Row {
  const r = ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError(what);
  return r;
}

const clean = (name: string, what: string): string => {
  const n = name.trim();
  if (!n) throw new RuleError('name_required', `${what} needs a name.`);
  return n;
};

// ───────────────────────── categories ─────────────────────────

export function createCategory(ctx: Ctx, input: { name: string }) {
  const order = (ctx.db.prepare(`SELECT COALESCE(MAX(report_order), 0) + 1 AS o FROM categories`).get() as { o: number }).o;
  const id = ctx.id();
  ctx.db.prepare(`INSERT INTO categories (id, name, report_order) VALUES (?, ?, ?)`).run(id, clean(input.name, 'A category'), order);
  return { id, name: input.name.trim(), reportOrder: order, archivedAt: null };
}

export function updateCategory(ctx: Ctx, id: string, patch: { name?: string; archived?: boolean }) {
  const r = must(ctx, 'categories', id, 'Category');
  if (patch.archived && !r.archived_at) {
    const live = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM categories WHERE archived_at IS NULL`).get() as { n: number }).n;
    if (live <= 1) throw new RuleError('last_category', 'Keep at least one work category.');
  }
  ctx.db
    .prepare(`UPDATE categories SET name = ?, archived_at = ? WHERE id = ?`)
    .run(patch.name === undefined ? r.name : clean(patch.name, 'A category'), patch.archived === undefined ? r.archived_at : patch.archived ? ctx.now() : null, id);
  return mapCategory(must(ctx, 'categories', id, 'Category'));
}

/** Sets report order (Client Work before Internal Work in reports) from an ordered list of ids. */
export function reorderCategories(ctx: Ctx, ids: string[]) {
  ctx.db.transaction(() => ids.forEach((id, i) => ctx.db.prepare(`UPDATE categories SET report_order = ? WHERE id = ?`).run(i + 1, id)))();
  return (ctx.db.prepare(`SELECT * FROM categories ORDER BY report_order`).all() as Row[]).map(mapCategory);
}

const mapCategory = (r: Row) => ({ id: String(r.id), name: String(r.name), reportOrder: Number(r.report_order), archivedAt: r.archived_at === null ? null : Number(r.archived_at) });

// ───────────────────────── statuses ─────────────────────────

export interface StatusInput {
  name: string;
  emoji?: string;
  reportText?: string;
  color?: string | null;
  isDone?: boolean;
  isRejected?: boolean;
}

function keyFrom(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'status';
}

export function createStatus(ctx: Ctx, input: StatusInput) {
  if (input.isDone && input.isRejected) throw new RuleError('done_and_rejected', 'A status cannot be both done and rejected.');
  let key = keyFrom(input.name);
  while (ctx.db.prepare(`SELECT 1 FROM statuses WHERE key = ?`).get(key)) key += '_2';
  const order = (ctx.db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM statuses`).get() as { o: number }).o;
  const id = ctx.id();
  ctx.db
    .prepare(`INSERT INTO statuses (id, key, name, color, emoji, report_text, is_done, is_rejected, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, key, clean(input.name, 'A status'), input.color ?? null, input.emoji ?? '', input.reportText ?? input.name.trim(), input.isDone ? 1 : 0, input.isRejected ? 1 : 0, order);
  return listStatuses(ctx).find((s) => s.id === id)!;
}

export function updateStatus(ctx: Ctx, id: string, patch: Partial<StatusInput>) {
  const cur = listStatuses(ctx).find((s) => s.id === id);
  if (!cur) throw new NotFoundError('Status');
  const isDone = patch.isDone ?? cur.isDone;
  const isRejected = patch.isRejected ?? cur.isRejected;
  if (isDone && isRejected) throw new RuleError('done_and_rejected', 'A status cannot be both done and rejected.');
  if (cur.isDone && !isDone) {
    const others = listStatuses(ctx).filter((s) => s.isDone && s.id !== id).length;
    if (!others) throw new RuleError('last_done_status', 'Keep at least one status that counts as done.');
  }
  ctx.db
    .prepare(`UPDATE statuses SET name = ?, color = ?, emoji = ?, report_text = ?, is_done = ?, is_rejected = ? WHERE id = ?`)
    .run(
      patch.name === undefined ? cur.name : clean(patch.name, 'A status'),
      patch.color === undefined ? cur.color : patch.color,
      patch.emoji ?? cur.emoji,
      patch.reportText ?? cur.reportText,
      isDone ? 1 : 0,
      isRejected ? 1 : 0,
      id,
    );
  return listStatuses(ctx).find((s) => s.id === id)!;
}

export function reorderStatuses(ctx: Ctx, ids: string[]) {
  ctx.db.transaction(() => ids.forEach((id, i) => ctx.db.prepare(`UPDATE statuses SET sort_order = ? WHERE id = ?`).run(i + 1, id)))();
  return listStatuses(ctx);
}

/** Deleting is only allowed for a status nothing uses; otherwise move items to another status first. */
export function deleteStatus(ctx: Ctx, id: string) {
  const s = listStatuses(ctx).find((x) => x.id === id);
  if (!s) throw new NotFoundError('Status');
  if (used(ctx, `SELECT 1 FROM projects WHERE status_id = ?`, id) || used(ctx, `SELECT 1 FROM tasks WHERE status_id = ?`, id)) {
    throw new ConflictError('status_in_use', 'Projects or tasks still use this status.');
  }
  if (s.isDone && listStatuses(ctx).filter((x) => x.isDone).length <= 1) throw new RuleError('last_done_status', 'Keep at least one status that counts as done.');
  if (s.key === 'todo') throw new RuleError('default_status', 'To Do is the default for new items and cannot be deleted.');
  ctx.db.prepare(`DELETE FROM statuses WHERE id = ?`).run(id);
  return { deleted: id };
}

// ───────────────────────── project types ─────────────────────────

export function createProjectType(ctx: Ctx, input: { name: string }) {
  const order = (ctx.db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM project_types`).get() as { o: number }).o;
  const id = ctx.id();
  ctx.db.prepare(`INSERT INTO project_types (id, name, sort_order) VALUES (?, ?, ?)`).run(id, clean(input.name, 'A project type'), order);
  return { id, name: input.name.trim(), archivedAt: null };
}

export function updateProjectType(ctx: Ctx, id: string, patch: { name?: string; archived?: boolean }) {
  const r = must(ctx, 'project_types', id, 'Project type');
  ctx.db
    .prepare(`UPDATE project_types SET name = ?, archived_at = ? WHERE id = ?`)
    .run(patch.name === undefined ? r.name : clean(patch.name, 'A project type'), patch.archived === undefined ? r.archived_at : patch.archived ? ctx.now() : null, id);
  const u = must(ctx, 'project_types', id, 'Project type');
  return { id, name: String(u.name), archivedAt: u.archived_at === null ? null : Number(u.archived_at) };
}

// ───────────────────────── tags ─────────────────────────

export function createTag(ctx: Ctx, input: { name: string; color?: string | null }) {
  const name = clean(input.name, 'A tag');
  const existing = ctx.db.prepare(`SELECT id, name, color FROM tags WHERE name = ?`).get(name) as Row | undefined;
  if (existing) return { id: String(existing.id), name: String(existing.name), color: existing.color as string | null };
  const id = ctx.id();
  ctx.db.prepare(`INSERT INTO tags (id, name, color) VALUES (?, ?, ?)`).run(id, name, input.color ?? null);
  return { id, name, color: input.color ?? null };
}

export function updateTag(ctx: Ctx, id: string, patch: { name?: string; color?: string | null }) {
  const r = must(ctx, 'tags', id, 'Tag');
  ctx.db.prepare(`UPDATE tags SET name = ?, color = ? WHERE id = ?`).run(patch.name === undefined ? r.name : clean(patch.name, 'A tag'), patch.color === undefined ? r.color : patch.color, id);
  return ctx.db.prepare(`SELECT id, name, color FROM tags WHERE id = ?`).get(id);
}

/** Deleting a tag removes it from every project and task (they are labels, not history). */
export function deleteTag(ctx: Ctx, id: string) {
  must(ctx, 'tags', id, 'Tag');
  ctx.db.prepare(`DELETE FROM tags WHERE id = ?`).run(id);
  return { deleted: id };
}

/** Replaces the tag set of a project or task. Unknown tag names are created on the fly. */
export function setTags(ctx: Ctx, target: { kind: 'project' | 'task'; id: string }, names: string[]) {
  const table = target.kind === 'project' ? 'projects' : 'tasks';
  must(ctx, table, target.id, target.kind === 'project' ? 'Project' : 'Task');
  const link = target.kind === 'project' ? 'project_tags' : 'task_tags';
  const col = target.kind === 'project' ? 'project_id' : 'task_id';
  return ctx.db.transaction(() => {
    ctx.db.prepare(`DELETE FROM ${link} WHERE ${col} = ?`).run(target.id);
    // Tag names are case-insensitive: "Marketplace" and "marketplace" are one tag, kept once.
    const byId = new Map<string, { id: string; name: string; color: string | null }>();
    for (const name of names.map((n) => n.trim()).filter(Boolean)) {
      const tag = createTag(ctx, { name });
      if (!byId.has(tag.id)) byId.set(tag.id, tag);
    }
    for (const t of byId.values()) ctx.db.prepare(`INSERT INTO ${link} (${col}, tag_id) VALUES (?, ?)`).run(target.id, t.id);
    return [...byId.values()];
  })();
}

export function tagsOf(ctx: Ctx, target: { kind: 'project' | 'task'; id: string }) {
  const link = target.kind === 'project' ? 'project_tags' : 'task_tags';
  const col = target.kind === 'project' ? 'project_id' : 'task_id';
  return ctx.db.prepare(`SELECT t.id, t.name, t.color FROM ${link} l JOIN tags t ON t.id = l.tag_id WHERE l.${col} = ? ORDER BY t.name`).all(target.id);
}

// ───────────────────────── report groups ─────────────────────────

export function createReportGroup(ctx: Ctx, input: { label: string; projectIds?: string[] }) {
  const id = ctx.id();
  ctx.db.transaction(() => {
    ctx.db.prepare(`INSERT INTO report_groups (id, label) VALUES (?, ?)`).run(id, clean(input.label, 'A report group'));
    for (const p of input.projectIds ?? []) {
      must(ctx, 'projects', p, 'Project');
      ctx.db.prepare(`UPDATE projects SET report_group_id = ?, updated_at = ? WHERE id = ?`).run(id, ctx.now(), p);
    }
  })();
  return { id, label: input.label.trim(), projectIds: input.projectIds ?? [] };
}

export function updateReportGroup(ctx: Ctx, id: string, patch: { label?: string }) {
  const r = must(ctx, 'report_groups', id, 'Report group');
  ctx.db.prepare(`UPDATE report_groups SET label = ? WHERE id = ?`).run(patch.label === undefined ? r.label : clean(patch.label, 'A report group'), id);
  return { id, label: String(must(ctx, 'report_groups', id, 'Report group').label) };
}

/** Deleting a group just un-merges its projects in reports. */
export function deleteReportGroup(ctx: Ctx, id: string) {
  must(ctx, 'report_groups', id, 'Report group');
  ctx.db.transaction(() => {
    ctx.db.prepare(`UPDATE projects SET report_group_id = NULL WHERE report_group_id = ?`).run(id);
    ctx.db.prepare(`DELETE FROM report_groups WHERE id = ?`).run(id);
  })();
  return { deleted: id };
}

// ───────────────────────── leave ─────────────────────────

export type LeaveType = 'sick' | 'annual' | 'alter' | 'earned';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Adds leave for each day from `from` to `to` inclusive. A day that already has leave is updated. */
export function addLeave(ctx: Ctx, input: { from: string; to?: string; type: LeaveType; halfDay?: boolean; note?: string | null }) {
  const to = input.to ?? input.from;
  if (!DATE.test(input.from) || !DATE.test(to) || to < input.from) throw new RuleError('date_range', 'Choose a valid date range.');
  if (input.halfDay && to !== input.from) throw new RuleError('half_day_range', 'A half day is a single date.');
  const days: string[] = [];
  const [y, m, d] = input.from.split('-').map(Number) as [number, number, number];
  for (let i = 0; i < 366; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (day > to) break;
    days.push(day);
  }
  ctx.db.transaction(() => {
    for (const day of days) {
      if (ctx.db.prepare(`SELECT 1 FROM workdays WHERE date = ? AND check_out_at IS NOT NULL`).get(day)) {
        throw new ConflictError('leave_on_worked_day', `You already recorded a workday on ${day}.`);
      }
      ctx.db
        .prepare(
          `INSERT INTO leave_days (id, date, type, half_day, note) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET type = excluded.type, half_day = excluded.half_day, note = excluded.note`,
        )
        .run(ctx.id(), day, input.type, input.halfDay ? 1 : 0, input.note ?? null);
    }
  })();
  return listLeave(ctx, { from: input.from, to });
}

export function removeLeave(ctx: Ctx, date: string) {
  const r = ctx.db.prepare(`DELETE FROM leave_days WHERE date = ?`).run(date);
  if (!r.changes) throw new NotFoundError('Leave day');
  return { deleted: date };
}

export function listLeave(ctx: Ctx, range: { from?: string; to?: string } = {}) {
  const rows = ctx.db
    .prepare(`SELECT * FROM leave_days WHERE date >= ? AND date <= ? ORDER BY date`)
    .all(range.from ?? '0000-01-01', range.to ?? '9999-12-31') as Row[];
  return rows.map((r) => ({ date: String(r.date), type: String(r.type) as LeaveType, halfDay: r.half_day === 1, note: r.note === null ? null : String(r.note) }));
}

/**
 * Days used per leave type in a calendar year (half days count 0.5).
 * Yearly allowances live in settings.leaveAllowance, entered by hand (decision R12).
 */
export function leaveUsage(ctx: Ctx, year: number, allowance: Partial<Record<LeaveType, number>>) {
  const used: Record<LeaveType, number> = { sick: 0, annual: 0, alter: 0, earned: 0 };
  for (const l of listLeave(ctx, { from: `${year}-01-01`, to: `${year}-12-31` })) used[l.type] += l.halfDay ? 0.5 : 1;
  return (Object.keys(used) as LeaveType[]).map((type) => ({
    type,
    used: used[type],
    allowance: allowance[type] ?? null,
    remaining: allowance[type] === undefined ? null : (allowance[type] as number) - used[type],
  }));
}
