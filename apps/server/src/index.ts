/**
 * Starts the local server.
 *
 * Data folder (in order): MONKSTRACKER_DATA, else on Windows %LOCALAPPDATA%\MonksTracker,
 * else ~/.monkstracker. The database is monkstracker.sqlite inside it.
 * Binds to 127.0.0.1 only, so nothing outside this computer can connect.
 */
import { serve } from '@hono/node-server';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDatabase, seedDefaults } from './db/index.ts';
import { makeCtx } from './lib/context.ts';
import { defaultDataDir } from './lib/paths.ts';
import { startScheduler } from './services/scheduler.ts';

const dataDir = defaultDataDir();
const port = Number(process.env.MONKSTRACKER_PORT ?? 4545);
mkdirSync(dataDir, { recursive: true });

const db = openDatabase(join(dataDir, 'monkstracker.sqlite'));
const ctx = makeCtx(db);
seedDefaults(db, ctx.now());

// The built web app, if present (pnpm build). Override with MONKSTRACKER_WEB.
const webRoot = resolve(process.env.MONKSTRACKER_WEB ?? join(process.cwd(), 'apps', 'web', 'dist'));
const app = createApp(ctx, { webRoot: existsSync(join(webRoot, 'index.html')) ? webRoot : undefined });
const stopScheduler = startScheduler(ctx);
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`MonksTracker on http://127.0.0.1:${info.port}  (data: ${dataDir}${existsSync(join(webRoot, 'index.html')) ? '' : ', web app not built'})`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. MonksTracker may already be running.`);
    process.exit(1);
  }
  throw err;
});

const shutdown = () => {
  stopScheduler();
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
