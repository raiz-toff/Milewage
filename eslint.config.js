import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Packages that must stay pure (14 section 3): no platform, DB, network, clock or randomness.
const forbiddenModules = [
  'react-native',
  'react-native/*',
  'node:*',
  'fs',
  'fs/*',
  'path',
  'http',
  'https',
  'net',
  'os',
  'crypto',
  'child_process',
  'better-sqlite3',
  'drizzle-orm',
  'drizzle-orm/*',
  'fastify',
  'undici',
  'axios',
  'node-fetch',
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/generated/**', 'plans/**'] },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
  ...tseslint.configs.recommended,
  {
    files: ['packages/track-engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbiddenModules }],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'track-engine must be pure: no network.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'track-engine must be pure: no clock.' },
        {
          object: 'Math',
          property: 'random',
          message: 'track-engine must be pure: no randomness.',
        },
        {
          object: 'globalThis',
          property: 'fetch',
          message: 'track-engine must be pure: no network.',
        },
      ],
    },
  },
);
