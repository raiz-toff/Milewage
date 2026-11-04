import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { drift, generate, lintModules, loadSpec } from './openapi-generate.mjs';

const repo = new URL('..', import.meta.url).pathname;

function copyOfRepoFiles() {
  const root = mkdtempSync(join(tmpdir(), 'oas-'));
  cpSync(join(repo, 'packages/shared'), join(root, 'packages/shared'), { recursive: true });
  return root;
}

test('committed generated files match a fresh generation', async () => {
  expect(await drift(repo)).toEqual([]);
});

test('editing a generated file is reported as drift', async () => {
  const root = copyOfRepoFiles();
  const file = join(root, 'packages/shared/generated/schemas.json');
  writeFileSync(file, readFileSync(file, 'utf8') + ' ');
  expect(await drift(root)).toEqual(['packages/shared/generated/schemas.json']);
});

test('editing the spec without regenerating is reported as drift', async () => {
  const root = copyOfRepoFiles();
  const file = join(root, 'packages/shared/openapi/openapi.yaml');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('operationId: getHealth', 'operationId: getHealthz'),
  );
  expect((await drift(root)).length).toBeGreaterThan(0);
});

test('the real spec maps every operation to exactly one module', () => {
  expect(lintModules(loadSpec(repo))).toEqual([]);
});

test('an unmapped, doubly mapped or unknown operation fails the lint', () => {
  const doc = {
    paths: {
      '/a': { get: { operationId: 'a' }, post: { operationId: 'b' } },
      '/c': { get: { operationId: 'c' } },
    },
    'x-modules': { core: { operations: ['a', 'b', 'ghost'] }, other: { operations: ['b'] } },
  };
  expect(lintModules(doc)).toEqual([
    'operation b is mapped to several modules: core, other',
    'operation c is not mapped to any module in x-modules',
    'x-modules lists unknown operation ghost',
  ]);
});

test('generated schemas keep refs inside $defs', async () => {
  const out = await generate(repo);
  expect(out['packages/shared/generated/schemas.json']).not.toContain('#/components/');
});
