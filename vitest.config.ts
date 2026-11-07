import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The web app imports its shadcn/ui components through `@/` (apps/web/vite.config.ts).
  resolve: { alias: { '@': fileURLToPath(new URL('apps/web/src', import.meta.url)) } },
  test: {
    exclude: ['**/node_modules/**', 'apps/phone/**'], // phone tests run under jest-expo
    include: [
      'apps/*/test/**/*.test.{ts,tsx}',
      'packages/*/test/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'infra/**/*.test.mjs',
    ],
  },
});
