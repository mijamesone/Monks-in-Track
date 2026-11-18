/** M4: Start Workday and End Workday wizards, the morning and evening messages, and message history. */
export default async function ({ page, api, base, step, shot, hm }) {
  const statuses = (await api('/api/catalog')).statuses;
  const open = (t) => { const st = statuses.find((x) => x.id === t.statusId); return !st.isDone && !st.isRejected; };
  const today = (await api('/api/plan/today')).filter(open);
  const week = await api('/api/plan/this_week');
  const dropped = today[today.length - 1];
  const added = week.filter(open)[0];

  await page.goto(base + '/');
  await step('Start Workday saves check-in at once and opens the wizard', async () => {
    await page.getByRole('button', { name: 'Start Workday' }).click();
    await page.getByRole('dialog', { name: 'Start Workday' }).waitFor({ timeout: 5000 });
    await page.getByText('Checked in at').waitFor({ timeout: 5000 });
    if (!(await api('/api/workday')).workday) throw new Error('no workday after opening');
  });
  const dlg = page.getByRole('dialog', { name: 'Start Workday' });

  await step('the check-in time can be corrected', async () => {
    const want = new Date(Date.now() - 20 * 60e3);
    await dlg.getByRole('button', { name: 'Edit' }).click();
    await dlg.getByLabel('Check-in time').fill(hm(want));
    await dlg.getByRole('button', { name: 'Save' }).click();
    await dlg.getByText(`Checked in at ${hm(want)}`).waitFor({ timeout: 5000 });
  });

  await step('carry over: unfinished Today tasks are ticked; untick one', async () => {
    await dlg.getByRole('checkbox', { name: `Carry over ${dropped.name}` }).waitFor();
    await shot('m4-carry-over');
    await dlg.getByRole('checkbox', { name: `Carry over ${dropped.name}` }).uncheck();
    await dlg.getByRole('button', { name: 'Next' }).click();
  });

  await step("today's focus: add from This Week and move it to the top", async () => {
    await dlg.getByRole('button', { name: `Add ${added.name} to focus` }).click();
    for (let i = 0; i < today.length; i++) {
      const up = dlg.getByRole('button', { name: `Move ${added.name} up` });
      if (await up.isDisabled()) break;
      await up.click();
    }
    const first = await dlg.getByRole('list', { name: "Today's focus" }).locator('li').first().innerText();
    if (!first.includes(added.name)) throw new Error('not first: ' + first);
    await page.waitForTimeout(600); // let the reorder animation settle for the screenshot
    await shot('m4-focus');
    await dlg.getByRole('button', { name: 'Next' }).click();
  });

  await step('blocker, then the morning message reflects focus and blocker', async () => {
    await dlg.getByLabel('Blocker').fill('Waiting for client copy');
    await dlg.getByRole('button', { name: 'Save and write message' }).click();
    const box = dlg.getByLabel('Morning message');
    await box.waitFor({ timeout: 5000 });
    await page.waitForFunction(() => (document.querySelector('#report-text')?.value ?? '').includes('Blocker: Waiting for client copy'), null, { timeout: 5000 });
    const text = await box.inputValue();
    if (!text.startsWith('Started my day')) throw new Error('first line: ' + text.split('\n')[0]);
    const thisWeek = await api('/api/plan/this_week');
    if (!thisWeek.some((t) => t.id === dropped.id)) throw new Error('unticked task did not move to This Week');
    const focus = await api('/api/plan/today');
    if (focus[0].id !== added.id) throw new Error('focus order not saved');
  });

  await step('a project status changed in the message updates the text', async () => {
    const cat = await api('/api/catalog');
    const review = cat.statuses.find((s) => s.key === 'in_review');
    const select = dlg.getByRole('combobox', { name: /^Status of / }).first();
    await select.selectOption(review.id);
    await page.waitForFunction((t) => (document.querySelector('#report-text')?.value ?? '').includes(t), [review.emoji, review.reportText].filter(Boolean).join(' '), { timeout: 5000 });
  });

  await step('edit the message, copy it, and the edited text is saved to history', async () => {
    const box = dlg.getByLabel('Morning message');
    await box.press('End');
    await box.pressSequentially(' Will share progress at 3pm.');
    await dlg.getByText('Edited', { exact: true }).waitFor();
    await shot('m4-morning-message');
    await dlg.getByRole('button', { name: 'Copy message' }).click();
    await dlg.getByText(/Copied at \d\d:\d\d · saved to history/).waitFor({ timeout: 5000 });
    const [saved] = await api('/api/reports?type=morning&limit=1');
    if (!saved.finalText.endsWith('Will share progress at 3pm.') || saved.finalText === saved.generatedText) throw new Error('edited text not saved');
    await dlg.getByRole('button', { name: 'Start working' }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 5000 });
    await page.getByText(/Morning message copied at/).waitFor({ timeout: 5000 });
  });

  // Some work: a finished task and a timer still running at check-out.
  const cat = await api('/api/catalog');
  const isOpen = (t) => { const st = cat.statuses.find((x) => x.id === t.statusId); return !st.isDone && !st.isRejected; };
  const focus = (await api('/api/plan/today')).filter(isOpen);
  await api('/api/timer/start', 'POST', { projectId: focus[0].projectId, taskId: focus[0].id });
  await api(`/api/tasks/${focus[0].id}/complete`, 'POST', {});
  await api('/api/timer/start', 'POST', { projectId: focus[1].projectId, taskId: focus[1].id });
  await page.reload();

  const end = page.getByRole('dialog', { name: 'End Workday' });
  await step('End Workday asks what to do with the running timer', async () => {
    await page.getByRole('button', { name: 'End Workday' }).click();
    await end.getByText('A timer is still running').waitFor({ timeout: 5000 });
    await end.getByLabel('Stop it at check-out').check();
    await end.getByRole('button', { name: 'Next' }).click();
  });

  await step('the review shows completed and in-progress work with the blocker prefilled', async () => {
    await end.getByRole('region', { name: 'Completed today' }).getByText(focus[0].name).waitFor({ timeout: 5000 });
    await end.getByRole('region', { name: 'Still in progress' }).getByText(focus[1].name).waitFor();
    if ((await end.getByLabel('Blocker').inputValue()) !== 'Waiting for client copy') throw new Error('blocker not prefilled');
    await end.getByLabel('Blocker').fill('None');
    await shot('m4-end-review');
    await end.getByRole('button', { name: 'Next' }).click();
  });

  await step('the evening message can drop the overtime note, and copying saves it', async () => {
    const box = end.getByLabel('Evening message');
    await page.waitForFunction(() => (document.querySelector('#report-text')?.value ?? '').startsWith('Ending my day ('), null, { timeout: 5000 });
    await end.getByLabel('Overtime note in the first line').uncheck();
    await page.waitForFunction(() => (document.querySelector('#report-text')?.value ?? '').split('\n')[0] === 'Ending my day', null, { timeout: 5000 });
    await shot('m4-evening-message');
    await end.getByRole('button', { name: 'Copy message' }).click();
    await end.getByText(/Copied at/).waitFor({ timeout: 5000 });
  });

  await step('End workday checks out, stops the timer, and the dashboard shows the day', async () => {
    await end.getByRole('button', { name: /^End workday at / }).click();
    await end.waitFor({ state: 'hidden', timeout: 5000 });
    await page.getByText(/Day complete/).waitFor({ timeout: 5000 });
    await page.getByText(/Evening message copied at/).waitFor();
    const t = await api('/api/timer');
    if (t.running) throw new Error('timer still running');
  });

  await step('Reports shows the message history with the edited morning message', async () => {
    await page.goto(base + '/reports');
    await page.getByRole('heading', { name: 'Message history' }).waitFor();
    const morning = page.getByLabel(/^Morning message, /).first();
    await morning.getByRole('button', { name: 'Show all' }).click();
    await morning.getByText('Will share progress at 3pm.').waitFor({ timeout: 5000 });
    await page.getByLabel(/^Evening message, /).first().waitFor();
    await shot('m4-history', { fullPage: true });
  });

  await step('Reopen workday returns to the working state', async () => {
    await page.goto(base + '/');
    await page.getByRole('button', { name: 'Reopen workday' }).click();
    await page.getByRole('button', { name: 'End Workday' }).waitFor({ timeout: 5000 });
  });
}
