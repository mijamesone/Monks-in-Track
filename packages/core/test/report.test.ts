import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUSES,
  generateEveningReport,
  generateMorningReport,
  overtimeNote,
  type ReportCategory,
  type ReportGroup,
  type ReportProject,
  type ReportStatus,
} from '../src/index.ts';

const B = 'https://huly.designmonks.co/workbench/designmonks/tracker/';
const categories: ReportCategory[] = [
  { id: 'internal', name: 'Internal Work', order: 2 },
  { id: 'client', name: 'Client Work', order: 1 },
];
const statuses: ReportStatus[] = DEFAULT_STATUSES.map((s) => ({ id: s.key, emoji: s.emoji, reportText: s.reportText }));
const groups: ReportGroup[] = [{ id: 'blogs', label: 'DM & DevM Blog' }];

const mingle = (status = 'in_progress'): ReportProject => ({
  id: 'mingle',
  reportName: '(MP) Mingle',
  categoryId: 'client',
  statusId: status,
  groupId: null,
  hulyUrl: null,
  taskLinks: [B + 'FREEL-548'],
});

describe('evening report', () => {
  it('reproduces your real "DM & DevM Blog Done" message, with emoji before the word', () => {
    const text = generateEveningReport({
      categories,
      statuses,
      groups,
      blocker: 'None',
      projects: [
        mingle(),
        { id: 'dm', reportName: 'DM Blog', categoryId: 'internal', statusId: 'done', groupId: 'blogs', hulyUrl: null, taskLinks: ['BLOG_-653', 'BLOG_-671', 'BLOG_-672'].map((k) => B + k) },
        { id: 'devm', reportName: 'DevM Blog', categoryId: 'internal', statusId: 'done', groupId: 'blogs', hulyUrl: null, taskLinks: ['DEV_B-48', 'DEV_B-55', 'DEV_B-54', 'DEV_B-53', 'DEV_B-52'].map((k) => B + k) },
      ],
    });
    expect(text).toBe(
      [
        'Ending my day',
        '',
        'Client Work',
        '(MP) Mingle 🔃 In progress',
        B + 'FREEL-548',
        '',
        'Internal Work',
        'DM & DevM Blog ✅ Done',
        ...['BLOG_-653', 'BLOG_-671', 'BLOG_-672', 'DEV_B-48', 'DEV_B-55', 'DEV_B-54', 'DEV_B-53', 'DEV_B-52'].map((k) => B + k),
        '',
        'Blocker: None',
      ].join('\n'),
    );
  });

  it('keeps grouped projects apart when their statuses differ, and adds the overtime note', () => {
    const text = generateEveningReport({
      categories,
      statuses,
      groups,
      blocker: 'Mild Fever',
      headerNote: overtimeNote(30),
      projects: [
        mingle(),
        { id: 'dm', reportName: 'DM Blog', categoryId: 'internal', statusId: 'in_progress', groupId: 'blogs', hulyUrl: null, taskLinks: [B + 'BLOG_-671', B + 'BLOG_-653'] },
        { id: 'devm', reportName: 'DEV Blog', categoryId: 'internal', statusId: 'done', groupId: 'blogs', hulyUrl: null, taskLinks: [B + 'DEV_B-48'] },
      ],
    });
    expect(text.split('\n')).toEqual([
      'Ending my day (Worked 30 mins extra today, will adjust on another office day.)',
      '',
      'Client Work',
      '(MP) Mingle 🔃 In progress',
      B + 'FREEL-548',
      '',
      'Internal Work',
      'DM Blog 🔃 In progress',
      B + 'BLOG_-671',
      B + 'BLOG_-653',
      'DEV Blog ✅ Done',
      B + 'DEV_B-48',
      '',
      'Blocker: Mild Fever',
    ]);
  });

  it('adds a Revisions section only when asked (J5)', () => {
    const text = generateEveningReport({
      categories,
      statuses,
      groups,
      blocker: '',
      projects: [mingle()],
      revisions: [{ line: 'Blog Visual Revision ✅ Done', links: [B + 'BLOG_-653'] }],
    });
    expect(text).toContain('Revisions\nBlog Visual Revision ✅ Done\n' + B + 'BLOG_-653\n\nBlocker: None');
  });
});

describe('morning report', () => {
  it('has the Today’s Focus line, omits empty sections, and shows no status for To Do', () => {
    const text = generateMorningReport({
      categories,
      statuses,
      groups,
      blocker: 'None',
      projects: [
        { id: 'drib', reportName: 'Dribbble Thumbnail for branding service', categoryId: 'internal', statusId: 'todo', groupId: null, hulyUrl: null, taskLinks: [] },
      ],
    });
    expect(text).toBe(["Started my day", '', "Today's Focus", '', 'Internal Work', 'Dribbble Thumbnail for branding service', '', 'Blocker: None'].join('\n'));
  });

  it('falls back to the project Huly link when no task links are given', () => {
    const text = generateMorningReport({
      categories,
      statuses,
      groups,
      blocker: 'None',
      includeFocusLine: false,
      projects: [{ ...mingle(), taskLinks: [], hulyUrl: B + 'FREEL-548' }],
    });
    expect(text).toBe(['Started my day', '', 'Client Work', '(MP) Mingle 🔃 In progress', B + 'FREEL-548', '', 'Blocker: None'].join('\n'));
  });

  it('can turn group merging off', () => {
    const text = generateMorningReport({
      categories,
      statuses,
      groups,
      blocker: 'None',
      mergeGroups: false,
      projects: [
        { id: 'dm', reportName: 'DM Blog', categoryId: 'internal', statusId: 'in_progress', groupId: 'blogs', hulyUrl: null, taskLinks: [] },
        { id: 'devm', reportName: 'DevM Blog', categoryId: 'internal', statusId: 'in_progress', groupId: 'blogs', hulyUrl: null, taskLinks: [] },
      ],
    });
    expect(text).toContain('DM Blog 🔃 In progress\nDevM Blog 🔃 In progress');
  });
});
