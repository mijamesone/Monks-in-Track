import { randomUUID } from 'node:crypto';
import type { DB } from '../db/index.ts';

/** Everything a service needs. The clock and id generator are injectable so tests control time. */
export interface Ctx {
  db: DB;
  now: () => number;
  id: () => string;
}

export function makeCtx(db: DB, now: () => number = Date.now): Ctx {
  return { db, now, id: randomUUID };
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found.`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

export const bool = (v: unknown): boolean => v === 1 || v === true;
