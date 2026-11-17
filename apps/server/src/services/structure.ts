/**
 * Companies, catalog, projects, tasks, Huly codes and revision rounds (spec modules 1 and 7).
 */
import {
  RuleError,
  completion,
  compareEstimate,
  extractHulyLinks,
  parseTitleEstimate,
  projectTotals,
  subtreeIds,
  taskTotals,
  MINUTE,
  DEFAULT_SETTINGS,
  type Settings,
} from '@monkstracker/core';
import { ConflictError, NotFoundError, type Ctx } from '../lib/context.ts';
import {
  mapCompany,
  mapEntry,
  mapProject,
  mapRevision,
  mapStatus,
  mapTask,
  toTaskRef,
  type Project,
  type Task,
} from './rows.ts';

type Row = Record<string, unknown>;

// ───────────────────────── catalog ─────────────────────────

export function getSettings(ctx: Ctx): Settings {
  const row = ctx.db.prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as { value: string } | undefined;
  if (!row) throw new NotFoundError('Settings');
  // Merge over defaults so settings added in later versions always exist.
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) } as Settings;
}

/** Shallow-merges known keys only; unknown keys are ignored so a typo cannot pollute settings. */
export function updateSettings(ctx: Ctx, patch: Partial<Settings>): Settings {
  const current = getSettings(ctx);
  const known = Object.fromEntries(Object.entries(patch).filter(([k]) => k in current));
  const next = { ...current, ...known } as Settings;
  ctx.db.prepare(`UPDATE settings SET value = ? WHERE key = 'app'`).run(JSON.stringify(next));
  return next;
}

export function listStatuses(ctx: Ctx) {
  return (ctx.db.prepare(`SELECT * FROM statuses ORDER BY sort_order`).all() as Row[]).map(mapStatus);
}

export function statusByKey(ctx: Ctx, key: string) {
  const r = ctx.db.prepare(`SELECT * FROM statuses WHERE key = ?`).get(key) as Row | undefined;
  if (!r) throw new NotFoundError(`Status ${key}`);
  return mapStatus(r);
}

export function getCatalog(ctx: Ctx) {
  const db = ctx.db;
  return {
    companies: (db.prepare(`SELECT * FROM companies ORDER BY sort_order, name`).all() as Row[]).map(mapCompany),
    categories: (db.prepare(`SELECT * FROM categories ORDER BY report_order`).all() as Row[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      reportOrder: Number(r.report_order),
      archivedAt: r.archived_at === null ? null : Number(r.archived_at),
    })),
    projectTypes: (db.prepare(`SELECT * FROM project_types ORDER BY sort_order`).all() as Row[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      archivedAt: r.archived_at === null ? null : Number(r.archived_at),
    })),
    statuses: listStatuses(ctx),
    tags: db.prepare(`SELECT id, name, color FROM tags ORDER BY name`).all(),
    reportGroups: db.prepare(`SELECT id, label FROM report_groups ORDER BY label`).all(),
    hulyCodes: (db.prepare(`SELECT code, project_id FROM huly_codes ORDER BY code`).all() as Row[]).map((r) => ({
      code: String(r.code),
      projectId: r.project_id === null ? null : String(r.project_id),
    })),
    settings: getSettings(ctx),
  };
}

// ───────────────────────── companies ─────────────────────────

export interface CompanyInput {
  name: string;
  shortName?: string | null;
  color?: string | null;
  logoPath?: string | null;
}

