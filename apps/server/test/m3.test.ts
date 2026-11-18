import { describe, expect, it } from 'vitest';
import { HR, MIN, at, harness, seedRealProjects } from './helpers.ts';

describe('lunch flow on the server', () => {
  it('stores the planned end, extends it, flags lunch taken, and says what Back to work resumes', async () => {
    const h = harness(at(18, 9, 0));
    const { dm } = await seedRealProjects(h);
    const task = (await h.send('POST', '/api/tasks', { projectId: dm.id, name: '10 web agency in NY' })).body;
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: task.id, startWorkday: true });
    expect((await h.get('/api/timer')).body.lunchTaken).toBe(false);

    h.set(at(18, 13, 31));
    await h.send('POST', '/api/breaks/start', { kind: 'lunch' });
    let t = (await h.get('/api/timer')).body;
    expect(t.breakPlannedEnd).toBe(at(18, 14, 31));
    expect(t.lunchTaken).toBe(true);
    expect(t.resumeContext).toMatchObject({ taskName: '10 web agency in NY', projectName: 'DM Blog' });

    h.set(at(18, 14, 30)); // the alarm moment: +10 min
    expect((await h.send('POST', '/api/breaks/extend', { minutes: 10 })).body.plannedEnd).toBe(at(18, 14, 41));
    t = (await h.get('/api/timer')).body;
    expect(t.breakPlannedEnd).toBe(at(18, 14, 41));

    h.set(at(18, 14, 41));
    const back = (await h.send('POST', '/api/breaks/end', { resume: true })).body;
    expect(back.resumed).toMatchObject({ taskId: task.id, startedAt: at(18, 14, 41) });
    t = (await h.get('/api/timer')).body;
    expect(t.breakPlannedEnd).toBeNull();
    expect(t.lunchTaken).toBe(true);
  });

  it('a short break uses the break length, and extending without a break fails', async () => {
    const h = harness(at(18, 10, 0));
    await h.send('POST', '/api/workday/start', {});
    expect((await h.send('POST', '/api/breaks/extend', { minutes: 5 })).body.error.code).toBe('no_break');
    await h.send('POST', '/api/breaks/start', { kind: 'break' });
    expect((await h.get('/api/timer')).body.breakPlannedEnd).toBe(at(18, 10, 10));
  });
});

describe('editing time', () => {
  it('splits an entry in two, both with the same owner, and totals do not change', async () => {
    const h = harness(at(18, 18));
    const { dm } = await seedRealProjects(h);
    const e = (await h.send('POST', '/api/entries', { projectId: dm.id, taskId: null, kind: 'work', startedAt: at(18, 9), endedAt: at(18, 11) })).body;
    const parts = (await h.send('POST', `/api/entries/${e.id}/split`, { at: at(18, 10, 15) })).body;
    expect(parts.map((p: any) => [p.startedAt, p.endedAt])).toEqual([
      [at(18, 9), at(18, 10, 15)],
      [at(18, 10, 15), at(18, 11)],
    ]);
    expect((await h.get(`/api/projects/${dm.id}`)).body.totals.total).toBe(2 * HR);
    expect((await h.send('POST', `/api/entries/${e.id}/split`, { at: at(18, 12) })).body.error.code).toBe('split_outside');
  });

  it('moves an entry to another project and its totals follow', async () => {
    const h = harness(at(18, 18));
    const { dm, mingle } = await seedRealProjects(h);
    const e = (await h.send('POST', '/api/entries', { projectId: dm.id, taskId: null, kind: 'work', startedAt: at(18, 9), endedAt: at(18, 9, 45) })).body;
    await h.send('PATCH', `/api/entries/${e.id}`, { projectId: mingle.id, taskId: null });
    expect((await h.get(`/api/projects/${dm.id}`)).body.totals.total).toBe(0);
    expect((await h.get(`/api/projects/${mingle.id}`)).body.totals.total).toBe(45 * MIN);
  });

  it('restarts a past entry as a new running timer on the same task', async () => {
    const h = harness(at(18, 9));
    const { dm } = await seedRealProjects(h);
    const task = (await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'Cover' })).body;
    await h.send('POST', '/api/workday/start', {});
    h.set(at(18, 11));
    const e = (await h.send('POST', '/api/entries', { projectId: dm.id, taskId: task.id, kind: 'work', startedAt: at(18, 9, 30), endedAt: at(18, 10) })).body;
    const r = (await h.send('POST', `/api/entries/${e.id}/restart`, {})).body;
    expect(r).toMatchObject({ taskId: task.id, startedAt: at(18, 11), endedAt: null });
  });

  it('refuses a manual entry in the future and an entry that ends before it starts', async () => {
    const h = harness(at(18, 12));
    const { dm } = await seedRealProjects(h);
    expect((await h.send('POST', '/api/entries', { projectId: dm.id, taskId: null, kind: 'work', startedAt: at(18, 11), endedAt: at(18, 13) })).body.error.code).toBe('end_in_future');
    expect((await h.send('POST', '/api/entries', { projectId: dm.id, taskId: null, kind: 'work', startedAt: at(18, 11), endedAt: at(18, 10) })).body.error.code).toBe('end_before_start');
  });
});

describe('editing the running start', () => {
  it('cannot move the start back into lunch (no minute counted as both work and lunch)', async () => {
    const h = harness(at(18, 13, 0));
    const { dm } = await seedRealProjects(h);
    await h.send('POST', '/api/workday/start', {});
    await h.send('POST', '/api/breaks/start', { kind: 'lunch' });
    h.set(at(18, 14, 0));
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: null }); // ends lunch at 14:00
    h.set(at(18, 14, 30));
    expect((await h.send('PATCH', '/api/timer/start-time', { startedAt: at(18, 13, 50) })).body.error.code).toBe('start_overlaps_previous');
    expect((await h.send('PATCH', '/api/timer/start-time', { startedAt: at(18, 14, 0) })).status).toBe(200);
  });
});
