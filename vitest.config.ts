import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Time maths must not depend on the machine running the tests:
    // a fixed zone with a non-zero offset (UTC+6, no daylight saving) catches local-day bugs.
    env: { TZ: 'Etc/GMT-6' },
  },
});
