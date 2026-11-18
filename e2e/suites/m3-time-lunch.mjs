/** M3: Time screen editing, Revision mode, Edit start, and the lunch flow. */
export default async function ({ page, api, base, step, shot, hm }) {
  const now = Date.now();
  await api('/api/workday/start', 'POST', { checkInAt: now - 180 * 60e3 });
  const statuses = (await api('/api/catalog')).statuses;
  const task = (await api('/api/plan/today')).find((t) => !statuses.find((s) => s.id === t.statusId).isDone);
  await api('/api/timer/start', 'POST', { projectId: task.projectId, taskId: task.id });

  await page.goto(base + '/time');
  await step('the Time screen lists this week with the running entry', async () => {
    await page.getByRole('heading', { name: 'Time' }).waitFor();
    await page.getByText('running').first().waitFor({ timeout: 5000 });
  });

  const s1 = new Date(now - 150 * 60e3);
  const e1 = new Date(now - 120 * 60e3);
  await step('add forgotten time to a project', async () => {
    await page.getByRole('button', { name: 'Add time' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Add time' });
    await dlg.getByLabel('Project', { exact: true }).selectOption({ label: 'DevM Blog' });
    await dlg.getByLabel('Start').fill(hm(s1));
    await dlg.getByLabel('End').fill(hm(e1));
    await dlg.getByLabel('Note (optional)').fill('call with editor');
    await dlg.getByRole('button', { name: 'Add time' }).click();
    await page.getByText('added').first().waitFor({ timeout: 5000 });
  });

  const row = () => page.locator('li', { has: page.getByText('added', { exact: true }) });
  await step('editing an end time inline updates the duration', async () => {
    const end = row().first().getByLabel('End');
    await end.fill(hm(new Date(s1.getTime() + 20 * 60e3)));
    await end.press('Enter');
    await row().first().getByText('20m').waitFor({ timeout: 5000 });
  });

  await step('split an entry in two', async () => {
    await row().first().getByRole('button', { name: 'Split' }).click();
    await page.getByRole('dialog', { name: 'Split entry' }).getByRole('button', { name: 'Split' }).click();
    await page.waitForTimeout(800);
    if ((await row().count()) < 2) throw new Error('expected 2 parts');
  });
  await shot('m3-time', { fullPage: true });

  await step('delete shows Undo, and Undo brings it back', async () => {
    const before = await row().count();
    await row().first().getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(1000);
    const after = await row().count();
    if (after !== before) throw new Error(`before ${before}, after ${after}`);
  });

  await step('Edit start moves the running timer earlier', async () => {
    const t = await api('/api/timer');
    await page.getByRole('button', { name: 'Edit start time' }).click();
    const dlg = page.getByRole('dialog', { name: 'When did you start?' });
    await dlg.getByLabel('Start time').fill(hm(new Date(t.running.startedAt - 5 * 60e3)));
    await dlg.getByRole('button', { name: 'Save' }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 5000 });
    const after = await api('/api/timer');
    const moved = Math.round((t.running.startedAt - after.running.startedAt) / 60e3);
    if (moved < 4 || moved > 6) throw new Error(`moved ${moved} min`);
  });
  await step('Revision mode switches the running timer to a new round', async () => {
    await page.getByRole('button', { name: 'Revision mode' }).click();
    const dlg = page.getByRole('dialog', { name: 'Revision mode' });
    await dlg.getByLabel('New revision round').fill('Client feedback, round 2');
    await dlg.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Revision mode' }).getByText('Revision on').waitFor({ timeout: 5000 });
  });
  await step('the timer bar stays on one line with Revision mode on', async () => {
    const box = await page.locator('header').first().boundingBox();
    if (box.height > 80) throw new Error(`timer bar is ${Math.round(box.height)}px tall`);
  });
  await shot('m3-timerbar-revision', { clip: { x: 0, y: 0, width: 1440, height: 120 } });

  await shot('m3-timerbar', { clip: { x: 0, y: 0, width: 1440, height: 120 } });

  // Make the lunch reminders due now and lunch 2 minutes long, so the alarm comes quickly.
  await api('/api/settings', 'PATCH', { lunchFirstReminder: hm(new Date(Date.now() - 2 * 60e3)), lunchSecondReminder: hm(new Date(Date.now() - 60e3)), lunchMinutes: 2 });
  await page.goto(base + '/');
  await step('the lunch prompt appears and Take lunch break starts lunch', async () => {
    const dlg = page.getByRole('dialog', { name: 'Time for lunch' });
    await dlg.waitFor({ timeout: 8000 });
    await shot('m3-lunch-prompt');
    await dlg.getByRole('button', { name: 'Take lunch break' }).click();
    await page.getByRole('dialog', { name: 'Enjoy your lunch' }).waitFor({ timeout: 5000 });
  });
  await step('the "Taking lunch break" message copies and is saved', async () => {
    await page.getByRole('dialog', { name: 'Enjoy your lunch' }).getByRole('button', { name: 'Copy message' }).click();
    await page.getByText('Copied · saved to history').waitFor({ timeout: 5000 });
    const hist = await api('/api/reports?limit=5');
    if (!hist.some((r) => r.type === 'lunch_start' && r.finalText === 'Taking lunch break')) throw new Error('not in history');
    await page.getByRole('dialog', { name: 'Enjoy your lunch' }).getByRole('button', { name: 'Close' }).click();
  });
  await step('the alarm 1 minute before the end extends lunch by 10 minutes', async () => {
    const dlg = page.getByRole('dialog', { name: 'Lunch ends in 1 minute' });
    await dlg.waitFor({ timeout: 90000 });
    await shot('m3-lunch-alarm');
    const before = (await api('/api/timer')).breakPlannedEnd;
    await dlg.getByRole('button', { name: '+10 min' }).click();
    await page.waitForTimeout(800);
    const after = (await api('/api/timer')).breakPlannedEnd;
    if (after - before < 10 * 60e3 - 1000) throw new Error('not extended');
    await dlg.waitFor({ state: 'hidden', timeout: 5000 });
  });
  await step('Back to work resumes the paused task', async () => {
    await page.getByRole('button', { name: /^Back to / }).click();
    await page.waitForTimeout(1200);
    const t = await api('/api/timer');
    if (!t.running || t.break) throw new Error('did not resume');
  });
}
