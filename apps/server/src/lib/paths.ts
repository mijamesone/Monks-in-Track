import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Where the database lives: MONKSTRACKER_DATA, else on Windows %LOCALAPPDATA%\MonksTracker,
 * else ~/.monkstracker.
 */
export function defaultDataDir(): string {
  if (process.env.MONKSTRACKER_DATA) return resolve(process.env.MONKSTRACKER_DATA);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'MonksTracker');
  return join(homedir(), '.monkstracker');
}
