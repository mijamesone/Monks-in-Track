import { describe, expect, it } from 'vitest';
import { completion, extractHulyLinks, hulyTaskUrl, parseHhMm, parseHulyUrl, parseTitleEstimate } from '../src/index.ts';

const BASE = 'https://huly.designmonks.co/workbench/designmonks/tracker/';

describe('parseHulyUrl', () => {
  it.each([
    ['BLOG_-653', 'BLOG_', 653],
    ['DEV_B-48', 'DEV_B', 48],
    ['FREEL-548', 'FREEL', 548],
  ])('%s → code %s, number %d', (id, code, num) => {
    const link = parseHulyUrl(BASE + id);
    expect(link).toMatchObject({ workspace: 'designmonks', identifier: id, projectCode: code, number: num, origin: 'https://huly.designmonks.co' });
    expect(link?.url).toBe(BASE + id);
  });

  it('ignores trailing slashes, queries and hashes', () => {
    expect(parseHulyUrl(`${BASE}BLOG_-653/?tab=comments#x`)?.identifier).toBe('BLOG_-653');
  });

  it('uses the last dash, so codes containing dashes still work', () => {
    expect(parseHulyUrl(`${BASE}MY-CODE-12`)).toMatchObject({ projectCode: 'MY-CODE', number: 12 });
  });

  it.each(['not a url', 'https://huly.designmonks.co/workbench/designmonks/documents/X-1', `${BASE}BLOG_`, `${BASE}-12`, 'ftp://x/workbench/a/tracker/A-1'])(
    'rejects %s',
    (bad) => {
      expect(parseHulyUrl(bad)).toBeNull();
    },
  );

  it('extracts every link from pasted text, without duplicates', () => {
    const text = `Done today:\n${BASE}BLOG_-653\n${BASE}DEV_B-48, ${BASE}BLOG_-653.`;
    expect(extractHulyLinks(text).map((l) => l.identifier)).toEqual(['BLOG_-653', 'DEV_B-48']);
  });

  it('rebuilds a task URL', () => {
    expect(hulyTaskUrl('https://huly.designmonks.co/', 'designmonks', 'FREEL-548')).toBe(BASE + 'FREEL-548');
  });
});

describe('parseTitleEstimate', () => {
  it.each([
    ['Prepare slides 28 min', 'Prepare slides', 28],
    ['Write blog post 1 hr', 'Write blog post', 60],
    ['Email campaign 2hr 15min', 'Email campaign', 135],
    ['Blog cover 1h30m', 'Blog cover', 90],
    ['Deep work 2 hours', 'Deep work', 120],
    ['Quick fix 1.5h', 'Quick fix', 90],
  ])('%s', (input, title, minutes) => {
    expect(parseTitleEstimate(input)).toEqual({ title, estimateMinutes: minutes });
  });

  it.each(['10 web agency in NY', 'Top 5 mistakes', '30 min'])('leaves "%s" alone', (input) => {
    expect(parseTitleEstimate(input)).toEqual({ title: input, estimateMinutes: null });
  });

  it('parses HH:MM fields', () => {
    expect(parseHhMm('01:30')).toBe(90);
    expect(parseHhMm('1:75')).toBeNull();
  });
});

describe('completion (rule 13, J4)', () => {
  const items = [
    { id: 'a', parentId: null, done: false, rejected: false },
    { id: 'a1', parentId: 'a', done: true, rejected: false },
    { id: 'a2', parentId: 'a', done: false, rejected: false },
    { id: 'a3', parentId: 'a', done: false, rejected: false },
    { id: 'b', parentId: null, done: false, rejected: false },
    { id: 'c', parentId: null, done: false, rejected: true },
    { id: 'd', parentId: null, done: true, rejected: false, archived: true },
  ];

  it('counts finished leaves over all leaves, leaving out rejected and archived', () => {
    expect(completion(items)).toEqual({ done: 1, total: 4, percent: 25 });
  });

  it('returns null percent with nothing to count', () => {
    expect(completion([])).toEqual({ done: 0, total: 0, percent: null });
  });
});
