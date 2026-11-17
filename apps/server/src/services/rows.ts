/** Row → API object mappers (snake_case database columns to camelCase JSON). */
import type { TaskRef, TimeEntry } from '@monkstracker/core';
import { bool } from '../lib/context.ts';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const mapCompany = (r: Row) => ({
  id: String(r.id),
  name: String(r.name),
  shortName: s(r.short_name),
  color: s(r.color),
  logoPath: s(r.logo_path),
  sortOrder: Number(r.sort_order),
  archivedAt: n(r.archived_at),
});

export const mapStatus = (r: Row) => ({
  id: String(r.id),
  key: String(r.key),
  name: String(r.name),
  color: s(r.color),
  emoji: String(r.emoji),
  reportText: String(r.report_text),
  isDone: bool(r.is_done),
  isRejected: bool(r.is_rejected),
  sortOrder: Number(r.sort_order),
});

export const mapProject = (r: Row) => ({
  id: String(r.id),
  companyId: String(r.company_id),
  name: String(r.name),
  reportName: s(r.report_name),
  reportGroupId: s(r.report_group_id),
  typeId: s(r.type_id),
  categoryId: String(r.category_id),
  statusId: String(r.status_id),
  priority: Number(r.priority),
  startDate: s(r.start_date),
  deadline: s(r.deadline),
  estimateMinutes: n(r.estimate_minutes),
  assignedBy: s(r.assigned_by),
  clientName: s(r.client_name),
  hulyUrl: s(r.huly_url),
  description: s(r.description),
  notes: s(r.notes),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  archivedAt: n(r.archived_at),
});
export type Project = ReturnType<typeof mapProject>;

export const mapTask = (r: Row) => ({
  id: String(r.id),
  projectId: String(r.project_id),
  parentId: s(r.parent_id),
  name: String(r.name),
  description: s(r.description),
  statusId: String(r.status_id),
  priority: Number(r.priority),
  planBucket: String(r.plan_bucket) as 'backlog' | 'this_week' | 'today',
  plannedDate: s(r.planned_date),
  dueDate: s(r.due_date),
  estimateMinutes: n(r.estimate_minutes),
  hulyUrl: s(r.huly_url),
  hulyKey: s(r.huly_key),
  sortOrder: Number(r.sort_order),
  completedAt: n(r.completed_at),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  archivedAt: n(r.archived_at),
});
export type Task = ReturnType<typeof mapTask>;

export const mapEntry = (r: Row): TimeEntry & { source: string; note: string | null; meetingId: string | null } => ({
  id: String(r.id),
  projectId: s(r.project_id),
  taskId: s(r.task_id),
  kind: String(r.kind) as TimeEntry['kind'],
  revisionRoundId: s(r.revision_round_id),
  meetingId: s(r.meeting_id),
  workdayId: s(r.workday_id),
  startedAt: Number(r.started_at),
  endedAt: n(r.ended_at),
  source: String(r.source),
  note: s(r.note),
});
export type Entry = ReturnType<typeof mapEntry>;

export const toTaskRef = (t: { id: string; projectId: string; parentId: string | null }): TaskRef => ({
  id: t.id,
  projectId: t.projectId,
  parentId: t.parentId,
});

export const mapWorkday = (r: Row) => ({
  id: String(r.id),
  date: String(r.date),
  checkInAt: Number(r.check_in_at),
  checkOutAt: n(r.check_out_at),
  expectedMinutes: Number(r.expected_minutes),
  morningBlocker: s(r.morning_blocker),
  eveningBlocker: s(r.evening_blocker),
});
export type WorkdayRow = ReturnType<typeof mapWorkday>;

export const mapRevision = (r: Row) => ({
  id: String(r.id),
  projectId: String(r.project_id),
  taskId: s(r.task_id),
  number: Number(r.number),
  title: String(r.title),
  description: s(r.description),
  requestedBy: s(r.requested_by),
  requestedAt: Number(r.requested_at),
  status: String(r.status) as 'requested' | 'in_progress' | 'done',
  completedAt: n(r.completed_at),
});

export const mapReport = (r: Row) => ({
  id: String(r.id),
  workdayId: s(r.workday_id),
  type: String(r.type),
  generatedText: String(r.generated_text),
  finalText: String(r.final_text),
  copiedAt: n(r.copied_at),
  sentAt: n(r.sent_at),
  locked: bool(r.locked),
  createdAt: Number(r.created_at),
});
