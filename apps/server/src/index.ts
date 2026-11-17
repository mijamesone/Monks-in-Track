/**
 * Starts the local server. Data lives in MONKSTRACKER_DATA (default: ./data) as monkstracker.sqlite.
 * Binds to 127.0.0.1 only, so nothing outside this computer can connect.
 */
import { serve } from '@hono/node-server';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDatabase, seedDefaults } from './db/index.ts';
import { makeCtx } from './lib/context.ts';

const dataDir = resolve(process.env.MONKSTRACKER_DATA ?? 'data');
const port = Number(process.env.MONKSTRACKER_PORT ?? 4545);
mkdirSync(dataDir, { recursive: true });

const db = openDatabase(join(dataDir, 'monkstracker.sqlite'));
const ctx = makeCtx(db);
seedDefaults(db, ctx.now());

const app = createApp(ctx);
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`MonksTracker server on http://127.0.0.1:${info.port}  (data: ${dataDir})`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
