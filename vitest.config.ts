import { defineConfig } from 'vitest/config';

export default defineConfig({
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
