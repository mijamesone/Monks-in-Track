/**
 * First-run defaults (spec section 0 decisions). Everything here is editable in Settings.
 */

export const DEFAULT_COMPANIES = [
  { name: 'Designmonks', shortName: 'DM' },
  { name: 'Devmonks', shortName: 'DevM' },
] as const;

export const DEFAULT_CATEGORIES = [
  { name: 'Client Work', order: 1 },
  { name: 'Internal Work', order: 2 },
] as const;

export const DEFAULT_PROJECT_TYPES = [
  'Blog Post Design',
  'Social Media Design',
  'App Store Screenshot Design',
  'Website Design',
  'UI/UX Design',
  'Branding',
  'Other',
] as const;

export interface DefaultStatus {
  key: string;
  name: string;
  emoji: string;
  reportText: string;
  isDone: boolean;
  isRejected: boolean;
  order: number;
}

/** R9: emoji first, then the word, after the project name. To Do shows no status. */
export const DEFAULT_STATUSES: readonly DefaultStatus[] = [
  { key: 'todo', name: 'To Do', emoji: '', reportText: '', isDone: false, isRejected: false, order: 1 },
  { key: 'in_progress', name: 'In Progress', emoji: '🔃', reportText: 'In progress', isDone: false, isRejected: false, order: 2 },
  { key: 'in_review', name: 'In Review', emoji: '👀', reportText: 'In review', isDone: false, isRejected: false, order: 3 },
  { key: 'revision', name: 'Revision', emoji: '🔁', reportText: 'Revision', isDone: false, isRejected: false, order: 4 },
  { key: 'done', name: 'Done', emoji: '✅', reportText: 'Done', isDone: true, isRejected: false, order: 5 },
  { key: 'rejected', name: 'Rejected', emoji: '❌', reportText: 'Rejected', isDone: false, isRejected: true, order: 6 },
  { key: 'on_hold', name: 'On Hold', emoji: '⏸️', reportText: 'On hold', isDone: false, isRejected: false, order: 7 },
  { key: 'blocked', name: 'Blocked', emoji: '⛔', reportText: 'Blocked', isDone: false, isRejected: false, order: 8 },
];

export const DEFAULT_SETTINGS = {
  /** HH:MM local. */
  officeStart: '09:00',
  officeEnd: '18:00',
  workingDays: [1, 2, 3, 4, 5],
  fullDayMinutes: 9 * 60,
  halfDayMinutes: 4 * 60,
  lunchFirstReminder: '13:20',
  lunchSecondReminder: '13:30',
  lunchMinutes: 60,
  lunchExtendOptions: [5, 10, 15],
  idleMinutes: 10,
  forgottenTimerMinutes: 180,
  heartbeatGapMinutes: 5,
  shortBreakEveryMinutes: 90,
  inTaskChimeMinutes: 0,
  pomodoro: { focus: 25, shortBreak: 5, longBreak: 15 },
  report: { includeFocusLine: true, mergeGroups: true, revisionsSection: false },
  backup: { folder: null as string | null, keepDays: 30, time: '12:00' },
  /** Days per calendar year, entered by hand in Settings (decision R12). Missing = not tracked. */
  leaveAllowance: {} as Partial<Record<'sick' | 'annual' | 'alter' | 'earned', number>>,
  autoLockMinutes: 30,
} as const;

export type Settings = typeof DEFAULT_SETTINGS;
