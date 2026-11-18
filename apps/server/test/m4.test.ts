import { describe, expect, it } from 'vitest';
import { HULY, at, harness, seedRealProjects } from './helpers.ts';

const task = async (h: any, projectId: string, name: string, extra: Record<string, unknown> = {}) => (await h.send('POST', '/api/tasks', { projectId, name, ...extra })).body;

describe('Start Workday wizard', () => {
  it('saves the focus order, moves left-out Today tasks to This Week, and the morning preview follows the picked order', async () => {
    const h = harness(at(18, 9, 0));
    const { dm, mingle } = await seedRealProjects(h);
    const a = await task(h, mingle.id, 'Onboarding screens', { planBucket: 'today', hulyUrl: `${HULY}FREEL-548` });
    const b = await task(h, dm.id, '10 web agency in NY', { planBucket: 'today', hulyUrl: `${HULY}BLOG_-653` });
    const c = await task(h, dm.id, 'Cover image', { planBucket: 'this_week' });
    const wd = (await h.send('POST', '/api/workday/start', {})).body;

    // Preview while choosing: DM Blog first because its task is first.
    const preview = (await h.send('POST', '/api/reports/generate', { type: 'morning', focusTaskIds: [b.id, a.id], blocker: 'Waiting for copy' })).body;
    expect(preview.text).toContain(`${HULY}BLOG_-653`);
    expect(preview.text).toContain('Blocker: Waiting for copy');
    expect(preview.projectIds).toEqual(expect.arrayContaining([dm.id, mingle.id]));

    const today = (await h.send('POST', '/api/workday/focus', { focusTaskIds: [c.id, b.id] })).body;
    expect(today.map((t: any) => t.id)).toEqual([c.id, b.id]);
    const week = (await h.get('/api/plan/this_week')).body;
    expect(week.map((t: any) => t.id)).toContain(a.id);

    await h.send('PATCH', `/api/workday/${wd.workday.id}/blocker`, { which: 'morning', blocker: '  ' });
    expect((await h.get('/api/workday')).body.workday.workday.morningBlocker).toBeNull();
  });

  it('a merge override in the preview keeps DM Blog and DevM Blog apart', async () => {
    const h = harness(at(18, 9, 0));
    const { dm, devm } = await seedRealProjects(h);
    const a = await task(h, dm.id, 'Post A', { planBucket: 'today' });
    const b = await task(h, devm.id, 'Post B', { planBucket: 'today' });
    await h.send('POST', '/api/workday/start', {});
    const merged = (await h.send('POST', '/api/reports/generate', { type: 'morning', focusTaskIds: [a.id, b.id] })).body.text;
    const apart = (await h.send('POST', '/api/reports/generate', { type: 'morning', focusTaskIds: [a.id, b.id], mergeGroups: false })).body.text;
    expect(merged).toContain('DM & DevM Blog');
    expect(apart).toContain('DM Blog');
    expect(apart).toContain('DevM Blog');
    expect(apart).not.toContain('DM & DevM Blog');
  });
});

describe('End Workday wizard', () => {
  it('reviews the day: completed, in progress, unfinished, and revisions', async () => {
    const h = harness(at(18, 9, 0));
    const { dm, mingle } = await seedRealProjects(h);
    const done = await task(h, dm.id, 'Done one', { planBucket: 'today' });
    const going = await task(h, mingle.id, 'Still going', { planBucket: 'today' });
    const untouched = await task(h, dm.id, 'Not touched', { planBucket: 'today' });
    const wd = (await h.send('POST', '/api/workday/start', {})).body.workday;
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: done.id });
    h.set(at(18, 10, 0));
    await h.send('POST', `/api/tasks/${done.id}/complete`, {});
    await h.send('POST', '/api/timer/start', { projectId: mingle.id, taskId: going.id });
    await h.send('POST', `/api/projects/${mingle.id}/revisions`, { title: 'Client feedback' });
    h.set(at(18, 11, 0));
    const r = (await h.get(`/api/workday/${wd.id}/review`)).body;
    expect(r.completed.map((t: any) => t.id)).toEqual([done.id]);
    expect(r.inProgress.map((t: any) => t.id)).toEqual([going.id]);
    expect(r.unfinished.map((t: any) => t.id)).toEqual([untouched.id]);
    expect(r.revisions).toHaveLength(1);
    expect(r.revisions[0]).toMatchObject({ title: 'Client feedback', completedToday: false });
    expect(r.trackedByTask[going.id]).toBe(60 * 60_000);
  });

  it('the evening preview uses the planned check-out time for the overtime note, and check-out cannot be in the future', async () => {
    const h = harness(at(18, 9, 0));
    await seedRealProjects(h);
    await h.send('POST', '/api/workday/start', {});
    h.set(at(18, 18, 40));
    const preview = (await h.send('POST', '/api/reports/generate', { type: 'evening', at: at(18, 18, 30) })).body;
    expect(preview.text.split('\n')[0]).toBe('Ending my day (Worked 30 mins extra today, will adjust on another office day.)');
    expect(preview.balanceMinutes).toBe(30);
    const noNote = (await h.send('POST', '/api/reports/generate', { type: 'evening', at: at(18, 18, 30), includeNote: false })).body;
    expect(noNote.text.split('\n')[0]).toBe('Ending my day');

    expect((await h.send('POST', '/api/workday/end', { at: at(18, 18, 50) })).body.error.code).toBe('end_in_future');
    const ended = (await h.send('POST', '/api/workday/end', { at: at(18, 18, 30) })).body;
    expect(ended.workday.checkOutAt).toBe(at(18, 18, 30));
    expect(ended.balanceTodayMinutes).toBe(30);
  });
});

describe('report history', () => {
  it('filters by workday and type', async () => {
    const h = harness(at(18, 9, 0));
    await seedRealProjects(h);
    const wd = (await h.send('POST', '/api/workday/start', {})).body.workday;
    const save = (type: string) => h.send('POST', '/api/reports', { type, workdayId: wd.id, generatedText: 'x', finalText: 'x', via: 'copy' });
    await save('morning');
    await save('lunch_start');
    expect((await h.get(`/api/reports?workdayId=${wd.id}&type=morning`)).body).toHaveLength(1);
    expect((await h.get(`/api/reports?workdayId=${wd.id}`)).body).toHaveLength(2);
  });
});
