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
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      'plans/**',
      '.claude/**',
      'apps/phone/*.config.js', // CommonJS configs read by Expo/Metro/Babel
      'apps/phone/android/**',
      'apps/phone/ios/**',
      'apps/phone/native/**/android/build/**',
      'apps/phone/plugins/**', // CommonJS Expo config plugins
    ],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
  {
    files: ['infra/vm-tests/**/*.mjs', 'infra/vm-tests/**/*.cjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        require: 'readonly',
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['infra/vm-tests/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }, // runs inside the api image as CommonJS
  },
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
