import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

// Plan 21 section 3.4 rule 1: no country or region code in logic outside the countries folder.
const root = new URL('../../..', import.meta.url).pathname;

async function lint(code: string, file: string) {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return result?.messages.map((m) => m.ruleId) ?? [];
}

const bad = [
  "export const a = (c: string) => c === 'CA';",
  "export const a = (c: string) => 'GB' !== c;",
  "export const a = (r: string) => r == 'CA-QC';",
  "export const a = (c: string) => { switch (c) { case 'US': return 1; default: return 0; } };",
  "export const a = (c: string) => ['CA', 'US'].includes(c);",
  "export const a = (s: Set<string>) => s.has('NP');",
];

test.each(bad)('rejected in server, web and phone code: %s', async (code) => {
  for (const file of ['apps/server/src/bad.ts', 'apps/web/src/bad.tsx', 'apps/phone/src/bad.ts'])
    expect(await lint(code, file), file).toContain('no-restricted-syntax');
});

test('allowed inside the countries folder and in tests', async () => {
  for (const file of ['packages/shared/src/countries/xx/index.ts', 'apps/server/test/x.test.ts'])
    expect(await lint(bad[0]!, file), file).toEqual([]);
});

test('strings that are not country codes, and codes used as data, pass', async () => {
  const ok = [
    "export const a = (m: string) => m === 'GET' || m === 'II';",
    "export const a = { country: 'CA' };",
    "export const a = (c: string) => c === 'ca';",
  ];
  for (const code of ok) expect(await lint(code, 'apps/server/src/ok.ts'), code).toEqual([]);
});
