import { createHash } from 'node:crypto';
import { algorithmVersion, canonicalJson, processShift, type ShiftResult } from '../../src/index';
import { generateRide, RIDE_SEEDS, type RideName } from './rides';
import { SCENARIOS } from './scenarios';
import type { ShiftInput } from '../../src/index';

/** Every input that is a golden fixture of the whole processShift output. */
export function goldenInputs(): Record<string, ShiftInput> {
  const out: Record<string, ShiftInput> = {};
  for (const name of Object.keys(RIDE_SEEDS) as RideName[])
    out[`ride_${name}`] = generateRide(name).input;
  for (const [name, make] of Object.entries(SCENARIOS)) out[`scenario_${name}`] = make();
  return out;
}

export interface ShiftGolden {
  /** Append-only: algorithmVersion -> sha256 of the canonical JSON of that version's results. */
  ledger: Record<string, string>;
  results: Record<string, ShiftResult>;
}

export function computeResults(
  inputs: Record<string, ShiftInput> = goldenInputs(),
): Record<string, ShiftResult> {
  const out: Record<string, ShiftResult> = {};
  for (const name of Object.keys(inputs).sort()) out[name] = processShift(inputs[name]!);
  return out;
}

export function digestResults(results: Record<string, ShiftResult>): string {
  return createHash('sha256').update(canonicalJson(results)).digest('hex');
}

export type ShiftVerdict = 'ok' | 'changed_without_version_bump' | 'regenerate_fixtures';

export function guardShift(
  committed: ShiftGolden,
  results: Record<string, ShiftResult>,
  version: number = algorithmVersion,
): ShiftVerdict {
  const entry = committed.ledger[String(version)];
  if (entry === undefined) return 'regenerate_fixtures';
  if (entry !== digestResults(results)) return 'changed_without_version_bump';
  return canonicalJson(committed.results) === canonicalJson(results) ? 'ok' : 'regenerate_fixtures';
}

export function regenerateShift(committed: ShiftGolden | null, version: number): ShiftGolden {
  const results = computeResults();
  const ledger = { ...(committed?.ledger ?? {}) };
  const prior = ledger[String(version)];
  if (prior !== undefined && prior !== digestResults(results)) {
    throw new Error(`outputs changed but algorithmVersion ${version} is unchanged: bump it first`);
  }
  ledger[String(version)] = digestResults(results);
  return { ledger, results };
}
