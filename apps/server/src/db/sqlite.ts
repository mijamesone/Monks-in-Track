/**
 * The database engine: Node's built-in SQLite (node:sqlite), wrapped in the small part of the
 * better-sqlite3 API this app uses (prepare/run/get/all, exec, pragma, transaction, backup, close).
 *
 * Built-in means no native module to compile or download per machine, so the same code runs in
 * Node 22.16+ on any OS and inside the Windows desktop app (Electron), unchanged.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT, StatementSync, SQLInputValue } from 'node:sqlite';

// Node 22 prints an ExperimentalWarning the first time node:sqlite loads. It is expected here, so hide just that one.
const emit = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (/SQLite is an experimental feature/i.test(text)) return;
  return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
// createRequire keeps bundlers (esbuild) and Vite-based test runners from trying to resolve 'node:sqlite' themselves.
const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
process.emitWarning = emit;

export type BindValue = SQLInputValue;
// Loose like better-sqlite3: the engine itself rejects values it cannot store.
type Params = unknown[];

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export class Statement {
  constructor(private readonly stmt: StatementSync) {}
  run(...params: Params): RunResult {
    const r = this.stmt.run(...(params as BindValue[]));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
  get(...params: Params): unknown {
    return this.stmt.get(...(params as BindValue[]));
  }
  all(...params: Params): unknown[] {
    return this.stmt.all(...(params as BindValue[]));
  }
}

export class Database {
  private readonly raw: DatabaseSyncT;
  private depth = 0;

  constructor(readonly file: string) {
    this.raw = new sqlite.DatabaseSync(file);
  }

  prepare(sql: string): Statement {
    return new Statement(this.raw.prepare(sql));
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /**
   * `pragma('foreign_keys = ON')` sets a value; `pragma('user_version', { simple: true })` reads one value;
   * `pragma('foreign_key_check')` returns every row.
   */
  pragma(source: string, options?: { simple?: boolean }): unknown {
    const stmt = this.raw.prepare(`PRAGMA ${source}`);
    if (options?.simple) {
      const row = stmt.get() as Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : undefined;
    }
    return stmt.all();
  }

  /**
   * Wraps fn so it runs in one transaction: everything is saved, or nothing if it throws.
   * Nested calls use savepoints, like better-sqlite3.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const nested = this.depth > 0;
      const savepoint = `mt_sp_${this.depth}`;
      this.raw.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
      this.depth++;
      try {
        const result = fn(...args);
        this.depth--;
        this.raw.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (err) {
        this.depth--;
        if (nested) this.raw.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        else if (this.raw.isTransaction) this.raw.exec('ROLLBACK');
        throw err;
      }
    };
  }

  /** Writes a consistent copy of the whole database to file, even while it is in use. */
  async backup(file: string): Promise<void> {
    await sqlite.backup(this.raw, file);
  }

  close(): void {
    this.raw.close();
  }
}
