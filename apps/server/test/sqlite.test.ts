import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database } from '../src/db/sqlite.ts';

const fresh = () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  return db;
};
const count = (db: Database) => (db.prepare('SELECT COUNT(*) n FROM t').get() as { n: number }).n;

describe('database engine (built-in SQLite)', () => {
  it('commits a transaction, and rolls all of it back when it throws', () => {
    const db = fresh();
    db.transaction(() => db.prepare('INSERT INTO t (v) VALUES (?)').run('a'))();
    expect(count(db)).toBe(1);
    expect(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO t (v) VALUES (?)').run('b');
        throw new Error('stop');
      })(),
    ).toThrow('stop');
    expect(count(db)).toBe(1);
  });

  it('a failed inner transaction undoes only its own part', () => {
    const db = fresh();
    db.transaction(() => {
      db.prepare('INSERT INTO t (v) VALUES (?)').run('outer');
      try {
        db.transaction(() => {
          db.prepare('INSERT INTO t (v) VALUES (?)').run('inner');
          throw new Error('inner fails');
        })();
      } catch {
        /* expected */
      }
    })();
    expect(db.prepare('SELECT v FROM t').all()).toEqual([{ v: 'outer' }]);
  });

  it('reads pragmas, binds named parameters and reports changes', () => {
    const db = fresh();
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    const r = db.prepare('INSERT INTO t (v) VALUES (@v)').run({ v: 'named' });
    expect(r.changes).toBe(1);
    expect(db.prepare('SELECT v FROM t WHERE id = ?').get(Number(r.lastInsertRowid))).toEqual({ v: 'named' });
    expect(db.prepare('SELECT v FROM t WHERE id = 99').get()).toBeUndefined();
  });

  it('backs up to a file that opens with the same data', async () => {
    const db = fresh();
    db.prepare('INSERT INTO t (v) VALUES (?)').run('kept');
    const file = join(mkdtempSync(join(tmpdir(), 'mt-sqlite-')), 'copy.sqlite');
    await db.backup(file);
    const copy = new Database(file);
    expect(copy.prepare('SELECT v FROM t').all()).toEqual([{ v: 'kept' }]);
    copy.close();
  });
});