export function createCompany(ctx: Ctx, input: CompanyInput) {
  const id = ctx.id();
  const order = (ctx.db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS o FROM companies`).get() as { o: number }).o;
  ctx.db
    .prepare(`INSERT INTO companies (id, name, short_name, color, logo_path, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.name.trim(), input.shortName ?? null, input.color ?? null, input.logoPath ?? null, order, ctx.now());
  return getCompany(ctx, id);
}

export function getCompany(ctx: Ctx, id: string) {
  const r = ctx.db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError('Company');
  return mapCompany(r);
}

export function updateCompany(ctx: Ctx, id: string, patch: Partial<CompanyInput> & { archived?: boolean }) {
  const c = getCompany(ctx, id);
  ctx.db
    .prepare(`UPDATE companies SET name = ?, short_name = ?, color = ?, logo_path = ?, archived_at = ? WHERE id = ?`)
    .run(
      patch.name?.trim() ?? c.name,
      patch.shortName === undefined ? c.shortName : patch.shortName,
      patch.color === undefined ? c.color : patch.color,
      patch.logoPath === undefined ? c.logoPath : patch.logoPath,
      patch.archived === undefined ? c.archivedAt : patch.archived ? ctx.now() : null,
      id,
    );
  return getCompany(ctx, id);
}

// ───────────────────────── projects ─────────────────────────

export interface ProjectInput {
  companyId: string;
  name: string;
  reportName?: string | null;
  reportGroupId?: string | null;
  typeId?: string | null;
  categoryId?: string;
  statusId?: string;
  priority?: number;
  startDate?: string | null;
  deadline?: string | null;
  estimateMinutes?: number | null;
  assignedBy?: string | null;
  clientName?: string | null;
  hulyUrl?: string | null;
  description?: string | null;
  notes?: string | null;
}

const PROJECT_FIELDS: Record<keyof Omit<ProjectInput, 'companyId' | 'name'>, string> = {
  reportName: 'report_name',
  reportGroupId: 'report_group_id',
  typeId: 'type_id',
  categoryId: 'category_id',
  statusId: 'status_id',
  priority: 'priority',
  startDate: 'start_date',
  deadline: 'deadline',
  estimateMinutes: 'estimate_minutes',
  assignedBy: 'assigned_by',
  clientName: 'client_name',
  hulyUrl: 'huly_url',
  description: 'description',
  notes: 'notes',
};

function defaultCategoryId(ctx: Ctx): string {
  const internal = ctx.db.prepare(`SELECT id FROM categories WHERE name = 'Internal Work' AND archived_at IS NULL`).get() as
    | { id: string }
    | undefined;
  const first = ctx.db.prepare(`SELECT id FROM categories WHERE archived_at IS NULL ORDER BY report_order LIMIT 1`).get() as
    | { id: string }
    | undefined;
  const id = internal?.id ?? first?.id;
  if (!id) throw new RuleError('no_category', 'Add a work category first.');
  return id;
}

/** Flow 2: only a name and a company are required. */
export function createProject(ctx: Ctx, input: ProjectInput): Project {
  const name = input.name.trim();
  if (!name) throw new RuleError('name_required', 'A project needs a name.');
  getCompany(ctx, input.companyId);
  const id = ctx.id();
  const now = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO projects (id, company_id, name, category_id, status_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.companyId, name, input.categoryId ?? defaultCategoryId(ctx), input.statusId ?? statusByKey(ctx, 'todo').id, now, now);
  const { companyId: _c, name: _n, categoryId: _cat, statusId: _st, ...rest } = input;
  if (Object.keys(rest).length) return updateProject(ctx, id, rest);
  return getProjectRow(ctx, id);
}

export function getProjectRow(ctx: Ctx, id: string): Project {
  const r = ctx.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError('Project');
  return mapProject(r);
}

export function updateProject(
  ctx: Ctx,
  id: string,
  patch: Partial<ProjectInput> & { archived?: boolean },
): Project {
  getProjectRow(ctx, id);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new RuleError('name_required', 'A project needs a name.');
    sets.push('name = ?');
    values.push(patch.name.trim());
  }
  if (patch.companyId !== undefined) {
    getCompany(ctx, patch.companyId);
    sets.push('company_id = ?');
    values.push(patch.companyId);
  }
  for (const [key, col] of Object.entries(PROJECT_FIELDS) as [keyof typeof PROJECT_FIELDS, string][]) {
    if (patch[key] === undefined) continue;
    sets.push(`${col} = ?`);
    values.push(patch[key]);
  }
  if (patch.archived !== undefined) {
    sets.push('archived_at = ?');
    values.push(patch.archived ? ctx.now() : null);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(ctx.now(), id);
    ctx.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  return getProjectRow(ctx, id);
}

function projectEntries(ctx: Ctx, projectId: string) {
  return (ctx.db.prepare(`SELECT * FROM time_entries WHERE project_id = ?`).all(projectId) as Row[]).map(mapEntry);
}

function projectTasks(ctx: Ctx, projectId: string, includeArchived = false): Task[] {
  const sql = includeArchived
    ? `SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order`
    : `SELECT * FROM tasks WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order`;
  return (ctx.db.prepare(sql).all(projectId) as Row[]).map(mapTask);
}

/** A project with its live totals, estimate comparison and completion %. */
export function getProject(ctx: Ctx, id: string) {
  const project = getProjectRow(ctx, id);
  const now = ctx.now();
  const statuses = new Map(listStatuses(ctx).map((s) => [s.id, s]));
  const tasks = projectTasks(ctx, id, true);
  const totals = projectTotals(id, projectEntries(ctx, id), now);
  const taskEstimateMinutes = tasks
    .filter((t) => t.parentId === null && t.archivedAt === null)
    .reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);
  return {
    ...project,
    totals,
    estimate: compareEstimate(project.estimateMinutes === null ? null : project.estimateMinutes * MINUTE, totals.total),
    taskEstimateMinutes,
    completion: completion(
      tasks.map((t) => ({
        id: t.id,
        parentId: t.parentId,
        done: statuses.get(t.statusId)?.isDone ?? false,
        rejected: statuses.get(t.statusId)?.isRejected ?? false,
        archived: t.archivedAt !== null,
      })),
    ),
  };
}

