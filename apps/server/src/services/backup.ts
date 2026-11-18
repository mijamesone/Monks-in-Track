/**
 * Daily backups (spec section F): an online SQLite backup into a folder you choose, keeping the last N.
 * The online backup API copies a consistent snapshot even while the app is writing.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { openDatabase } from '../db/index.ts';
import { RuleError } from '@monkstracker/core';
import type { Ctx } from '../lib/context.ts';
import { getSettings } from './structure.ts';

const NAME = /^monkstracker-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:-\d+)?\.sqlite$/;

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
  const file = freeName(folder, `monkstracker-${stamp(ctx.now())}`);
  await ctx.db.backup(file);
  return { file, removed: pruneBackups(folder, settings.backup.keepDays, ctx.now()) };
}

/** A file name in the folder that does not exist yet, so a backup never overwrites another one. */
function freeName(folder: string, base: string): string {
  let file = join(folder, `${base}.sqlite`);
  for (let i = 2; existsSync(file); i++) file = join(folder, `${base}-${i}.sqlite`);
  return file;
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

/** Backups in the chosen folder, newest first (daily ones and the safety copies made before a restore). */
export function listBackups(ctx: Ctx): { name: string; size: number; createdAt: number }[] {
  const folder = getSettings(ctx).backup.folder;
  if (!folder || !existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => NAME.test(f) || BEFORE.test(f))
    .map((f) => {
      const st = statSync(join(folder, f));
      return { name: f, size: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

const BEFORE = /^monkstracker-before-restore-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:-\d+)?\.sqlite$/;

/**
 * Restores a backup from the chosen folder into the open database.
 *
 * 1. Saves a safety copy of the current data ("before-restore"), so a restore can itself be undone.
 * 2. Copies the backup to a temporary file and brings it up to the current schema (older backups still work).
 * 3. Replaces every table's rows inside one transaction: either everything is restored or nothing changes.
 */
export async function restoreBackup(ctx: Ctx, name: string): Promise<{ restored: string; safetyCopy: string }> {
  const folder = getSettings(ctx).backup.folder;
  if (!folder) throw new RuleError('backup_folder_missing', 'Choose a backup folder in Settings first.');
  if (!(NAME.test(name) || BEFORE.test(name)) || basename(name) !== name) throw new RuleError('backup_name', 'That is not a MonksTracker backup file.');
  const source = join(folder, name);
  if (!existsSync(source)) throw new RuleError('backup_missing', 'That backup file no longer exists.');

  const safetyCopy = freeName(folder, `monkstracker-before-restore-${stamp(ctx.now())}`);
  await ctx.db.backup(safetyCopy);

  const temp = join(mkdtempSync(join(tmpdir(), 'monkstracker-restore-')), 'restore.sqlite');
  copyFileSync(source, temp);
  const check = openDatabase(temp); // runs any newer migrations on the copy
  const ok = check.pragma('integrity_check', { simple: true });
  check.close();
  if (ok !== 'ok') throw new RuleError('backup_damaged', 'That backup file is damaged and was not restored.');

  const tables = (ctx.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name);
  ctx.db.pragma('foreign_keys = OFF');
  try {
    ctx.db.prepare(`ATTACH DATABASE ? AS bk`).run(temp);
    try {
      ctx.db.transaction(() => {
        for (const t of tables) {
          const cols = (ctx.db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t) as { name: string }[]).map((c) => `"${c.name}"`).join(', ');
          ctx.db.exec(`DELETE FROM main."${t}"; INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM bk."${t}";`);
        }
        const broken = ctx.db.pragma('foreign_key_check') as unknown[];
        if (broken.length) throw new RuleError('backup_inconsistent', 'That backup has broken links between records and was not restored.');
      })();
    } finally {
      ctx.db.exec(`DETACH DATABASE bk`);
    }
  } finally {
    ctx.db.pragma('foreign_keys = ON');
    rmSync(temp, { force: true });
  }
  return { restored: name, safetyCopy: basename(safetyCopy) };
}
