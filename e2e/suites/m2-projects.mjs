/** M2: projects, nested tasks, Huly links, quick add, Settings wording. */
export default async function ({ page, api, base, step, shot }) {
  await page.goto(base + '/projects');
  await step('projects list shows the sample projects', async () => {
    await page.getByRole('link', { name: 'DM Blog', exact: true }).waitFor({ timeout: 5000 });
  });
  await shot('m2-projects');

  await step('create a project with only a name', async () => {
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Social Media Graphics');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('heading', { name: 'Social Media Graphics' }).waitFor({ timeout: 5000 });
  });

  await step('add a task with a typed estimate', async () => {
    const box = page.getByLabel('New task');
    await box.fill('Instagram carousel 1h 30m');
    await box.press('Enter');
    await page.getByRole('button', { name: 'Instagram carousel', exact: true }).waitFor({ timeout: 5000 });
    const est = await page.getByLabel('Estimate for Instagram carousel').inputValue();
    if (est !== '1h 30m') throw new Error('estimate was ' + est);
  });

  await step('add a second task and indent it under the first', async () => {
    const box = page.getByLabel('New task');
    await box.fill('Slide 1 cover');
    await box.press('Enter');
    await page.getByRole('button', { name: 'Slide 1 cover', exact: true }).waitFor({ timeout: 5000 });
    const row = page.locator('li', { has: page.getByRole('button', { name: 'Slide 1 cover', exact: true }) });
    await row.getByRole('button', { name: 'Indent (make subtask)' }).click();
    await page.getByRole('button', { name: 'Collapse subtasks' }).waitFor({ timeout: 5000 });
  });

  await step('a pasted Huly link becomes a linked task', async () => {
    const box = page.getByLabel('New task');
    await box.fill('https://huly.designmonks.co/workbench/designmonks/tracker/SOC-12 Story set 45m');
    await box.press('Enter');
    await page.getByRole('link', { name: 'SOC-12' }).waitFor({ timeout: 5000 });
  });

  await step('completing the subtask updates completion', async () => {
    await page.getByRole('checkbox', { name: 'Done: Slide 1 cover' }).click();
    await page.getByText('complete (1 of 2)').waitFor({ timeout: 5000 });
  });

  await step('the Overview tab saves the report name', async () => {
    await page.getByRole('tab', { name: 'overview' }).click();
    await page.getByLabel('Name in reports').fill('Social Graphics');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Reports as Social Graphics').waitFor({ timeout: 5000 });
  });

  await step('quick add (Q) files a known Huly code into its project', async () => {
    await page.goto(base + '/');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.keyboard.press('q');
    await page.getByRole('dialog', { name: 'Quick add' }).waitFor();
    await page.getByLabel('Task', { exact: true }).fill('https://huly.designmonks.co/workbench/designmonks/tracker/BLOG_-700 Mega menu visuals');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('Added 1 task').waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    const dm = (await api('/api/projects')).find((p) => p.name === 'DM Blog');
    const tasks = await api(`/api/projects/${dm.id}/tasks`);
    if (!tasks.some((t) => t.name === 'Mega menu visuals')) throw new Error('not filed into DM Blog');
  });

  await step('Settings: a status report text is saved', async () => {
    await page.goto(base + '/settings');
    await page.getByRole('button', { name: 'Statuses and report wording' }).click();
    const f = page.getByLabel('Report text for In Review');
    await f.fill('In review now');
    await f.blur();
    await page.waitForTimeout(500);
    const cat = await api('/api/catalog');
    if (cat.statuses.find((s) => s.key === 'in_review').reportText !== 'In review now') throw new Error('not saved');
  });
}
