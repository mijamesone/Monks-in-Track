/**
 * Phase 1 acceptance gate: the checklist points that need a real browser (docs/ACCEPTANCE.md).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default async function ({ page, api, base, step, shot }) {
  const outside = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
  });

  await step('the app makes no request outside this computer (works offline)', async () => {
    for (const path of ['/', '/plan', '/projects', '/time', '/reports', '/settings']) {
      await page.goto(base + path);
      await page.waitForLoadState('networkidle');
    }
    if (outside.length) throw new Error('outside requests: ' + outside.slice(0, 3).join(', '));
  });

  await step('the company switcher filters Projects, Plan, Time, Dashboard and Reports', async () => {
    const cat = await api('/api/catalog');
    const dm = cat.companies.find((c) => c.name === 'Designmonks');
    await page.goto(base + '/projects');
    await page.getByRole('link', { name: 'DevM Blog', exact: true }).waitFor({ timeout: 5000 });
    await page.getByLabel('Company', { exact: true }).first().selectOption(dm.id);
    await page.getByRole('link', { name: 'DevM Blog', exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
    await page.goto(base + '/plan');
    await page.getByRole('region', { name: 'Today', exact: true }).getByRole('listitem').first().waitFor();
    if (await page.getByText('DevM Blog', { exact: true }).count()) throw new Error('Plan shows DevM Blog');
    await page.goto(base + '/time');
    await page.getByRole('heading', { name: 'Time' }).waitFor();
    await page.waitForTimeout(800);
    if (await page.getByText('DevM Blog', { exact: true }).count()) throw new Error('Time shows DevM Blog');
    await page.goto(base + '/reports');
    const byCompany = page.getByRole('region', { name: 'By company', exact: true });
    await byCompany.getByText('Designmonks').waitFor({ timeout: 5000 });
    if (await byCompany.getByText('Devmonks').count()) throw new Error('Reports shows Devmonks');
    await page.getByLabel('Company', { exact: true }).first().selectOption('all');
  });

  await step('finishing a task with an estimate says how it went', async () => {
    const today = (await api('/api/plan')).columns.today;
    const t = today.find((x) => x.estimateMinutes);
    await api('/api/workday/start', 'POST', {});
    await page.goto(base + '/');
    await page.getByRole('button', { name: `Mark ${t.name} done` }).click();
    await page.getByRole('status').getByText(/^Finished .*(early|over the estimate|right on the estimate)$/).waitFor({ timeout: 5000 });
    await shot('gate-finish-toast');
  });

  await step('the timer counts down against the estimate, then shows the time over it', async () => {
    const dm = (await api('/api/projects')).find((p) => p.name === 'DM Blog');
    const fresh = await api('/api/tasks', 'POST', { projectId: dm.id, name: 'Countdown check', estimateMinutes: 120 });
    const small = await api('/api/tasks', 'POST', { projectId: dm.id, name: 'Overtime check', estimateMinutes: 5 });
    await api('/api/entries', 'POST', { projectId: dm.id, taskId: small.id, kind: 'work', startedAt: Date.now() - 40 * 60e3, endedAt: Date.now() - 30 * 60e3 });
    await api('/api/timer/start', 'POST', { projectId: dm.id, taskId: fresh.id });
    await page.goto(base + '/');
    await page.locator('header').getByText(/^1:59:\d\d left$|^01:59:\d\d left$/).waitFor({ timeout: 5000 });
    await api('/api/timer/start', 'POST', { projectId: dm.id, taskId: small.id });
    await page.reload();
    await page.locator('header').getByText(/0?0?:?0?5:\d\d over$/).waitFor({ timeout: 5000 });
  });

  await step('a running timer survives closing the browser, with no time lost', async () => {
    const today = (await api('/api/plan')).columns.today;
    const cat = await api('/api/catalog');
    const t = today.find((x) => !cat.statuses.find((s) => s.id === x.statusId).isDone);
    await api('/api/timer/start', 'POST', { projectId: t.projectId, taskId: t.id });
    const before = (await api('/api/timer')).running;
    // Leave the app entirely (its page is unloaded, like a closed tab), wait, and come back.
    await page.goto('about:blank');
    await new Promise((r) => setTimeout(r, 3000));
    await page.goto(base + '/');
    await page.getByRole('button', { name: 'Pause timer' }).waitFor({ timeout: 5000 });
    const after = (await api('/api/timer')).running;
    if (after.id !== before.id || after.startedAt !== before.startedAt) throw new Error('the running entry changed');
  });

  const folder = mkdtempSync(join(tmpdir(), 'mt-gate-backups-'));
  await step('Settings: choose a backup folder and back up now', async () => {
    await page.goto(base + '/settings');
    await page.getByRole('button', { name: 'Backups', exact: true }).click();
    await page.getByLabel('Backup folder').fill(folder);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Back up now' }).click();
    await page.getByRole('list', { name: 'Backups' }).getByRole('listitem').first().waitFor({ timeout: 5000 });
    await shot('gate-backups');
  });

  await step('Settings: restoring a backup brings the data back and keeps a safety copy', async () => {
    const dm = (await api('/api/projects')).find((p) => p.name === 'DM Blog');
    await api(`/api/projects/${dm.id}`, 'PATCH', { name: 'Changed after backup' });
    await page.reload();
    await page.getByRole('button', { name: 'Backups', exact: true }).click();
    await page.getByRole('list', { name: 'Backups' }).getByRole('button', { name: /^Restore / }).first().click();
    await page.getByRole('status').getByText(/^Restored\./).waitFor({ timeout: 8000 });
    const back = await api(`/api/projects/${dm.id}`);
    if (back.name !== 'DM Blog') throw new Error('name is ' + back.name);
    await page.getByRole('list', { name: 'Backups' }).getByText(/saved before a restore/).waitFor({ timeout: 5000 });
  });

  await step('Settings: set a PIN, lock, a wrong PIN is refused, the right one unlocks', async () => {
    await page.getByRole('button', { name: 'Security (PIN)' }).click();
    await page.getByLabel('PIN (4–8 digits)').fill('2468');
    await page.getByLabel('Repeat PIN').fill('2468');
    await page.getByRole('button', { name: 'Set PIN' }).click();
    await page.getByRole('status').getByText(/^PIN set/).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Lock now' }).click();
    const lock = page.getByRole('dialog', { name: 'MonksTracker is locked' });
    await lock.waitFor({ timeout: 5000 });
    await shot('gate-lock');
    await lock.getByLabel('PIN').fill('1111');
    await lock.getByRole('button', { name: 'Unlock' }).click();
    await lock.getByText('Wrong PIN.').waitFor();
    await lock.getByLabel('PIN').fill('2468');
    await lock.getByRole('button', { name: 'Unlock' }).click();
    await lock.waitFor({ state: 'hidden', timeout: 5000 });
  });

  await step('a reload while locked shows the lock screen, not an error', async () => {
    await page.getByRole('button', { name: 'Lock now' }).click();
    await page.reload();
    await page.getByRole('dialog', { name: 'MonksTracker is locked' }).waitFor({ timeout: 5000 });
    if (await page.getByText('Cannot reach the MonksTracker server').count()) throw new Error('offline banner shown');
    await page.getByLabel('PIN').fill('2468');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('dialog', { name: 'MonksTracker is locked' }).waitFor({ state: 'hidden', timeout: 5000 });
  });

  await step('Settings: the PIN can be removed with the current PIN', async () => {
    await page.getByRole('button', { name: 'Security (PIN)' }).click();
    await page.getByLabel('Current PIN').fill('2468');
    await page.getByRole('button', { name: 'Remove PIN' }).click();
    await page.getByRole('status').getByText('PIN removed').waitFor({ timeout: 5000 });
    if ((await api('/api/health')).pinSet) throw new Error('still set');
  });
}
