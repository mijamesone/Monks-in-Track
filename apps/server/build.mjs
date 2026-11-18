// Bundles the server into one file, dist/server.mjs. Works the same on Windows, macOS and Linux.
// The database is Node's built-in node:sqlite, so the bundle has no native modules and runs anywhere Node 22.16+ runs.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  // Some bundled packages call require(); give ESM output a real require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
