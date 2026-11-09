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

// Plan 21 section 3.4 rule 1: code asks a country module for data and never checks a country or
// region code itself. The codes are every ISO 3166-1 region CLDR names (through Intl), so a byte
// marker such as 'II' passes; `CA-ON` style subdivision codes are caught by their shape.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const AZ = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const isoCountries = AZ.flatMap((a) => AZ.map((b) => a + b)).filter((c) => regionNames.of(c) !== c);
const code = `Literal[value=/^(${isoCountries.join('|')})(-[A-Z0-9]{1,3})?$/]`;
const countryCheck =
  'A country or region code in logic: read the data from the country module instead (plan 21 section 3.4).';
const countryLiteralRule = [
  'error',
  ...[
    `BinaryExpression[operator=/^[!=]==?$/] > ${code}`,
    `SwitchCase > ${code}.test`,
    `CallExpression[callee.property.name=/^(includes|indexOf|has)$/] > ${code}`,
    `CallExpression > MemberExpression.callee[property.name=/^(includes|indexOf)$/] > ArrayExpression > ${code}`,
  ].map((selector) => ({ selector, message: countryCheck })),
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'coverage/**', // npm run test:coverage output
      '**/generated/**',
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
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    ignores: ['packages/shared/src/countries/**'],
    rules: { 'no-restricted-syntax': countryLiteralRule },
  },
  {
    // The phone's sender (apps/phone/src/sync/sender.ts) is the one interface for sending to the
    // server; the queue runner, the points, the restore resend and the change log stay behind it.
    files: ['apps/phone/src/**/*.{ts,tsx}'],
    ignores: ['apps/phone/src/sync/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/sync/runner', '**/sync/points', '**/sync/resend', '**/sync/pull'],
              message: 'Internal to the sender: use sync/sender.',
            },
          ],
        },
      ],
    },
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
