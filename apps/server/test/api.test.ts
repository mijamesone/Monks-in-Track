import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HR, HULY, MIN, at, harness, seedRealProjects } from './helpers.ts';

describe('local-only safety', () => {
  it('rejects unknown hosts (DNS rebinding) and writes without the custom header', async () => {
    const h = harness();
    const { createApp } = await import('../src/app.ts');
    const app = createApp(h.ctx);
    expect((await app.request('/api/health', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await app.request('/api/companies', { method: 'POST', headers: { host: '127.0.0.1', 'content-type': 'application/json' }, body: '{"name":"X"}' })).status).toBe(403);
    expect((await h.get('/api/health')).status).toBe(200);
  });

  it('locks the API behind a PIN once one is set', async () => {
    const h = harness();
    expect((await h.send('POST', '/api/auth/pin', { pin: '2468' })).status).toBe(200);
    expect((await h.get('/api/catalog')).status).toBe(401);
    expect((await h.send('POST', '/api/auth/unlock', { pin: '1111' })).status).toBe(401);
    const ok = await h.send('POST', '/api/auth/unlock', { pin: '2468' });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie')!.split(';')[0]!;
    const res = await h.send('GET', '/api/catalog', undefined, { cookie });
    expect(res.status).toBe(200);
  });
});

describe('first run and structure', () => {
  it('seeds companies, categories, statuses and project types', async () => {
    const cat = await harness().catalog();
    expect(cat.companies.map((c: any) => c.name)).toEqual(['Designmonks', 'Devmonks']);
    expect(cat.categories.map((c: any) => c.name)).toEqual(['Client Work', 'Internal Work']);
    expect(cat.statuses).toHaveLength(8);
    expect(cat.statuses.find((s: any) => s.key === 'in_progress')).toMatchObject({ emoji: '🔃', reportText: 'In progress' });
    expect(cat.projectTypes).toHaveLength(7);
  });

  it('creates a project from just a name and a company, and filters by company', async () => {
    const h = harness();
    const cat = await h.catalog();
    const devm = cat.companies[1].id;
    const res = await h.send('POST', '/api/projects', { companyId: devm, name: 'DevM Blog' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'DevM Blog', categoryId: cat.categories[1].id });
    await h.send('POST', '/api/projects', { companyId: cat.companies[0].id, name: 'DM Blog' });
    const list = await h.get(`/api/projects?companyId=${devm}`);
    expect(list.body.map((p: any) => p.name)).toEqual(['DevM Blog']);
  });

  it('pasted Huly links file themselves by project code and are not duplicated', async () => {
    const h = harness();
    const cat = await h.catalog();
    const dm = (await h.send('POST', '/api/projects', { companyId: cat.companies[0].id, name: 'DM Blog' })).body;
    const first = await h.send('POST', '/api/quick-add', { text: `${HULY}BLOG_-653 10 web agency in NY 1hr 30min` });
    expect(first.body).toEqual({ status: 'needs_project', unknownCodes: ['BLOG_'] });
    const created = await h.send('POST', '/api/quick-add', { text: `${HULY}BLOG_-653 10 web agency in NY 1hr 30min`, projectId: dm.id });
    expect(created.body.tasks[0]).toMatchObject({ projectId: dm.id, name: '10 web agency in NY', estimateMinutes: 90, hulyKey: 'BLOG_-653', hulyUrl: `${HULY}BLOG_-653` });
    const again = await h.send('POST', '/api/quick-add', { text: `${HULY}BLOG_-653 and ${HULY}BLOG_-671` });
    expect(again.body.existing.map((t: any) => t.hulyKey)).toEqual(['BLOG_-653']);
    expect(again.body.tasks.map((t: any) => [t.hulyKey, t.projectId])).toEqual([['BLOG_-671', dm.id]]);
  });

  it('keeps archived projects in analytics', async () => {
    const h = harness(at(17, 10));
    const { dm } = await seedRealProjects(h);
    await h.send('POST', '/api/entries', { projectId: dm.id, taskId: null, kind: 'work', startedAt: at(17, 9), endedAt: at(17, 10) });
    await h.send('PATCH', `/api/projects/${dm.id}`, { archived: true });
    const a = await h.get(`/api/analytics?from=${at(17, 0)}&to=${at(18, 0)}`);
    expect(a.body.byProject).toEqual([{ id: dm.id, name: 'DM Blog', ms: HR }]);
  });
});

describe('time engine', () => {
  it('asks to start the workday first, then switching leaves no gap and no overlap', async () => {
    const h = harness(at(17, 9, 4));
    const { dm, mingle } = await seedRealProjects(h);
    const refused = await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null });
    expect(refused).toMatchObject({ status: 409, body: { error: { code: 'no_workday' } } });

    const first = await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null, startWorkday: true });
    expect(first.status).toBe(201);
    h.advance(42 * MIN);
    const second = await h.send('POST', '/api/timer/start', { projectId: mingle.id, taskId: null });
    const closed = h.db.prepare(`SELECT ended_at FROM time_entries WHERE id = ?`).get(first.body.id) as { ended_at: number };
    expect(closed.ended_at).toBe(second.body.startedAt);
    const running = h.db.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL`).get() as { n: number };
    expect(running.n).toBe(1);
  });

  it('the database itself refuses a second running timer', async () => {
    const h = harness();
    const { dm } = await seedRealProjects(h);
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null, startWorkday: true });
    expect(() =>
      h.db
        .prepare(`INSERT INTO time_entries (id, project_id, task_id, kind, started_at, created_at, updated_at) VALUES ('x', ?, NULL, 'work', 1, 1, 1)`)
        .run(dm.id),
    ).toThrow(/UNIQUE/);
  });

  it('totals add up with each entry counted once (3h 15m example)', async () => {
    const h = harness(at(17, 18));
    const { dm } = await seedRealProjects(h);
    const t1 = (await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'Task 1' })).body;
    const t2 = (await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'Task 2' })).body;
    const t2a = (await h.send('POST', '/api/tasks', { projectId: dm.id, parentId: t2.id, name: 'Subtask 2.1' })).body;
    const add = (taskId: string | null, s: number, e: number) => h.send('POST', '/api/entries', { projectId: dm.id, taskId, kind: 'work', startedAt: s, endedAt: e });
    await add(null, at(17, 9), at(17, 10));
    await add(t1.id, at(17, 10), at(17, 11));
    await add(t2.id, at(17, 11), at(17, 11, 30));
    await add(t2a.id, at(17, 12), at(17, 12, 45));
    const p = (await h.get(`/api/projects/${dm.id}`)).body;
    expect(p.totals.total).toBe(3 * HR + 15 * MIN);
    expect(p.totals.direct).toBe(HR);
    const tasks = (await h.get(`/api/projects/${dm.id}/tasks`)).body;
    expect(tasks.find((t: any) => t.id === t2.id).time).toEqual({ own: 30 * MIN, total: HR + 15 * MIN });
  });

  it('survives a refresh or restart: a running timer is just its start time', async () => {
    const h = harness(at(17, 9));
    const { dm } = await seedRealProjects(h);
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null, startWorkday: true });
    h.restart();
    // The open page sends a heartbeat every 30 seconds.
    for (let i = 0; i < 20; i++) {
      h.advance(30_000);
      await h.send('POST', '/api/heartbeat', { interaction: i === 19 });
    }
    const t = (await h.get('/api/timer')).body;
    expect(t.now - t.running.startedAt).toBe(10 * MIN);
    expect(t.review).toBeNull();
  });

  it('after sleep, asks what to do with the unattended stretch and can discard it', async () => {
    const h = harness(at(17, 17));
    const { mingle } = await seedRealProjects(h);
    const run = (await h.send('POST', '/api/timer/start', { projectId: mingle.id, taskId: null, startWorkday: true })).body;
    h.advance(MIN);
    await h.send('POST', '/api/heartbeat', {});
    h.set(at(17, 21, 55)); // computer slept from about 17:01
    const hb = (await h.send('POST', '/api/heartbeat', {})).body;
    expect(hb.review).toMatchObject({ reason: 'unattended_gap', lastSeenAt: at(17, 17, 1) });
    const resolved = (await h.send('POST', '/api/timer/review', { action: 'discard_unattended' })).body;
    expect(resolved).toMatchObject({ id: run.id, endedAt: at(17, 17, 1), source: 'review' });
  });

  it('flags a timer running 3 hours without interaction', async () => {
    const h = harness(at(17, 9));
    const { dm } = await seedRealProjects(h);
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null, startWorkday: true });
    for (let i = 0; i < 37; i++) {
      h.advance(5 * MIN);
      await h.send('POST', '/api/heartbeat', {}); // page open, no interaction
    }
    expect((await h.get('/api/timer')).body.review).toMatchObject({ reason: 'long_running' });
  });

  it('refuses an end before the start, and edits update totals immediately', async () => {
    const h = harness(at(17, 18));
    const { dm } = await seedRealProjects(h);
    const e = (await h.send('POST', '/api/entries', { projectId: dm.id, taskId: null, kind: 'work', startedAt: at(17, 9), endedAt: at(17, 10) })).body;
    const bad = await h.send('PATCH', `/api/entries/${e.id}`, { endedAt: at(17, 8) });
    expect(bad).toMatchObject({ status: 422, body: { error: { code: 'end_before_start' } } });
    await h.send('PATCH', `/api/entries/${e.id}`, { endedAt: at(17, 11) });
    expect((await h.get(`/api/projects/${dm.id}`)).body.totals.total).toBe(2 * HR);
  });

  it('can edit the start of the running timer, but not into the previous entry', async () => {
    const h = harness(at(17, 10));
    const { dm, mingle } = await seedRealProjects(h);
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null, startWorkday: true });
    h.advance(30 * MIN);
    await h.send('POST', '/api/timer/start', { projectId: mingle.id, taskId: null });
    h.advance(30 * MIN);
    expect((await h.send('PATCH', '/api/timer/start-time', { startedAt: at(17, 10, 20) })).status).toBe(422);
    expect((await h.send('PATCH', '/api/timer/start-time', { startedAt: at(17, 10, 30) })).body.startedAt).toBe(at(17, 10, 30));
  });

  it('moving a task moves its subtasks and their time to the new project', async () => {
    const h = harness(at(17, 18));
    const { dm, devm } = await seedRealProjects(h);
    const t = (await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'Cover' })).body;
    const sub = (await h.send('POST', '/api/tasks', { projectId: dm.id, parentId: t.id, name: 'Mobile crop' })).body;
    await h.send('POST', '/api/entries', { projectId: dm.id, taskId: sub.id, kind: 'work', startedAt: at(17, 9), endedAt: at(17, 10) });
    await h.send('POST', `/api/tasks/${t.id}/move`, { projectId: devm.id, parentId: null });
    expect((await h.get(`/api/projects/${dm.id}`)).body.totals.total).toBe(0);
    expect((await h.get(`/api/projects/${devm.id}`)).body.totals.total).toBe(HR);
  });

  it('completing a task stops its running timer and updates completion %', async () => {
    const h = harness(at(17, 9));
    const { dm } = await seedRealProjects(h);
    const a = (await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'A' })).body;
    await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'B' });
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: a.id, startWorkday: true });
    h.advance(20 * MIN);
    const done = (await h.send('POST', `/api/tasks/${a.id}/complete`, {})).body;
    expect(done.stoppedEntryId).not.toBeNull();
    expect((await h.get('/api/timer')).body.running).toBeNull();
    expect((await h.get(`/api/projects/${dm.id}`)).body.completion).toEqual({ done: 1, total: 2, percent: 50 });
  });

  it('lunch pauses work, counts in the workday but not in tracked time, and can resume', async () => {
    const h = harness(at(17, 13));
    const { dm } = await seedRealProjects(h);
    const work = (await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null, startWorkday: true })).body;
    h.set(at(17, 13, 31));
    const lunch = (await h.send('POST', '/api/breaks/start', { kind: 'lunch' })).body;
    expect(lunch.paused.id).toBe(work.id);
    h.set(at(17, 14, 31));
    const back = (await h.send('POST', '/api/breaks/end', { resume: true })).body;
    expect(back.resumed).toMatchObject({ projectId: dm.id, startedAt: at(17, 14, 31) });
    h.set(at(17, 15));
    const wd = (await h.get('/api/workday')).body.workday;
    expect(wd.breakMs).toBe(HR);
    expect(wd.trackedMs).toBe(31 * MIN + 29 * MIN);
  });
});

describe('workday and reports', () => {
  it('ending with a running timer asks first, then records the balance and the overtime note', async () => {
    const h = harness(at(17, 9, 4));
    const { dm } = await seedRealProjects(h);
    await h.send('POST', '/api/workday/start', { blocker: 'None' });
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null });
    h.set(at(17, 18, 34));
    expect((await h.send('POST', '/api/workday/end', {})).body.error.code).toBe('timer_running');
    const end = (await h.send('POST', '/api/workday/end', { running: { action: 'stop_now' } })).body;
    expect(end.durationMs).toBe(9 * HR + 30 * MIN);
    expect(end.balanceTodayMinutes).toBe(30);
    expect(end.runningBalanceMinutes).toBe(30);
    expect(end.note).toBe('Worked 30 mins extra today, will adjust on another office day.');
    expect(end.trackedMs + end.breakMs + end.untrackedMs).toBe(end.durationMs);
  });

  it('a 23:30–01:10 session belongs to the earlier workday', async () => {
    const h = harness(at(17, 20));
    const { dm } = await seedRealProjects(h);
    await h.send('POST', '/api/workday/start', {});
    h.set(at(17, 23, 30));
    const e = (await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null })).body;
    h.set(at(18, 1, 10));
    await h.send('POST', '/api/timer/stop');
    const wd = h.db.prepare(`SELECT date FROM workdays WHERE id = ?`).get(e.workdayId) as { date: string };
    expect(wd.date).toBe('2026-11-17');
  });

  it('carries unfinished Today tasks over and drops the ones you untick', async () => {
    const h = harness(at(17, 9));
    const { dm } = await seedRealProjects(h);
    const keep = (await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'Keep', planBucket: 'today' })).body;
    const drop = (await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'Drop', planBucket: 'today' })).body;
    const suggestions = (await h.get('/api/workday')).body.carryOver.map((t: any) => t.id);
    expect(suggestions).toEqual([keep.id, drop.id]);
    await h.send('POST', '/api/workday/start', { dropTaskIds: [drop.id] });
    expect((await h.get('/api/plan/today')).body.map((t: any) => t.id)).toEqual([keep.id]);
    expect((await h.get('/api/plan/this_week')).body.map((t: any) => t.id)).toEqual([drop.id]);
  });

  it('builds the morning report in your format, merging DM & DevM Blog', async () => {
    const h = harness(at(17, 9, 4));
    await seedRealProjects(h);
    for (const key of ['FREEL-548', 'BLOG_-653', 'DEV_B-48']) await h.send('POST', '/api/quick-add', { text: HULY + key, planBucket: 'today' });
    await h.send('POST', '/api/workday/start', { blocker: 'None' });
    const r = (await h.send('POST', '/api/reports/generate', { type: 'morning' })).body;
    expect(r.text).toBe(
      ['Started my day', '', "Today's Focus", '', 'Client Work', '(MP) Mingle 🔃 In progress', HULY + 'FREEL-548', '', 'Internal Work', 'DM & DevM Blog 🔃 In progress', HULY + 'BLOG_-653', HULY + 'DEV_B-48', '', 'Blocker: None'].join('\n'),
    );
  });

  it('builds the evening report from worked and completed tasks, and locks the copied text in history', async () => {
    const h = harness(at(17, 9, 4));
    const { dm, devm, status } = await seedRealProjects(h);
    const tasks: Record<string, any> = {};
    for (const key of ['FREEL-548', 'BLOG_-653', 'DEV_B-48']) tasks[key] = (await h.send('POST', '/api/quick-add', { text: HULY + key, planBucket: 'today' })).body.tasks[0];
    await h.send('POST', '/api/workday/start', {});
    await h.send('POST', '/api/timer/start', { projectId: tasks['FREEL-548'].projectId, taskId: tasks['FREEL-548'].id });
    h.set(at(17, 12));
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: tasks['BLOG_-653'].id });
    h.set(at(17, 15));
    await h.send('POST', `/api/tasks/${tasks['BLOG_-653'].id}/complete`, {});
    await h.send('POST', `/api/tasks/${tasks['DEV_B-48'].id}/complete`, {});
    await h.send('PATCH', `/api/projects/${dm.id}`, { statusId: status('done') });
    await h.send('PATCH', `/api/projects/${devm.id}`, { statusId: status('done') });
    h.set(at(17, 18, 34));
    await h.send('POST', '/api/workday/end', {});
    const r = (await h.send('POST', '/api/reports/generate', { type: 'evening' })).body;
    expect(r.text).toBe(
      ['Ending my day (Worked 30 mins extra today, will adjust on another office day.)', '', 'Client Work', '(MP) Mingle 🔃 In progress', HULY + 'FREEL-548', '', 'Internal Work', 'DM & DevM Blog ✅ Done', HULY + 'BLOG_-653', HULY + 'DEV_B-48', '', 'Blocker: None'].join('\n'),
    );
    const saved = (await h.send('POST', '/api/reports', { type: 'evening', workdayId: r.workdayId, generatedText: r.text, finalText: r.text + '\n', via: 'copy' })).body;
    expect(saved).toMatchObject({ locked: true, type: 'evening' });
    expect((await h.get('/api/reports')).body).toHaveLength(1);
  });

  it('analytics match the Time screen to the minute', async () => {
    const h = harness(at(21, 12));
    const { dm, devm, mingle } = await seedRealProjects(h);
    const add = (projectId: string, s: number, e: number) => h.send('POST', '/api/entries', { projectId, taskId: null, kind: 'work', startedAt: s, endedAt: e });
    await add(dm.id, at(16, 9), at(16, 11, 30));
    await add(devm.id, at(17, 9), at(17, 10, 15));
    await add(mingle.id, at(18, 14), at(18, 16));
    await add(dm.id, at(23, 9), at(23, 10)); // next week, excluded
    const week = (await h.get(`/api/analytics?from=${at(16, 0)}&to=${at(23, 0)}`)).body;
    expect(week.trackedMs).toBe(2.5 * HR + 1.25 * HR + 2 * HR);
    const cat = await h.catalog();
    const dmCompany = cat.companies.find((c: any) => c.name === 'Designmonks').id;
    expect(week.byCompany.find((c: any) => c.id === dmCompany).ms).toBe(4.5 * HR);
    const entries = (await h.get(`/api/entries?from=${at(16, 0)}&to=${at(23, 0)}`)).body;
    expect(entries.reduce((s: number, e: any) => s + (e.endedAt - e.startedAt), 0)).toBe(week.trackedMs);
  });
});

describe('backup', () => {
  it('writes a restorable copy of the database to the chosen folder', async () => {
    const h = harness(at(17, 12));
    await seedRealProjects(h);
    const folder = mkdtempSync(join(tmpdir(), 'mt-backup-'));
    await h.send('PATCH', '/api/settings', { backup: { folder, keepDays: 30, time: '12:00' } });
    const res = (await h.send('POST', '/api/backup')).body;
    expect(readdirSync(folder)).toHaveLength(1);
    const { openDatabase } = await import('../src/db/index.ts');
    const copy = openDatabase(res.file);
    expect((copy.prepare(`SELECT COUNT(*) AS n FROM projects`).get() as { n: number }).n).toBe(3);
    copy.close();
  });
});
