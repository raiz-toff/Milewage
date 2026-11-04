import { createHash } from 'node:crypto';
import { algorithmVersion, gate, normalize, qualify, type ShiftInput } from '../../src/index';
import { generateRide, RIDE_SEEDS, type RideName } from './rides';

/**
 * The part of ShiftResult that stages 1-3 can produce (14 section 3, section 8 stats).
 * Later PRs extend the committed fixtures with trips, stops, route and flags.
 */
export interface StageResult {
  algorithmVersion: number;
  totals: { totalM: number };
  stats: Record<string, number>;
}

export interface GoldenFile {
  /** Append-only: algorithmVersion -> digest of that version's expected outputs. */
  ledger: Record<string, string>;
  rides: Record<string, StageResult>;
}

export function runStages(input: ShiftInput): StageResult {
  const normalized = normalize(input.fixes, input.startedAt, input.endedAt);
  const qualified = qualify(normalized);
  const g = gate(qualified);
  return {
    algorithmVersion,
    totals: { totalM: g.distanceM },
    stats: {
      fixes_in: input.fixes.length,
      fixes_used: g.accepted.length,
      low_accuracy: normalized.length - qualified.length,
      ...g.stats,
    },
  };
}

export function computeRides(): Record<string, StageResult> {
  const rides: Record<string, StageResult> = {};
  for (const name of Object.keys(RIDE_SEEDS) as RideName[]) {
    rides[name] = runStages(generateRide(name).input);
  }
  return rides;
}

export function digest(rides: Record<string, StageResult>): string {
  return createHash('sha256').update(JSON.stringify(rides)).digest('hex');
}

export type GuardVerdict = 'ok' | 'changed_without_version_bump' | 'regenerate_fixtures';

/**
 * The version-bump guard (14 section 11). The ledger records one output digest per
 * algorithmVersion and is append-only. Outputs that differ from the ledger entry of
 * the current version mean the algorithm changed without a bump. A version with no
 * ledger entry yet means fixtures must be regenerated (which adds the entry).
 */
export function guard(
  committed: GoldenFile,
  rides: Record<string, StageResult>,
  version: number,
): GuardVerdict {
  const entry = committed.ledger[String(version)];
  if (entry === undefined) return 'regenerate_fixtures';
  if (entry !== digest(rides)) return 'changed_without_version_bump';
  return JSON.stringify(committed.rides) === JSON.stringify(rides) ? 'ok' : 'regenerate_fixtures';
}

/** Regeneration: refuses to rewrite the ledger entry of an existing version. */
export function regenerate(committed: GoldenFile | null, version: number): GoldenFile {
  const rides = computeRides();
  const ledger = { ...(committed?.ledger ?? {}) };
  const prior = ledger[String(version)];
  if (prior !== undefined && prior !== digest(rides)) {
    throw new Error(`outputs changed but algorithmVersion ${version} is unchanged: bump it first`);
  }
  ledger[String(version)] = digest(rides);
  return { ledger, rides };
}
