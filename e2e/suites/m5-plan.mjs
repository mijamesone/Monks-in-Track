/** M5: the Plan board (Backlog, This Week, Today). */
export default async function ({ page, api, base, step, shot }) {
  const board = async () => (await api('/api/plan')).columns;
  const names = (list) => list.map((t) => t.name);
  await page.goto(base + '/plan');
  const col = (name) => page.getByRole('region', { name, exact: true });

  await step('three columns with the sample tasks and the Today total against 8 hours', async () => {
    await col('Today').getByRole('listitem', { name: 'Onboarding screens v2' }).waitFor({ timeout: 5000 });
    await col('This Week').getByRole('listitem', { name: 'Blog visuals' }).waitFor();
    await page.getByRole('status', { name: "Today's planned time" }).getByText('Today 7h 30m of 8h 00m').waitFor();
    await shot('m5-plan', { fullPage: true });
  });

  await step('drag a This Week task to the top of Today; the total turns to over capacity', async () => {
    const card = col('This Week').getByRole('listitem', { name: 'Blog visuals' });
    const first = col('Today').getByRole('listitem').first();
    await card.dragTo(first, { targetPosition: { x: 40, y: 4 } });
    await page.getByRole('status', { name: "Today's planned time" }).getByText(/over capacity/).waitFor({ timeout: 5000 });
    const today = await board();
    if (today.today[0].name !== 'Blog visuals') throw new Error('order: ' + names(today.today).join(', '));
  });

  await step('the More menu moves a task down within its column', async () => {
    await col('Today').getByRole('button', { name: 'More for Blog visuals' }).click();
    await col('Today').getByRole('button', { name: 'Move Blog visuals down' }).click();
    await page.waitForTimeout(600);
    const today = (await board()).today;
    if (today[1].name !== 'Blog visuals') throw new Error('order: ' + names(today).join(', '));
  });

  await step('select two tasks and move them together to Backlog', async () => {
    await page.getByRole('checkbox', { name: 'Select Blog visuals' }).check();
    await page.getByRole('checkbox', { name: 'Select Case study visuals' }).check();
    const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
    await bar.getByText('2 selected').waitFor();
    await bar.getByRole('button', { name: 'Backlog', exact: true }).click();
    await col('Backlog').getByRole('listitem', { name: 'Case study visuals' }).waitFor({ timeout: 5000 });
    const b = await board();
    if (!names(b.backlog).includes('Blog visuals') || names(b.today).includes('Case study visuals')) throw new Error('not moved');
  });

  await step('moving a task with open subtasks asks, and moves them along', async () => {
    // page.on('dialog') in the runner accepts the "Move their open subtasks too?" question.
    const agency = (await board()).today.find((t) => t.name === '10 web agency in NY');
    const open = await api(`/api/tasks/${agency.id}/open-subtasks`);
    if (!open.length) throw new Error('sample has no open subtasks');
    await col('Today').getByRole('button', { name: 'More for 10 web agency in NY' }).click();
    await col('Today').getByRole('button', { name: 'This Week', exact: true }).click();
    await col('This Week').getByRole('listitem', { name: '10 web agency in NY' }).waitFor({ timeout: 5000 });
    const week = (await board()).this_week.map((t) => t.id);
    for (const id of open) if (!week.includes(id)) throw new Error('an open subtask stayed behind');
    await col('This Week').getByRole('listitem', { name: 'Inner visuals' }).getByText('10 web agency in NY ›').waitFor();
  });

  await step('the filter narrows every column', async () => {
    await page.getByLabel('Filter tasks').fill('FREEL');
    await col('Today').getByRole('listitem', { name: 'Onboarding screens v2' }).waitFor();
    if ((await col('This Week').getByRole('listitem', { name: '10 web agency in NY' }).count()) !== 0) throw new Error('filter did not hide');
    await page.getByLabel('Filter tasks').fill('');
  });

  await step('a column’s Add button opens Quick add for that column', async () => {
    await col('Backlog').getByRole('button', { name: 'Add to Backlog' }).click();
    const dlg = page.getByRole('dialog', { name: 'Quick add' });
    await dlg.waitFor();
    const v = await dlg.getByLabel('Plan for').inputValue();
    if (v !== 'backlog') throw new Error('plan for = ' + v);
    await page.keyboard.press('Escape');
  });
}
