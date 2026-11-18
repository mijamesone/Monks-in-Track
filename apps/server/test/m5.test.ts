import { describe, expect, it } from 'vitest';
import { HR, MIN, at, harness, seedRealProjects } from './helpers.ts';

const task = async (h: any, projectId: string, name: string, extra: Record<string, unknown> = {}) => (await h.send('POST', '/api/tasks', { projectId, name, ...extra })).body;
const ids = (list: any[]) => list.map((t) => t.id);

describe('Plan board', () => {
  it('moves tasks into a column at a position and renumbers the column', async () => {
    const h = harness(at(18, 9));
    const { dm } = await seedRealProjects(h);
    const a = await task(h, dm.id, 'A', { planBucket: 'today' });
    const b = await task(h, dm.id, 'B', { planBucket: 'today' });
    const c = await task(h, dm.id, 'C', { planBucket: 'backlog' });
    const d = await task(h, dm.id, 'D', { planBucket: 'backlog' });
    // Drop C between A and B.
    expect(ids((await h.send('POST', '/api/plan/move', { taskIds: [c.id], bucket: 'today', index: 1 })).body)).toEqual([a.id, c.id, b.id]);
    // Reorder inside Today: B to the top.
    expect(ids((await h.send('POST', '/api/plan/move', { taskIds: [b.id], bucket: 'today', index: 0 })).body)).toEqual([b.id, a.id, c.id]);
    // Multi-select: A and D to This Week, in the order given.
    expect(ids((await h.send('POST', '/api/plan/move', { taskIds: [d.id, a.id], bucket: 'this_week' })).body)).toEqual([d.id, a.id]);
    const board = (await h.get('/api/plan')).body;
    expect(ids(board.columns.today)).toEqual([b.id, c.id]);
    expect(board.columns.backlog).toHaveLength(0);
  });

  it('moves open subtasks along only when asked, and reports subtask counts', async () => {
    const h = harness(at(18, 9));
    const { dm } = await seedRealProjects(h);
    const parent = await task(h, dm.id, 'Blog post');
    const s1 = await task(h, dm.id, 'Cover', { parentId: parent.id });
    const s2 = await task(h, dm.id, 'Inner', { parentId: parent.id });
    await h.send('POST', `/api/tasks/${s2.id}/complete`, {});
    expect((await h.get('/api/plan')).body.subtaskCounts[parent.id]).toBe(1);
    await h.send('POST', '/api/plan/move', { taskIds: [parent.id], bucket: 'today' });
    expect(ids((await h.get('/api/plan/today')).body)).toEqual([parent.id]);
    await h.send('POST', '/api/plan/move', { taskIds: [parent.id], bucket: 'this_week', withSubtasks: true });
    expect(ids((await h.get('/api/plan/this_week')).body)).toEqual([parent.id, s1.id]);
    // Subtask cards show their parent's name.
    expect((await h.get('/api/plan')).body.parents[parent.id]).toBe('Blog post');
  });

  it('places a task before a given task even when hidden finished tasks sit in between', async () => {
    const h = harness(at(17, 9));
    const { dm } = await seedRealProjects(h);
    const a = await task(h, dm.id, 'A', { planBucket: 'today' });
    const hidden = await task(h, dm.id, 'Finished yesterday', { planBucket: 'today' });
    const b = await task(h, dm.id, 'B', { planBucket: 'today' });
    await h.send('POST', `/api/tasks/${hidden.id}/complete`, {});
    h.set(at(18, 9));
    expect(ids((await h.get('/api/plan')).body.columns.today)).toEqual([a.id, b.id]);
    // "Move A down" on screen = place A before nothing (after B).
    await h.send('POST', '/api/plan/move', { taskIds: [a.id], bucket: 'today', beforeTaskId: null, index: 999 });
    expect(ids((await h.get('/api/plan')).body.columns.today)).toEqual([b.id, a.id]);
    await h.send('POST', '/api/plan/move', { taskIds: [a.id], bucket: 'today', beforeTaskId: b.id });
    expect(ids((await h.get('/api/plan')).body.columns.today)).toEqual([a.id, b.id]);
  });

  it('hides rejected tasks and tasks finished on earlier days', async () => {
    const h = harness(at(17, 9));
    const { dm, status } = await seedRealProjects(h);
    const old = await task(h, dm.id, 'Done yesterday', { planBucket: 'today' });
    const rej = await task(h, dm.id, 'Rejected', { planBucket: 'this_week' });
    await h.send('POST', `/api/tasks/${old.id}/complete`, {});
    await h.send('PATCH', `/api/tasks/${rej.id}`, { statusId: status('rejected') });
    h.set(at(18, 9));
    const fresh = await task(h, dm.id, 'Done today', { planBucket: 'today' });
    await h.send('POST', `/api/tasks/${fresh.id}/complete`, {});
    const board = (await h.get('/api/plan')).body;
    expect(ids(board.columns.today)).toEqual([fresh.id]);
    expect(board.columns.this_week).toHaveLength(0);
  });
});

