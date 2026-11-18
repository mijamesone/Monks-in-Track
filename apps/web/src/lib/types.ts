/** Shapes returned by the local server (see apps/server/src/services/rows.ts). */

export type Bucket = 'backlog' | 'this_week' | 'today';
export type EntryKind = 'work' | 'revision' | 'meeting' | 'break' | 'lunch';

export interface Company {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  archivedAt: number | null;
}

export interface Status {
  color?: string | null;
  sortOrder?: number;
  id: string;
  key: string;
  name: string;
  emoji: string;
  reportText: string;
  isDone: boolean;
  isRejected: boolean;
}

export interface ThemeSetting {
  mode: 'auto' | 'light' | 'dark';
  lightFrom: string;
  darkFrom: string;
}

export interface ReportGroup {
  id: string;
  label: string;
}

export interface Catalog {
  companies: Company[];
  reportGroups: ReportGroup[];
  hulyCodes: { code: string; projectId: string | null }[];
  categories: { id: string; name: string; reportOrder: number; archivedAt: number | null }[];
  projectTypes: { id: string; name: string }[];
  statuses: Status[];
  settings: {
    theme: ThemeSetting;
    workingDays: number[];
    fullDayMinutes: number;
    lunchFirstReminder: string;
    lunchSecondReminder: string;
    lunchMinutes: number;
    lunchExtendOptions: number[];
    breakMinutes: number;
  } & Record<string, unknown>;
}

export interface Entry {
  id: string;
  projectId: string | null;
  taskId: string | null;
  kind: EntryKind;
  revisionRoundId: string | null;
  workdayId: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface EntryContext {
  projectName: string | null;
  companyId: string | null;
  taskName: string | null;
  hulyKey: string | null;
  hulyUrl: string | null;
  estimateMinutes: number | null;
  revision: { number: number; title: string } | null;
  priorMs: number;
}

export interface TimerReview {
  reason: 'unattended_gap' | 'long_running';
  entryId: string;
  lastSeenAt: number;
  unattendedMs: number;
}

export interface TimerState {
  now: number;
  running: Entry | null;
  runningContext: EntryContext | null;
  break: Entry | null;
  lastStopped: Entry | null;
  lastStoppedContext: EntryContext | null;
  review: TimerReview | null;
  workdayId: string | null;
  breakPlannedEnd: number | null;
  resumeContext: EntryContext | null;
  lunchTaken: boolean;
}

export interface EntryWithContext extends Entry {
  source: string;
  note: string | null;
  context: EntryContext | null;
}

export interface WorkdaySummary {
  workday: { id: string; date: string; checkInAt: number; checkOutAt: number | null; expectedMinutes: number; morningBlocker: string | null; eveningBlocker?: string | null };
  durationMs: number;
  trackedMs: number;
  breakMs: number;
  untrackedMs: number;
  balanceMs: number | null;
  balanceTodayMinutes: number;
  runningBalanceMinutes: number;
}

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  statusId: string;
  planBucket: Bucket;
  estimateMinutes: number | null;
  hulyUrl: string | null;
  hulyKey: string | null;
  completedAt: number | null;
}

export interface ProjectSummary {
  id: string;
  companyId: string;
  name: string;
  reportName: string | null;
  statusId: string;
  categoryId: string;
  hulyUrl: string | null;
  totals: { total: number; direct: number };
  completion: { done: number; total: number; percent: number | null };
}

export type ReportType = 'morning' | 'evening' | 'lunch_start' | 'lunch_end';

export interface SavedReport {
  id: string;
  workdayId: string | null;
  type: ReportType;
  generatedText: string;
  finalText: string;
  copiedAt: number | null;
  sentAt: number | null;
  locked: boolean;
  createdAt: number;
}

export interface GeneratedReport {
  workdayId: string | null;
  text: string;
  projectIds?: string[];
  note?: string | null;
  balanceMinutes?: number;
}

export interface WorkdayReview {
  completed: Task[];
  inProgress: Task[];
  unfinished: Task[];
  revisions: { id: string; projectId: string; projectName: string; number: number; title: string; status: string; completedToday: boolean }[];
  trackedByTask: Record<string, number>;
  morningBlocker: string | null;
}
