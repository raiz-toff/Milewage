import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { algorithmVersion } from '../src/index';
import {
  computeResults,
  guardShift,
  regenerateShift,
  type ShiftGolden,
} from './support/goldenShift';

const path = new URL('./fixtures/golden-shift.json', import.meta.url).pathname;

// Writes fixtures only when asked: UPDATE_FIXTURES=1 npx vitest run golden
if (process.env.UPDATE_FIXTURES === '1') {
  const prev = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ShiftGolden) : null;
  writeFileSync(path, JSON.stringify(regenerateShift(prev, algorithmVersion), null, 2) + '\n');
}
const committed = JSON.parse(readFileSync(path, 'utf8')) as ShiftGolden;

describe('processShift golden fixtures', () => {
  const results = computeResults();

  test('committed results equal current results for the current algorithmVersion', () => {
    expect(guardShift(committed, results)).toBe('ok');
  });

  test('a changed total without a version bump fails the guard', () => {
    const changed = structuredClone(results);
    changed.ride_straight!.totals.totalM += 1;
    expect(guardShift(committed, changed)).toBe('changed_without_version_bump');
  });

  test('a changed flag or route without a version bump fails the guard', () => {
    const flag = structuredClone(results);
    flag.scenario_tunnel!.flags = [];
    expect(guardShift(committed, flag)).toBe('changed_without_version_bump');
    const route = structuredClone(results);
    route.ride_grid!.route.pop();
    expect(guardShift(committed, route)).toBe('changed_without_version_bump');
  });

  test('a bumped version asks for regenerated fixtures, and the old ledger entry is kept', () => {
    expect(guardShift(committed, results, algorithmVersion + 1)).toBe('regenerate_fixtures');
    const next = regenerateShift(committed, algorithmVersion + 1);
    expect(next.ledger[String(algorithmVersion)]).toBe(committed.ledger[String(algorithmVersion)]);
    expect(guardShift(next, results, algorithmVersion + 1)).toBe('ok');
  });

  test('regeneration refuses to rewrite an existing version with different outputs', () => {
    const tampered: ShiftGolden = {
      ledger: { [String(algorithmVersion)]: 'deadbeef' },
      results: committed.results,
    };
    expect(() => regenerateShift(tampered, algorithmVersion)).toThrow(/bump it first/);
  });
});
