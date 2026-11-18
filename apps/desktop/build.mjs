// Builds the desktop app into dist/: the Electron main process, plus copies of the built server and web app.
// Run `pnpm build` at the repository root first (it builds apps/server and apps/web).
import { build } from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const server = join(root, 'apps', 'server', 'dist', 'server.mjs');
const web = join(root, 'apps', 'web', 'dist');
for (const [what, path] of [['server', server], ['web app', join(web, 'index.html')]]) {
  if (!existsSync(path)) throw new Error(`The ${what} is not built yet. Run "pnpm build" at the repository root first.`);
}

rmSync(join(here, 'dist'), { recursive: true, force: true });
rmSync(join(here, 'server'), { recursive: true, force: true });
rmSync(join(here, 'web'), { recursive: true, force: true });

await build({
  entryPoints: [join(here, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: join(here, 'dist', 'main.cjs'),
  external: ['electron'],
  logLevel: 'info',
});
cpSync(server, join(here, 'server', 'server.mjs'));
cpSync(web, join(here, 'web'), { recursive: true });
console.log('Copied the server and web app.');
