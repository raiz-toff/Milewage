import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Two projects so the web pages get longer timeouts than the server, engine and scripts.
// Kept at vitest's defaults, on purpose, after measuring full runs on 8 cores at load 17 to 25
// (PROGRESS.md, PR T1): the `forks` pool (threads: 101 s against 75 to 94 s),
// all cores but one as workers (half the cores: 100 to 110 s, and no fewer failures once the waits
// below were right), `isolate: true` (without it vi.mock('maplibre-gl') and module state would
// leak from one file into the next) and CSS, which vitest already replaces with empty modules.
export default defineConfig({
  // The web app imports its shadcn/ui components through `@/` (apps/web/vite.config.ts).
  resolve: { alias: { '@': fileURLToPath(new URL('apps/web/src', import.meta.url)) } },
  test: {
    exclude: ['**/node_modules/**', 'apps/phone/**'], // phone tests run under jest-expo
    // `npm run test:coverage`. Off in `npm test`. No thresholds yet (PR T1 records the baseline).
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['apps/*/src/**', 'packages/*/src/**'],
      exclude: [
        'apps/phone/**', // measured by jest-expo, not by vitest
        'apps/web/src/components/ui/**', // shadcn/ui components, copied in by its CLI
        '**/generated/**',
        '**/*.d.ts',
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'web',
          include: ['apps/web/test/**/*.test.{ts,tsx}'],
          // Pages choose jsdom with a `@vitest-environment jsdom` comment; the rest run in node.
          environment: 'node',
          // findBy* and waitFor wait up to 10 s for the page (setup.ts).
          setupFiles: ['apps/web/test/support/setup.ts'],
          // A page test waits for several renders in turn, each up to 10 s under load, so the
          // default 5 s per test is too short there (seven tests timed out at 5 s at load 31).
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          include: [
            'apps/server/test/**/*.test.ts',
            'packages/*/test/**/*.test.ts',
            'scripts/**/*.test.mjs',
            'infra/**/*.test.mjs',
          ],
          // Server, engine and scripts need no DOM. Vitest's default timeouts (5 s per test, 10 s
          // per hook) stay, so a hung request or a lost promise still fails fast here.
          environment: 'node',
        },
      },
    ],
  },
});