describe('Dashboard cards', () => {
  it('lists revisions due, quick-switch tasks, deadlines, completed today and alerts', async () => {
    const h = harness(at(18, 9));
    const { dm, mingle } = await seedRealProjects(h);
    const a = await task(h, mingle.id, 'Onboarding', { planBucket: 'today', estimateMinutes: 300, dueDate: '2026-11-17' });
    const b = await task(h, dm.id, 'Cover', { planBucket: 'today', estimateMinutes: 240, dueDate: '2026-11-20' });
    await h.send('POST', '/api/workday/start', {});
    await h.send('POST', '/api/timer/start', { projectId: mingle.id, taskId: a.id });
    h.set(at(18, 10));
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: b.id });
    h.set(at(18, 10, 30));
    await h.send('POST', `/api/tasks/${b.id}/complete`, {});
    await h.send('POST', `/api/projects/${mingle.id}/revisions`, { title: 'Feedback round' });
    const d = (await h.get('/api/dashboard')).body;
    expect(d.revisionsDue.map((r: any) => r.title)).toEqual(['Feedback round']);
    expect(ids(d.recentTasks)).toEqual([a.id]); // b is done, so not offered for a quick switch
    expect(d.deadlines.map((x: any) => [x.name, x.overdue])).toEqual([['Onboarding', true]]);
    expect(ids(d.completedToday)).toEqual([b.id]);
    expect(d.productivity.todayTrackedMs).toBe(90 * MIN);
    expect(d.alerts.todayEstimateMinutes).toBe(300);
    expect(d.alerts.overdue).toBe(1);
    // Company filter.
    const devm = (await h.catalog()).companies.find((c: any) => c.name === 'Devmonks').id;
    expect((await h.get(`/api/dashboard?companyId=${devm}`)).body.revisionsDue).toHaveLength(0);
  });
});

describe('Reports analytics', () => {
  it('adds top tasks, a daily series with the balance trend, estimate details, unfinished count and a tag filter', async () => {
    const h = harness(at(16, 9));
    const { dm, mingle } = await seedRealProjects(h);
    const a = await task(h, dm.id, 'Cover', { estimateMinutes: 60, planBucket: 'today' });
    const b = await task(h, mingle.id, 'Screens', { planBucket: 'this_week' });
    await h.send('POST', '/api/workday/start', {});
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: a.id });
    h.set(at(16, 11));
    await h.send('POST', `/api/tasks/${a.id}/complete`, {});
    h.set(at(16, 18, 30));
    await h.send('POST', '/api/workday/end', {});
    h.set(at(17, 9));
    await h.send('POST', '/api/workday/start', {});
    await h.send('POST', '/api/timer/start', { projectId: mingle.id, taskId: b.id });
    h.set(at(17, 12));
    await h.send('POST', '/api/timer/stop', {});
    h.set(at(17, 17, 0));
    await h.send('POST', '/api/workday/end', {});

    const r = (await h.get(`/api/analytics?from=${at(16, 0)}&to=${at(18, 0)}`)).body;
    expect(r.byTask.map((t: any) => [t.name, t.ms])).toEqual([
      ['Screens', 3 * HR],
      ['Cover', 2 * HR],
    ]);
    expect(r.series.map((d: any) => [d.date, d.trackedMs, d.balanceMinutes, d.runningBalanceMinutes])).toEqual([
      ['2026-11-16', 2 * HR, 30, 30],
      ['2026-11-17', 3 * HR, -60, -30],
    ]);
    expect(r.estimates.tasks[0]).toMatchObject({ name: 'Cover', estimateMs: HR, actualMs: 2 * HR });
    expect(r.tasksUnfinished).toBe(1);

    const [tag] = (await h.send('PUT', `/api/tasks/${b.id}/tags`, { names: ['carousel'] })).body;
    const tagged = (await h.get(`/api/analytics?from=${at(16, 0)}&to=${at(18, 0)}&tagId=${tag.id}`)).body;
    expect(tagged.trackedMs).toBe(3 * HR);
    expect(tagged.workdayMs).toBeNull();
    expect((await h.get(`/api/analytics?from=${at(18, 0)}&to=${at(16, 0)}`)).status).toBe(400);
  });
});