export function listProjects(ctx: Ctx, filter: { companyId?: string; includeArchived?: boolean } = {}) {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.companyId) {
    where.push('company_id = ?');
    values.push(filter.companyId);
  }
  if (!filter.includeArchived) where.push('archived_at IS NULL');
  const sql = `SELECT id FROM projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY priority DESC, name`;
  return (ctx.db.prepare(sql).all(...values) as { id: string }[]).map((r) => getProject(ctx, r.id));
}

// ───────────────────────── tasks ─────────────────────────

export interface TaskInput {
  projectId: string;
  parentId?: string | null;
  name: string;
  description?: string | null;
  statusId?: string;
  priority?: number;
  planBucket?: 'backlog' | 'this_week' | 'today';
  plannedDate?: string | null;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  hulyUrl?: string | null;
  hulyKey?: string | null;
}

export function getTask(ctx: Ctx, id: string): Task {
  const r = ctx.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError('Task');
  return mapTask(r);
}

function nextSortOrder(ctx: Ctx, bucket: string): number {
  return (ctx.db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM tasks WHERE plan_bucket = ?`).get(bucket) as { o: number }).o;
}

/** Flow 3. An estimate typed at the end of the name is parsed out ("Blog cover 1hr 30min"). */
export function createTask(ctx: Ctx, input: TaskInput): Task {
  const project = getProjectRow(ctx, input.projectId);
  if (project.archivedAt !== null) throw new RuleError('project_archived', 'Unarchive the project before adding tasks.');
  if (input.parentId) {
    const parent = getTask(ctx, input.parentId);
    if (parent.projectId !== input.projectId) throw new RuleError('parent_other_project', 'A subtask must be in the same project as its parent.');
  }
  const parsed = parseTitleEstimate(input.name);
  if (!parsed.title) throw new RuleError('name_required', 'A task needs a name.');
  const bucket = input.planBucket ?? 'backlog';
  const id = ctx.id();
  const now = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO tasks (id, project_id, parent_id, name, description, status_id, priority, plan_bucket, planned_date,
                          due_date, estimate_minutes, huly_url, huly_key, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.parentId ?? null,
      parsed.title,
      input.description ?? null,
      input.statusId ?? statusByKey(ctx, 'todo').id,
      input.priority ?? 0,
      bucket,
      input.plannedDate ?? null,
      input.dueDate ?? null,
      input.estimateMinutes ?? parsed.estimateMinutes,
      input.hulyUrl ?? null,
      input.hulyKey ?? null,
      nextSortOrder(ctx, bucket),
      now,
      now,
    );
  return getTask(ctx, id);
}

export type TaskPatch = Partial<Omit<TaskInput, 'projectId' | 'parentId'>> & { sortOrder?: number; archived?: boolean };

const TASK_FIELDS: Record<string, string> = {
  name: 'name',
  description: 'description',
  statusId: 'status_id',
  priority: 'priority',
  planBucket: 'plan_bucket',
  plannedDate: 'planned_date',
  dueDate: 'due_date',
  estimateMinutes: 'estimate_minutes',
  hulyUrl: 'huly_url',
  hulyKey: 'huly_key',
  sortOrder: 'sort_order',
};

/**
 * Updates a task. Setting a done status stamps completed_at (flow 6);
 * leaving a done status clears it. Stopping a running timer is the caller's job (see tasks.complete).
 */
export function updateTask(ctx: Ctx, id: string, patch: TaskPatch): Task {
  const task = getTask(ctx, id);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(TASK_FIELDS)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (key === 'name' && !String(v).trim()) throw new RuleError('name_required', 'A task needs a name.');
    sets.push(`${col} = ?`);
    values.push(key === 'name' ? String(v).trim() : v);
  }
  if (patch.planBucket !== undefined && patch.planBucket !== task.planBucket && patch.sortOrder === undefined) {
    sets.push('sort_order = ?');
    values.push(nextSortOrder(ctx, patch.planBucket));
  }
  if (patch.statusId !== undefined) {
    const status = listStatuses(ctx).find((s) => s.id === patch.statusId);
    if (!status) throw new NotFoundError('Status');
    sets.push('completed_at = ?');
    values.push(status.isDone ? (task.completedAt ?? ctx.now()) : null);
  }
  if (patch.archived !== undefined) {
    sets.push('archived_at = ?');
    values.push(patch.archived ? ctx.now() : null);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(ctx.now(), id);
    ctx.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  return getTask(ctx, id);
}

/** Open (not done, not rejected, not archived) descendants of a task. */
export function openSubtaskIds(ctx: Ctx, taskId: string): string[] {
  const task = getTask(ctx, taskId);
  const tasks = projectTasks(ctx, task.projectId);
  const statuses = new Map(listStatuses(ctx).map((s) => [s.id, s]));
  return subtreeIds(tasks.map(toTaskRef), taskId).filter((id) => {
    if (id === taskId) return false;
    const t = tasks.find((x) => x.id === id);
    const st = t ? statuses.get(t.statusId) : undefined;
    return !!t && !st?.isDone && !st?.isRejected;
  });
}

/**
 * Rule 10: moving a task moves its whole subtree and all their time entries,
 * so both projects' totals stay correct. Runs in one transaction.
 */
export function moveTask(ctx: Ctx, id: string, to: { projectId: string; parentId: string | null }): Task {
  const task = getTask(ctx, id);
  const target = getProjectRow(ctx, to.projectId);
  if (target.archivedAt !== null) throw new RuleError('project_archived', 'Cannot move into an archived project.');
  const moving = subtreeIds(projectTasks(ctx, task.projectId, true).map(toTaskRef), id);
  if (to.parentId) {
    if (moving.includes(to.parentId)) throw new RuleError('move_into_self', 'A task cannot move under itself.');
    const parent = getTask(ctx, to.parentId);
    if (parent.projectId !== to.projectId) throw new RuleError('parent_other_project', 'The new parent is in a different project.');
  }
  ctx.db.transaction(() => {
    const now = ctx.now();
    const marks = moving.map(() => '?').join(', ');
    ctx.db.prepare(`UPDATE tasks SET project_id = ?, updated_at = ? WHERE id IN (${marks})`).run(to.projectId, now, ...moving);
    ctx.db.prepare(`UPDATE tasks SET parent_id = ? WHERE id = ?`).run(to.parentId, id);
    ctx.db.prepare(`UPDATE time_entries SET project_id = ?, updated_at = ? WHERE task_id IN (${marks})`).run(to.projectId, now, ...moving);
  })();
  return getTask(ctx, id);
}

/** A project's tasks as a flat, ordered list with their own and rolled-up time. */
export function listProjectTasks(ctx: Ctx, projectId: string) {
  getProjectRow(ctx, projectId);
  const tasks = projectTasks(ctx, projectId);
  const totals = taskTotals(tasks.map(toTaskRef), projectEntries(ctx, projectId), ctx.now());
  return tasks.map((t) => ({ ...t, time: totals.get(t.id) ?? { own: 0, total: 0 } }));
}

/** Tasks in a plan bucket across projects (Plan screen and Today's Focus). */
export function listBucket(ctx: Ctx, bucket: 'backlog' | 'this_week' | 'today', companyId?: string): Task[] {
  const sql = companyId
    ? `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.plan_bucket = ? AND t.archived_at IS NULL AND p.archived_at IS NULL AND p.company_id = ? ORDER BY t.sort_order`
    : `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.plan_bucket = ? AND t.archived_at IS NULL AND p.archived_at IS NULL ORDER BY t.sort_order`;
  const rows = (companyId ? ctx.db.prepare(sql).all(bucket, companyId) : ctx.db.prepare(sql).all(bucket)) as Row[];
  return rows.map(mapTask);
}

// ───────────────────────── Huly codes and quick add ─────────────────────────

export function setHulyCode(ctx: Ctx, code: string, projectId: string | null) {
  if (projectId) getProjectRow(ctx, projectId);
  ctx.db
    .prepare(`INSERT INTO huly_codes (code, project_id) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET project_id = excluded.project_id`)
    .run(code, projectId);
  return { code, projectId };
}

export type QuickAddResult =
  | { status: 'created'; tasks: Task[]; existing: Task[] }
  | { status: 'needs_project'; unknownCodes: string[] };

/**
 * Quick add (Q). Pasted Huly links file themselves by project code;
 * plain text needs a project. `projectId` also answers "which project is this code?" and is remembered.
 */
export function quickAdd(
  ctx: Ctx,
  input: { text: string; projectId?: string; planBucket?: 'backlog' | 'this_week' | 'today'; parentId?: string | null },
): QuickAddResult {
  const links = extractHulyLinks(input.text);
  if (!links.length) {
    if (!input.projectId) return { status: 'needs_project', unknownCodes: [] };
    const task = createTask(ctx, { projectId: input.projectId, parentId: input.parentId ?? null, name: input.text, planBucket: input.planBucket });
    return { status: 'created', tasks: [task], existing: [] };
  }
  const codeMap = new Map(
    (ctx.db.prepare(`SELECT code, project_id FROM huly_codes`).all() as { code: string; project_id: string | null }[]).map((r) => [r.code, r.project_id]),
  );
  const unknown = [...new Set(links.map((l) => l.projectCode).filter((c) => !codeMap.get(c)))];
  if (unknown.length) {
    if (!input.projectId) return { status: 'needs_project', unknownCodes: unknown };
    for (const code of unknown) setHulyCode(ctx, code, input.projectId);
    for (const code of unknown) codeMap.set(code, input.projectId);
  }
  // Text left after removing the links becomes the title (with an optional estimate) when one link is pasted.
  const leftover = input.text.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  const created: Task[] = [];
  const existing: Task[] = [];
  ctx.db.transaction(() => {
    for (const link of links) {
      const already = ctx.db.prepare(`SELECT * FROM tasks WHERE huly_key = ? AND archived_at IS NULL`).get(link.identifier) as Row | undefined;
      if (already) {
        existing.push(mapTask(already));
        continue;
      }
      const name = links.length === 1 && leftover ? leftover : link.identifier;
      created.push(
        createTask(ctx, {
          projectId: codeMap.get(link.projectCode)!,
          name,
          hulyUrl: link.url,
          hulyKey: link.identifier,
          planBucket: input.planBucket,
        }),
      );
    }
  })();
  return { status: 'created', tasks: created, existing };
}

// ───────────────────────── revisions ─────────────────────────

export function createRevision(
  ctx: Ctx,
  projectId: string,
  input: { title: string; description?: string | null; taskId?: string | null; requestedBy?: string | null; requestedAt?: number },
) {
  getProjectRow(ctx, projectId);
  if (input.taskId && getTask(ctx, input.taskId).projectId !== projectId) {
    throw new RuleError('task_project_mismatch', 'The task belongs to a different project.');
  }
  const number = (ctx.db.prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM revision_rounds WHERE project_id = ?`).get(projectId) as { n: number }).n;
  const id = ctx.id();
  ctx.db
    .prepare(
      `INSERT INTO revision_rounds (id, project_id, task_id, number, title, description, requested_by, requested_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, input.taskId ?? null, number, input.title.trim(), input.description ?? null, input.requestedBy ?? null, input.requestedAt ?? ctx.now(), ctx.now());
  return getRevision(ctx, id);
}

export function getRevision(ctx: Ctx, id: string) {
  const r = ctx.db.prepare(`SELECT * FROM revision_rounds WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw new NotFoundError('Revision round');
  return mapRevision(r);
}

