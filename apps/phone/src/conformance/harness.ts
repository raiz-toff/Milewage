import { canonicalJson, processShift, type Fix, type ShiftInput } from '@milewage/track-engine';

/**
 * Engine conformance and timing harness (14 section 10.1, spike checks A10 and A12).
 * A10: every fixture input goes through `processShift` on this runtime and the canonical JSON must
 * be byte-identical to what Node produced (stored in fixtures.json). A12: time `processShift` on
 * 5,000 fixes against the 200 ms bar. Under jest this runs on Node; the real answer needs the
 * Hermes engine on the S24 Ultra, which is why the screen shows the runtime it ran on.
 */
export interface ConformanceFixtures {
  algorithmVersion: number;
  inputs: Record<string, ShiftInput>;
  /** Canonical JSON of `processShift(input)` as Node produced it. */
  expected: Record<string, string>;
}

export interface FixtureResult {
  name: string;
  ok: boolean;
  /** Index of the first differing character; -1 when identical. */
  firstDiffAt: number;
  /** A short excerpt around the first difference (empty when identical). */
  excerpt: string;
}

export interface TimingResult {
  fixes: number;
  runs: number;
  minMs: number;
  medianMs: number;
  maxMs: number;
  /** The bar for the phone: 200 ms (12 A12). */
  barMs: number;
  withinBar: boolean;
}

export interface ConformanceReport {
  runtime: 'hermes' | 'v8-or-other';
  engineVersion: number;
  fixtureVersion: number;
  versionMatches: boolean;
  fixtures: FixtureResult[];
  allIdentical: boolean;
  timing: TimingResult;
  /** Raw `Math` results; a difference between hosts here explains a mismatch above. */
  mathProbe: Record<string, string>;
}

export const TIMING_FIXES = 5000;
export const TIMING_BAR_MS = 200;

/** Deterministic 5,000-fix ride using integer arithmetic only: no trig, no randomness. */
export function timingInput(n: number = TIMING_FIXES): ShiftInput {
  const t0 = 1_700_000_000_000;
  const fixes: Fix[] = [];
  let lat = 436_500_000;
  let lon = -793_800_000;
  for (let i = 0; i < n; i++) {
    // A block pattern: north 40 fixes, east 40 fixes, with a 15-fix stop between legs.
    const phase = i % 110;
    if (phase < 40) lat += 900;
    else if (phase >= 55 && phase < 95) lon += 1200;
    fixes.push({
      seq: i + 1,
      recordedAt: t0 + i * 5_000,
      latE7: lat,
      lonE7: lon,
      accuracyM: 4 + (i % 7),
      speedDmps: phase < 40 || (phase >= 55 && phase < 95) ? 100 : 0,
    });
  }
  return {
    shiftClientId: '00000000-0000-4000-8000-000000000001',
    startedAt: t0,
    endedAt: t0 + n * 5_000,
    fixes,
    segmenter: 'stops',
  };
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i === a.length && i === b.length ? -1 : i;
}

export function probeMath(): Record<string, string> {
  const xs = [0.5, 0.7853981633974483, 1.2345678901234567, 2.718281828459045];
  const out: Record<string, string> = {};
  for (const x of xs) {
    out[`sin(${x})`] = String(Math.sin(x));
    out[`cos(${x})`] = String(Math.cos(x));
    out[`atan2(${x},3)`] = String(Math.atan2(x, 3));
    out[`sqrt(${x})`] = String(Math.sqrt(x));
  }
  return out;
}

export interface HarnessOptions {
  now?: () => number;
  /** Timed runs after one warm-up run. Default 5. */
  runs?: number;
  /** Replaceable for tests. */
  process?: (input: ShiftInput) => unknown;
}

const defaultNow = (): number => {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
};

export function detectRuntime(): ConformanceReport['runtime'] {
  return (globalThis as { HermesInternal?: unknown }).HermesInternal !== undefined
    ? 'hermes'
    : 'v8-or-other';
}

export function runConformance(
  fx: ConformanceFixtures,
  engineVersion: number,
  opts: HarnessOptions = {},
): ConformanceReport {
  const run = opts.process ?? processShift;
  const now = opts.now ?? defaultNow;
  const fixtures: FixtureResult[] = Object.keys(fx.inputs)
    .sort()
    .map((name) => {
      const got = canonicalJson(run(fx.inputs[name]!));
      const want = fx.expected[name];
      const at = want === undefined ? 0 : firstDiff(got, want);
      return {
        name,
        ok: at === -1,
        firstDiffAt: at,
        excerpt:
          at === -1 || want === undefined
            ? ''
            : `${got.slice(Math.max(0, at - 20), at + 30)} | ${want.slice(Math.max(0, at - 20), at + 30)}`,
      };
    });
  // A fixture present in the expected set but absent from the inputs is also a failure.
  for (const name of Object.keys(fx.expected)) {
    if (!(name in fx.inputs))
      fixtures.push({ name, ok: false, firstDiffAt: 0, excerpt: 'no input' });
  }

  const input = timingInput();
  const runs = opts.runs ?? 5;
  run(input); // warm-up: the first run pays for compilation
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = now();
    run(input);
    times.push(now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  return {
    runtime: detectRuntime(),
    engineVersion,
    fixtureVersion: fx.algorithmVersion,
    versionMatches: engineVersion === fx.algorithmVersion,
    fixtures,
    allIdentical: fixtures.every((f) => f.ok) && engineVersion === fx.algorithmVersion,
    timing: {
      fixes: TIMING_FIXES,
      runs,
      minMs: Math.round((times[0] ?? 0) * 10) / 10,
      medianMs: Math.round(median * 10) / 10,
      maxMs: Math.round((times[times.length - 1] ?? 0) * 10) / 10,
      barMs: TIMING_BAR_MS,
      withinBar: median < TIMING_BAR_MS,
    },
    mathProbe: probeMath(),
  };
}

/** The text the screen shows and the driver can send back: one line per fact. */
export function formatReport(r: ConformanceReport): string {
  const lines = [
    `runtime: ${r.runtime}`,
    `engine algorithmVersion: ${r.engineVersion} (fixtures ${r.fixtureVersion})`,
    `A10 byte-identical: ${r.allIdentical ? 'PASS' : 'FAIL'} (${r.fixtures.filter((f) => f.ok).length}/${r.fixtures.length})`,
    ...r.fixtures
      .filter((f) => !f.ok)
      .map((f) => `  MISMATCH ${f.name} at ${f.firstDiffAt}: ${f.excerpt}`),
    `A12 ${r.timing.fixes} fixes: median ${r.timing.medianMs} ms (min ${r.timing.minMs}, max ${r.timing.maxMs}, ${r.timing.runs} runs) bar ${r.timing.barMs} ms: ${r.timing.withinBar ? 'PASS' : 'FAIL'}`,
  ];
  return lines.join('\n');
}
