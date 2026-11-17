import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_COMPANIES,
  DEFAULT_PROJECT_TYPES,
  DEFAULT_SETTINGS,
  DEFAULT_STATUSES,
} from '@monkstracker/core';
import { MIGRATIONS } from './migrations.ts';

export type DB = Database.Database;

/** Opens (and creates) the database file with safe settings, then migrates it. Use ':memory:' in tests. */
export function openDatabase(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Inserts first-run defaults once. Safe to call on every start. */
export function seedDefaults(db: DB, now: number): void {
  const seeded = db.prepare(`SELECT value FROM app_state WHERE key = 'seeded'`).get();
  if (seeded) return;
  db.transaction(() => {
    const company = db.prepare(
      `INSERT INTO companies (id, name, short_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    DEFAULT_COMPANIES.forEach((c, i) => company.run(randomUUID(), c.name, c.shortName, i, now));

    const category = db.prepare(`INSERT INTO categories (id, name, report_order) VALUES (?, ?, ?)`);
    for (const c of DEFAULT_CATEGORIES) category.run(randomUUID(), c.name, c.order);

    const type = db.prepare(`INSERT INTO project_types (id, name, sort_order) VALUES (?, ?, ?)`);
    DEFAULT_PROJECT_TYPES.forEach((t, i) => type.run(randomUUID(), t, i));

    const status = db.prepare(
      `INSERT INTO statuses (id, key, name, emoji, report_text, is_done, is_rejected, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of DEFAULT_STATUSES) {
      status.run(randomUUID(), s.key, s.name, s.emoji, s.reportText, s.isDone ? 1 : 0, s.isRejected ? 1 : 0, s.order);
    }

    db.prepare(`INSERT INTO settings (key, value) VALUES ('app', ?)`).run(JSON.stringify(DEFAULT_SETTINGS));
    db.prepare(`INSERT INTO app_state (key, value) VALUES ('seeded', ?)`).run(String(now));
  })();
}