export function updateRevision(ctx: Ctx, id: string, patch: { title?: string; description?: string | null; status?: 'requested' | 'in_progress' | 'done' }) {
  const r = getRevision(ctx, id);
  const status = patch.status ?? r.status;
  ctx.db
    .prepare(`UPDATE revision_rounds SET title = ?, description = ?, status = ?, completed_at = ? WHERE id = ?`)
    .run(
      patch.title?.trim() ?? r.title,
      patch.description === undefined ? r.description : patch.description,
      status,
      status === 'done' ? (r.completedAt ?? ctx.now()) : null,
      id,
    );
  return getRevision(ctx, id);
}

export function listRevisions(ctx: Ctx, projectId: string) {
  const rounds = (ctx.db.prepare(`SELECT * FROM revision_rounds WHERE project_id = ? ORDER BY number`).all(projectId) as Row[]).map(mapRevision);
  const now = ctx.now();
  const entries = (ctx.db.prepare(`SELECT * FROM time_entries WHERE project_id = ? AND kind = 'revision'`).all(projectId) as Row[]).map(mapEntry);
  return rounds.map((round) => ({
    ...round,
    timeMs: entries.filter((e) => e.revisionRoundId === round.id).reduce((s, e) => s + ((e.endedAt ?? now) - e.startedAt), 0),
  }));
}

export { ConflictError };
