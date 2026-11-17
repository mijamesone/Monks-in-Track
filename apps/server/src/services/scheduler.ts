/**
 * Background jobs that run while the server is up. Today: the daily backup.
 * The decision is a pure function so it can be tested with any clock.
 */
import { localDayKey } from '@monkstracker/core';
import type { Ctx } from '../lib/context.ts';
import { backupNow } from './backup.ts';
import { getSettings } from './structure.ts';

/**
 * A backup is due once per local day, at or after the configured HH:MM.
 * If the PC was off at that time, it runs as soon as the server is up later that day.
 */
export function isBackupDue(now: number, time: string, lastBackupAt: number | null): boolean {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const d = new Date(now);
  const scheduled = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  if (now < scheduled) return false;
  return lastBackupAt === null || localDayKey(lastBackupAt) !== localDayKey(now) || lastBackupAt < scheduled;
}

export function lastBackupAt(ctx: Ctx): number | null {
  const r = ctx.db.prepare(`SELECT value FROM app_state WHERE key = 'last_backup_at'`).get() as { value: string } | undefined;
  return r ? Number(r.value) : null;
}

/** Runs the backup if one is due. Failures are recorded, never thrown, so the server keeps running. */
export async function runDueJobs(ctx: Ctx): Promise<{ backedUp: string | null; error: string | null }> {
  const s = getSettings(ctx);
  if (!s.backup.folder || !isBackupDue(ctx.now(), s.backup.time, lastBackupAt(ctx))) return { backedUp: null, error: null };
  try {
    const { file } = await backupNow(ctx);
    ctx.db.prepare(`INSERT INTO app_state (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(ctx.now()));
    ctx.db.prepare(`DELETE FROM app_state WHERE key = 'last_backup_error'`).run();
    return { backedUp: file, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.db.prepare(`INSERT INTO app_state (key, value) VALUES ('last_backup_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify({ at: ctx.now(), message }));
    return { backedUp: null, error: message };
  }
}

export function startScheduler(ctx: Ctx, everyMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueJobs(ctx);
    } finally {
      running = false;
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), everyMs);
  return () => clearInterval(handle);
}
