import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { canonicalJson } from '../src/index';
import {
  checkFixtures,
  currentFixtures,
  type ConformanceFixtures,
} from './support/conformanceFixtures';

const file = JSON.parse(
  readFileSync(new URL('../conformance/fixtures.json', import.meta.url), 'utf8'),
) as ConformanceFixtures;

describe('conformance/fixtures.json (read by the Kotlin engine)', () => {
  test('is current: the golden inputs and Node’s bytes for each, at this algorithmVersion', () => {
    // If this fails after an engine change: npm run conformance:fixtures -w @milewage/track-engine
    expect(checkFixtures(file)).toEqual([]);
    expect(Object.keys(file.inputs).length).toBeGreaterThanOrEqual(15);
  });

  test('the stored outputs equal the committed golden results', () => {
    const golden = JSON.parse(
      readFileSync(new URL('./fixtures/golden-shift.json', import.meta.url), 'utf8'),
    ) as { results: Record<string, unknown> };
    for (const name of Object.keys(file.inputs))
      expect(file.expected[name]).toBe(canonicalJson(golden.results[name]));
  });

  test('the check names a changed output, a changed input, a missing fixture and a version', () => {
    const good = currentFixtures();
    const name = Object.keys(good.inputs).sort()[0]!;
    const other = Object.keys(good.inputs).sort()[1]!;
    const bad: ConformanceFixtures = structuredClone(good);
    bad.expected[name] = bad.expected[name]!.replace('"totalM":', '"totalM":1');
    delete bad.inputs[other];
    bad.algorithmVersion += 1;
    expect(checkFixtures(bad)).toEqual([
      `algorithmVersion is ${good.algorithmVersion + 1}, the engine is ${good.algorithmVersion}`,
      `${name}: the stored output differs from processShift's`,
      `${other}: missing from the file`,
    ]);
    const input = structuredClone(good);
    input.inputs[name] = { ...input.inputs[name]!, endedAt: input.inputs[name]!.endedAt + 1 };
    expect(checkFixtures(input)).toEqual([`${name}: the input differs from the golden input`]);
  });
});
