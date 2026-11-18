/** M5: Dashboard cards (before and during work) and Reports analytics. */
export default async function ({ page, api, base, step, shot }) {
  const card = (name) => page.getByRole('region', { name, exact: true });

  await page.goto(base + '/');
  await step('before work: From This Week adds a task to Today; deadlines and meetings cards show', async () => {
    const week = (await api('/api/plan')).columns.this_week;
    const t = week[0];
    await card('From This Week').getByRole('button', { name: `Add ${t.name} to Today` }).click();
    await page.waitForTimeout(800);
    const today = (await api('/api/plan')).columns.today.map((x) => x.id);
    if (!today.includes(t.id)) throw new Error('not added to Today');
    await card('Deadlines').waitFor();
    await card("Today's meetings").getByText('Phase 3').waitFor();
    await shot('m5-dashboard-before', { fullPage: true });
  });

  // Start the day and a timer, then look at the during-work cards.
  await api('/api/workday/start', 'POST', { checkInAt: Date.now() - 60 * 60e3 });
  const recent = (await api('/api/dashboard')).recentTasks;
  await api('/api/timer/start', 'POST', { projectId: recent[0].projectId, taskId: recent[0].id });
  await page.reload();

  await step('during work: quick switch starts another recent task with one click', async () => {
    const other = recent[1];
    await card('Quick switch').getByRole('button', { name: `Switch to ${other.name}` }).click();
    await page.waitForTimeout(800);
    const t = await api('/api/timer');
    if (t.running?.taskId !== other.id) throw new Error('timer is on ' + t.running?.taskId);
  });

  await step('during work: productivity, alerts, completed today and revisions cards are present', async () => {
    await card('Productivity').getByText('tracked today').waitFor();
    await card('Alerts').getByText('Morning message not copied yet').waitFor({ timeout: 5000 });
    await card('Completed today').waitFor();
    await card('Revisions due').waitFor();
    await shot('m5-dashboard-during', { fullPage: true });
  });

  await page.goto(base + '/reports');
  const hours = page.getByRole('region', { name: 'Hours' });
  await step('Reports: this week shows totals and hours by project', async () => {
    await hours.getByText('tracked work', { exact: true }).waitFor({ timeout: 5000 });
    await card('By project').getByRole('link').first().waitFor();
    await shot('m5-reports-week', { fullPage: true });
  });

  await step('Reports: a project bar opens its time entries on the Time screen', async () => {
    const link = card('By project').getByRole('link').first();
    const name = (await link.getAttribute('aria-label')).split(':')[0];
    await link.click();
    await page.getByRole('heading', { name: 'Time' }).waitFor();
    await page.getByText(`Only ${name}`).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Show all projects' }).click();
    await page.getByText(`Only ${name}`).waitFor({ state: 'hidden' });
  });

  await page.goto(base + '/reports');
  await step('Reports: the previous week has a daily chart with a table view', async () => {
    await hours.getByRole('button', { name: 'Previous week' }).click();
    const daily = card('Tracked work per day');
    await daily.getByRole('button', { name: /tracked$/ }).first().waitFor({ timeout: 5000 });
    await daily.getByRole('button', { name: 'Show table' }).click();
    await daily.getByRole('table').waitFor();
    if ((await daily.getByRole('row').count()) < 6) throw new Error('table too short');
  });

  await step('Reports: the time balance chart shows a running total for ended workdays', async () => {
    await card('Time balance').getByText('Running total at the end of the period').waitFor();
  });

  await step('Reports: switching to month and filtering by category still adds up', async () => {
    await hours.getByRole('radio', { name: 'month' }).click();
    await hours.getByText('tracked work', { exact: true }).waitFor();
    const cat = (await api('/api/catalog')).categories.find((c) => c.name === 'Client Work');
    await hours.getByLabel('Category').selectOption(cat.id);
    await card('Client vs internal').getByText('Client Work').first().waitFor({ timeout: 5000 });
    // The previous numbers stay visible until the filtered ones arrive, so wait for Internal Work to go.
    await card('Client vs internal').getByText('Internal Work').waitFor({ state: 'hidden', timeout: 5000 });
    await shot('m5-reports-month', { fullPage: true });
  });
}
