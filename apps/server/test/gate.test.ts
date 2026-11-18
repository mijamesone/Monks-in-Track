import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HR, MIN, at, harness, seedRealProjects } from './helpers.ts';

describe('acceptance gate: backup and restore', () => {
  it('restores a backup exactly, keeps a safety copy of what it replaced, and refuses other files', async () => {
    const h = harness(at(17, 12));
    const { dm } = await seedRealProjects(h);
    const folder = mkdtempSync(join(tmpdir(), 'mt-restore-'));
    await h.send('PATCH', '/api/settings', { backup: { folder, keepDays: 30, time: '12:00' } });
    await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'Before the backup' });
    await h.send('POST', '/api/entries', { projectId: dm.id, taskId: null, kind: 'work', startedAt: at(17, 9), endedAt: at(17, 11) });
    const backup = (await h.send('POST', '/api/backup')).body;

    // Life goes on: a new task, an edit, a deletion.
    h.set(at(17, 13));
    await h.send('POST', '/api/tasks', { projectId: dm.id, name: 'After the backup' });
    await h.send('PATCH', `/api/projects/${dm.id}`, { name: 'Renamed' });

    const list = (await h.get('/api/backups')).body;
    expect(list.map((b: any) => b.name)).toContain(backup.file.split(/[\\/]/).pop());
    const r = (await h.send('POST', '/api/backups/restore', { name: list[0].name })).body;
    expect(r.safetyCopy).toMatch(/^monkstracker-before-restore-/);
    expect(readdirSync(folder)).toContain(r.safetyCopy);

    const names = (await h.get(`/api/projects/${dm.id}/tasks`)).body.map((t: any) => t.name);
    expect(names).toEqual(['Before the backup']);
    expect((await h.get(`/api/projects/${dm.id}`)).body).toMatchObject({ name: 'DM Blog', totals: { total: 2 * HR } });

    // The safety copy can be restored too: undoing the restore.
    await h.send('POST', '/api/backups/restore', { name: r.safetyCopy });
    expect((await h.get(`/api/projects/${dm.id}`)).body.name).toBe('Renamed');

    expect((await h.send('POST', '/api/backups/restore', { name: '../monkstracker.sqlite' })).body.error.code).toBe('backup_name');
    expect((await h.send('POST', '/api/backups/restore', { name: 'monkstracker-2020-01-01T00-00-00.sqlite' })).body.error.code).toBe('backup_missing');
  });
});

describe('acceptance gate: PIN', () => {
  it('sets a PIN, locks the API, unlocks with it, and removes it with the current PIN', async () => {
    const h = harness(at(17, 9));
    expect((await h.get('/api/health')).body.pinSet).toBe(false);
    await h.send('POST', '/api/auth/pin', { pin: '2468' });
    expect((await h.get('/api/catalog')).status).toBe(401);
    const unlock = await h.send('POST', '/api/auth/unlock', { pin: '2468' });
    const cookie = unlock.headers.get('set-cookie')!.split(';')[0]!;
    expect((await h.send('DELETE', '/api/auth/pin', { currentPin: '1111' }, { cookie })).body.error.code).toBe('pin_wrong');
    expect((await h.send('DELETE', '/api/auth/pin', { currentPin: '2468' }, { cookie })).body.pinSet).toBe(false);
    expect((await h.get('/api/catalog')).status).toBe(200);
  });
});

describe('acceptance gate: estimate at completion', () => {
  it('says "finished X early" or "X over the estimate", and nothing without an estimate', async () => {
    const h = harness(at(17, 9));
    const { dm } = await seedRealProjects(h);
    const mk = async (name: string, est: number | null) => (await h.send('POST', '/api/tasks', { projectId: dm.id, name, estimateMinutes: est })).body;
    const early = await mk('Early', 60);
    const over = await mk('Over', 30);
    const none = await mk('No estimate', null);
    await h.send('POST', '/api/workday/start', {});
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: early.id });
    h.set(at(17, 9, 40));
    expect((await h.send('POST', `/api/tasks/${early.id}/complete`, {})).body.completionNote).toBe('Finished 20m early');
    await h.send('POST', '/api/timer/start', { projectId: dm.id, taskId: over.id });
    h.set(at(17, 10, 55));
    expect((await h.send('POST', `/api/tasks/${over.id}/complete`, {})).body.completionNote).toBe('Finished 45m over the estimate');
    expect((await h.send('POST', `/api/tasks/${none.id}/complete`, {})).body.completionNote).toBeNull();
    expect(MIN).toBe(60_000);
  });
});
