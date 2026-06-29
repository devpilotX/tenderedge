import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    // DB-backed tests mutate shared schema; run files sequentially to avoid cross-talk.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
