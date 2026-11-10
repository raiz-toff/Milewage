import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

const root = new URL('../../..', import.meta.url).pathname;

async function lint(code: string, file: string) {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return result?.messages.map((m) => m.ruleId) ?? [];
}

const bad = [
  "import fs from 'node:fs';\nexport const a = fs;",
  "import { readFileSync } from 'fs';\nexport const a = readFileSync;",
  "import Database from 'better-sqlite3';\nexport const a = Database;",
  'export const a = Date.now();',
  'export const a = Math.random();',
  "export const a = fetch('/x');",
];

test.each(bad)('track-engine source is rejected: %s', async (code) => {
  const ids = await lint(code, 'packages/track-engine/src/bad.ts');
  expect(ids.some((id) => id?.startsWith('no-restricted-'))).toBe(true);
});

test('the same code is allowed outside track-engine', async () => {
  const ids = await lint('export const a = Date.now();', 'packages/shared/src/ok.ts');
  expect(ids).toEqual([]);
});

test('pure code passes in track-engine', async () => {
  const ids = await lint(
    'export const a = (x: number) => x + 1;',
    'packages/track-engine/src/ok.ts',
  );
  expect(ids).toEqual([]);
});
