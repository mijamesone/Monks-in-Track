/**
 * Browser tests for MonksTracker: each suite gets a fresh database with the sample week,
 * its own server on a free port, and a real Chromium page. Nothing touches your real data.
 *
 *   pnpm build
 *   pnpm e2e                 # every suite
 *   pnpm e2e m4              # only suites whose file name contains "m4"
 *   pnpm e2e --shots=./shots # also save screenshots there
 *
 * Elements are found by their visible names and labels ("Start Workday", "Copy message"), not by
 * position, so a redesign that keeps the same features should keep these tests passing.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shotsDir = args.find((a) => a.startsWith('--shots='))?.slice('--shots='.length);
const filters = args.filter((a) => !a.startsWith('--'));

let chromium;
try {
  ({ chromium } = createRequire(join(root, 'package.json'))('playwright'));
} catch {
  console.error('Playwright is not installed. Install it once with:\n  pnpm add -D -w playwright\n  pnpm exec playwright install chromium');
  process.exit(2);
}
if (!existsSync(join(root, 'apps/server/dist/server.mjs')) || !existsSync(join(root, 'apps/web/dist/index.html'))) {
  console.error('Build the app first: pnpm build');
  process.exit(2);
}
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

async function startServer() {
  const data = mkdtempSync(join(tmpdir(), 'monkstracker-e2e-'));
  const env = { ...process.env, MONKSTRACKER_DATA: data };
  execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/seed-sample.ts'], { cwd: join(root, 'apps/server'), env, stdio: 'pipe' });
  const port = await freePort();
  const child = spawn(process.execPath, ['apps/server/dist/server.mjs'], { cwd: root, env: { ...env, MONKSTRACKER_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('server did not start')), 15000);
    child.stdout.on('data', (d) => String(d).includes('MonksTracker on') && (clearTimeout(timer), ok()));
    child.once('exit', (code) => fail(new Error(`server exited (${code})`)));
  });
  const stop = () => {
    child.kill();
    try {
      rmSync(data, { recursive: true, force: true });
    } catch {
      /* Windows may hold the file a moment longer */
    }
  };
  return { base: `http://127.0.0.1:${port}`, stop };
}

const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const suites = readdirSync(join(root, 'e2e/suites'))
  .filter((f) => f.endsWith('.mjs') && (!filters.length || filters.some((x) => f.includes(x))))
  .sort();
let passed = 0;
let failed = 0;
const browser = await chromium.launch();
for (const file of suites) {
  console.log(`\n${file}`);
  const server = await startServer();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.base });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());
  const H = { 'content-type': 'application/json', 'x-monkstracker': '1' };
  const api = (p, method = 'GET', body) => fetch(server.base + p, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());
  const step = async (name, fn) => {
    try {
      await fn();
      passed++;
      console.log('  ok   ', name);
    } catch (e) {
      failed++;
      console.log('  FAIL ', name, '-', String(e?.message ?? e).split('\n')[0]);
      if (shotsDir) await page.screenshot({ path: join(shotsDir, `FAIL-${file.replace('.mjs', '')}-${failed}.png`) }).catch(() => {});
    }
  };
  const shot = async (name, opts = {}) => shotsDir && page.screenshot({ path: join(shotsDir, `${name}.png`), ...opts });
  try {
    await api('/api/settings', 'PATCH', { theme: { mode: 'light', lightFrom: '06:00', darkFrom: '18:00' } });
    const mod = await import(pathToFileURL(join(root, 'e2e/suites', file)).href);
    await mod.default({ page, api, base: server.base, step, shot, hm });
  } catch (e) {
    failed++;
    console.log('  FAIL  suite crashed -', String(e?.message ?? e).split('\n')[0]);
  } finally {
    const real = errors.filter((e) => !/Failed to load resource/.test(e));
    if (real.length) {
      failed++;
      console.log('  FAIL  browser errors:', real.slice(0, 3).join(' | '));
    }
    await page.close();
    server.stop();
  }
}
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
