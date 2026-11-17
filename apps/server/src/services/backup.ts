/**
 * Daily backups (spec section F): an online SQLite backup into a folder you choose, keeping the last N.
 * The online backup API copies a consistent snapshot even while the app is writing.
 */
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RuleError } from '@monkstracker/core';
import type { Ctx } from '../lib/context.ts';
import { getSettings } from './structure.ts';

const NAME = /^monkstracker-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.sqlite$/;

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export async function backupNow(ctx: Ctx, folderOverride?: string): Promise<{ file: string; removed: string[] }> {
  const settings = getSettings(ctx);
  const folder = folderOverride ?? settings.backup.folder;
  if (!folder) throw new RuleError('backup_folder_missing', 'Choose a backup folder in Settings first.');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `monkstracker-${stamp(ctx.now())}.sqlite`);
  await ctx.db.backup(file);
  return { file, removed: pruneBackups(folder, settings.backup.keepDays, ctx.now()) };
}

/** Removes backups older than keepDays, always keeping the newest one. */
export function pruneBackups(folder: string, keepDays: number, now: number): string[] {
  const files = readdirSync(folder)
    .filter((f) => NAME.test(f))
    .map((f) => ({ f, mtime: statSync(join(folder, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const { f, mtime } of files.slice(1)) {
    if (mtime < cutoff) {
      rmSync(join(folder, f));
      removed.push(f);
    }
  }
  return removed;
}
