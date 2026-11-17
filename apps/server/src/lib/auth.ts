/**
 * Local PIN lock (spec section F, Security).
 * The PIN is stored as a salted scrypt hash. Unlocking issues a random session token kept in memory,
 * so restarting the server locks the app again.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { RuleError } from '@monkstracker/core';
import type { Ctx } from './context.ts';

const KEY = 'pin_hash';

export function pinIsSet(ctx: Ctx): boolean {
  return !!ctx.db.prepare(`SELECT 1 FROM app_state WHERE key = ?`).get(KEY);
}

function hash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function setPin(ctx: Ctx, pin: string, currentPin?: string): void {
  if (!/^\d{4,8}$/.test(pin)) throw new RuleError('pin_format', 'Use a PIN of 4 to 8 digits.');
  if (pinIsSet(ctx) && !verifyPin(ctx, currentPin ?? '')) throw new RuleError('pin_wrong', 'The current PIN is wrong.');
  const salt = randomBytes(16);
  const value = `${salt.toString('hex')}:${hash(pin, salt).toString('hex')}`;
  ctx.db.prepare(`INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(KEY, value);
}

export function verifyPin(ctx: Ctx, pin: string): boolean {
  const row = ctx.db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(KEY) as { value: string } | undefined;
  if (!row) return true;
  const [saltHex, hashHex] = row.value.split(':') as [string, string];
  const expected = Buffer.from(hashHex, 'hex');
  const actual = hash(pin, Buffer.from(saltHex, 'hex'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class Sessions {
  private readonly tokens = new Map<string, number>();
  constructor(private readonly idleMs: () => number) {}

  issue(now: number): string {
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, now);
    return token;
  }

  /** Valid tokens slide their expiry on use. */
  check(token: string | undefined, now: number): boolean {
    if (!token) return false;
    const last = this.tokens.get(token);
    if (last === undefined) return false;
    if (now - last > this.idleMs()) {
      this.tokens.delete(token);
      return false;
    }
    this.tokens.set(token, now);
    return true;
  }

  revoke(token: string | undefined): void {
    if (token) this.tokens.delete(token);
  }
}
