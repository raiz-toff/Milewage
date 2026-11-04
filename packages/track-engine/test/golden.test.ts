import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { algorithmVersion, normalize, type Fix } from '../src/index';
import {
  computeRides,
  digest,
  guard,
  regenerate,
  runStages,
  type GoldenFile,
} from './support/golden';
import { generateRide, RIDE_SEEDS, type RideName } from './support/rides';

const path = new URL('./fixtures/golden.json', import.meta.url).pathname;
const names = Object.keys(RIDE_SEEDS) as RideName[];

// Writes fixtures only when asked: UPDATE_FIXTURES=1 npx vitest run golden
if (process.env.UPDATE_FIXTURES === '1') {
  const prev = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as GoldenFile) : null;
  writeFileSync(path, JSON.stringify(regenerate(prev, algorithmVersion), null, 2) + '\n');
}
const committed = JSON.parse(readFileSync(path, 'utf8')) as GoldenFile;

describe('seeded ride generator', () => {
  test.each(names)('%s is deterministic and in order', (name) => {
    const a = generateRide(name);
    const b = generateRide(name);
    expect(a).toEqual(b);
    expect(normalize(a.input.fixes, a.input.startedAt, a.input.endedAt)).toEqual(a.input.fixes);
  });

  test('a different seed gives different noise but the same truth', () => {
    const a = generateRide('stop_and_go');
    const b = generateRide('stop_and_go', 999);
    expect(a.input.fixes).not.toEqual(b.input.fixes);
    expect(a.truthM).toBe(b.truthM);
  });

  test.each(names)('%s engine total matches the analytic length', (name) => {
    const ride = generateRide(name);
    const total = runStages(ride.input).totals.totalM;
    expect(Math.abs(total - ride.truthM)).toBeLessThanOrEqual(2 + ride.truthM * 0.002);
  });

  test('stop-and-go jitter inside the waits adds nothing', () => {
    const r = generateRide('stop_and_go');
    expect(runStages(r.input).stats.within_gate).toBeGreaterThanOrEqual(60);
  });
});

describe('golden fixtures', () => {
  test('committed outputs equal current outputs for the current algorithmVersion', () => {
    expect(guard(committed, computeRides(), algorithmVersion)).toBe('ok');
  });

  test('ledger entry matches the committed outputs', () => {
    expect(committed.ledger[String(algorithmVersion)]).toBe(digest(committed.rides));
  });
});

describe('version-bump guard', () => {
  const rides = computeRides();

  test('a simulated output change without a version bump fails the guard', () => {
    const changed = structuredClone(rides);
    changed.straight!.totals.totalM += 1;
    expect(guard(committed, changed, algorithmVersion)).toBe('changed_without_version_bump');
  });

  test('a simulated threshold change shows up in a ride and is caught', () => {
    const fixes: Fix[] = generateRide('straight').input.fixes.slice(0, 20);
    const input = { ...generateRide('straight').input, fixes };
    const changed = { ...rides, straight: runStages(input) };
    expect(guard(committed, changed, algorithmVersion)).toBe('changed_without_version_bump');
  });

  test('a bumped version without regenerated fixtures asks for regeneration', () => {
    expect(guard(committed, rides, algorithmVersion + 1)).toBe('regenerate_fixtures');
  });

  test('regeneration after a bump adds a ledger entry and keeps the old one', () => {
    const next = regenerate(committed, algorithmVersion + 1);
    expect(next.ledger[String(algorithmVersion)]).toBe(committed.ledger[String(algorithmVersion)]);
    expect(guard(next, rides, algorithmVersion + 1)).toBe('ok');
  });

  test('regeneration refuses to rewrite an existing version with different outputs', () => {
    const tampered: GoldenFile = {
      ledger: { [String(algorithmVersion)]: 'deadbeef' },
      rides: committed.rides,
    };
    expect(() => regenerate(tampered, algorithmVersion)).toThrow(/bump it first/);
  });
});
