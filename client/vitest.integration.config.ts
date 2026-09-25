import { defineConfig } from 'vitest/config'

// Client ↔ server integration tests: the real api client (src/api/client.ts) against real
// `php -S` servers and a throwaway Postgres database (see integration/globalSetup.ts).
// Run with `npm run test:integration`; needs PHP, the server's vendor/ and server/.env.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['integration/**/*.test.ts'],
    globalSetup: ['integration/globalSetup.ts'],
    // One database behind every file, so files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    restoreMocks: true,
  },
})
