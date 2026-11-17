import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBackupDue, runDueJobs } from '../src/services/scheduler.ts';
import { seedSample } from '../src/scripts/seed-sample.ts';
import { HULY, at, harness, seedRealProjects } from './helpers.ts';

describe('editable lists', () => {
  it('categories: add, rename, reorder for reports, and never archive the last one', async () => {
    const h = harness();
    const cat = await h.catalog();
    const freelance = (await h.send('POST', '/api/categories', { name: 'Freelance' })).body;
    await h.send('PATCH', `/api/categories/${freelance.id}`, { name: 'Side Work' });
    const order = (await h.send('PUT', '/api/categories/order', { ids: [cat.categories[1].id, freelance.id, cat.categories[0].id] })).body;
    expect(order.map((c: any) => c.name)).toEqual(['Internal Work', 'Side Work', 'Client Work']);
    await h.send('PATCH', `/api/categories/${freelance.id}`, { archived: true });
    await h.send('PATCH', `/api/categories/${cat.categories[0].id}`, { archived: true });
    const last = await h.send('PATCH', `/api/categories/${cat.categories[1].id}`, { archived: true });
    expect(last.body.error.code).toBe('last_category');
  });

  it('statuses: custom wording flows into reports; in-use and last-done statuses are protected', async () => {
    const h = harness(at(17, 9));
    const { dm, status } = await seedRealProjects(h);
    await h.send('PATCH', `/api/statuses/${status('in_progress')}`, { emoji: '⏳', reportText: 'Working on it' });
    await h.send('POST', '/api/quick-add', { text: HULY + 'BLOG_-653', planBucket: 'today' });
    await h.send('POST', '/api/workday/start', {});
    const r = (await h.send('POST', '/api/reports/generate', { type: 'morning' })).body;
    expect(r.text).toContain('DM Blog ⏳ Working on it');
    expect((await h.send('DELETE', `/api/statuses/${status('in_progress')}`)).body.error.code).toBe('status_in_use');
    expect((await h.send('PATCH', `/api/statuses/${status('done')}`, { isDone: false })).body.error.code).toBe('last_done_status');
    const custom = (await h.send('POST', '/api/statuses', { name: 'Waiting on client', emoji: '⌛' })).body;
    expect(custom).toMatchObject({ key: 'waiting_on_client', reportText: 'Waiting on client' });
    expect((await h.send('DELETE', `/api/statuses/${custom.id}`)).status).toBe(200);
    expect(dm).toBeTruthy();
  });

  it('tags: set by name, reuse case-insensitively, delete everywhere', async () => {
    const h = harness();
    const { mingle } = await seedRealProjects(h);
    const set = await h.send('PUT', `/api/projects/${mingle.id}/tags`, { names: ['Marketplace', 'urgent', 'marketplace'] });
    expect(set.status).toBe(200);
    const tags = (await h.get(`/api/projects/${mingle.id}/tags`)).body;
    expect(tags.map((t: any) => t.name)).toEqual(['Marketplace', 'urgent']);
    await h.send('DELETE', `/api/tags/${tags[1].id}`);
    expect((await h.get(`/api/projects/${mingle.id}/tags`)).body).toHaveLength(1);
  });

  it('report groups: create with projects, and deleting un-merges them', async () => {
    const h = harness(at(17, 9));
    const { dm, devm, group } = await seedRealProjects(h);
    await h.send('DELETE', `/api/report-groups/${group}`);
    for (const key of ['BLOG_-653', 'DEV_B-48']) await h.send('POST', '/api/quick-add', { text: HULY + key, planBucket: 'today' });
    await h.send('POST', '/api/workday/start', {});
    expect((await h.send('POST', '/api/reports/generate', { type: 'morning' })).body.text).toContain('DM Blog 🔃 In progress');
    await h.send('POST', '/api/report-groups', { label: 'DM & DevM Blog', projectIds: [dm.id, devm.id] });
    expect((await h.send('POST', '/api/reports/generate', { type: 'morning' })).body.text).toContain('DM & DevM Blog 🔃 In progress');
  });

  it('leave: ranges, half days, yearly usage against allowances, and expected hours drop to zero', async () => {
    const h = harness(at(17, 9));
    await h.send('PATCH', '/api/settings', { leaveAllowance: { annual: 14, sick: 10 } });
    await h.send('POST', '/api/leave', { from: '2026-11-24', to: '2026-11-25', type: 'annual' });
    await h.send('POST', '/api/leave', { from: '2026-11-27', type: 'sick', halfDay: true });
    expect((await h.send('POST', '/api/leave', { from: '2026-11-27', to: '2026-11-28', type: 'sick', halfDay: true })).status).toBe(422);
    const usage = (await h.get('/api/leave/usage?year=2026')).body;
    expect(usage.find((u: any) => u.type === 'annual')).toEqual({ type: 'annual', used: 2, allowance: 14, remaining: 12 });
    expect(usage.find((u: any) => u.type === 'sick')).toEqual({ type: 'sick', used: 0.5, allowance: 10, remaining: 9.5 });
    h.set(at(24, 10));
    await h.send('POST', '/api/workday/start', {});
    expect((await h.get('/api/workday')).body.workday.workday.expectedMinutes).toBe(0);
  });
});

describe('daily backup schedule', () => {
  it('is due once per day, at or after the set time, even if the PC was off at that time', () => {
    expect(isBackupDue(at(17, 11, 59), '12:00', null)).toBe(false);
    expect(isBackupDue(at(17, 12, 0), '12:00', null)).toBe(true);
    expect(isBackupDue(at(17, 15, 0), '12:00', at(17, 12, 1))).toBe(false);
    expect(isBackupDue(at(17, 15, 0), '12:00', at(16, 12, 1))).toBe(true);
    expect(isBackupDue(at(17, 15, 0), '12:00', at(17, 9, 0))).toBe(true);
  });

  it('runs when due and records failures without crashing', async () => {
    const h = harness(at(17, 12, 30));
    expect((await runDueJobs(h.ctx)).backedUp).toBeNull(); // no folder chosen yet
    const folder = mkdtempSync(join(tmpdir(), 'mt-sched-'));
    await h.send('PATCH', '/api/settings', { backup: { folder, keepDays: 30, time: '12:00' } });
    expect((await runDueJobs(h.ctx)).backedUp).toContain(folder);
    expect((await runDueJobs(h.ctx)).backedUp).toBeNull(); // already done today
    expect(readdirSync(folder)).toHaveLength(1);
  });
});

describe('sample data', () => {
  it('builds a valid week through the real services', async () => {
    const h = harness(at(17, 8));
    const result = seedSample(h.ctx, h.clock, new Date(2026, 10, 17));
    expect(result).toEqual({ projects: 5, tasks: 14, workdays: 5 });
    const reports = (await h.get('/api/reports')).body;
    expect(reports).toHaveLength(10);
    const firstEvening = reports.filter((r: any) => r.type === 'evening').at(-1);
    expect(firstEvening.finalText).toContain('DevM Blog');
    expect(firstEvening.finalText.startsWith('Ending my day')).toBe(true);
    const running = h.db.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL`).get() as { n: number };
    expect(running.n).toBe(0);
    const today = (await h.get('/api/plan/today')).body.map((t: any) => t.name);
    expect(today).toEqual(expect.arrayContaining(['10 web agency in NY', 'Onboarding screens v2', 'Case study visuals']));
  });
});
