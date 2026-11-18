// Bundles the server into one file, dist/server.mjs. Works the same on Windows, macOS and Linux.
// better-sqlite3 stays external because it is a native module installed per machine.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  external: ['better-sqlite3'],
  // Some bundled packages call require(); give ESM output a real require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
