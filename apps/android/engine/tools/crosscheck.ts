// Randomised cross-check of the Kotlin engine (:engine) against the TypeScript one.
// Generates random shifts (poor accuracy, gaps, stops, spikes, edits, labels, duplicate seqs,
// out-of-order fixes, clock skew, interruptions, auto-closed, odd strings, high latitudes and
// the antimeridian) and writes, one JSON object per line: the input, the canonical JSON of
// processShift, the live accumulator's total, lastFixEnd and measureDistance's figures.
// Dev tool only. From the repo root:
//   npx vite-node apps/android/engine/tools/crosscheck.ts -- [--shifts N] [--seed S] [--out FILE]
// Default: 2000 shifts to apps/android/engine/build/crosscheck/shifts.jsonl (gitignored).
// --sample writes the committed 100-shift sample to src/test/resources/crosscheck-sample.jsonl.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  algorithmVersion,
  canonicalJson,
  createLiveAccumulator,
  lastFixEnd,
  measureDistance,
  processShift,
  type Fix,
  type ShiftInput,
  type StopLabelInput,
  type TripEdit,
} from '../../../../packages/track-engine/src/index';
import { arg, mulberry32 } from './util';

const sample = process.argv.includes('--sample');
const count = Number(arg('--shifts', sample ? '100' : '2000'));
const seed = Number(arg('--seed', sample ? '42' : '20261110'));
const maxFixes = Number(arg('--max-fixes', sample ? '160' : '900'));
const out = arg(
  '--out',
  sample
    ? 'apps/android/engine/src/test/resources/crosscheck-sample.jsonl'
    : 'apps/android/engine/build/crosscheck/shifts.jsonl',
);
const rand = mulberry32(seed);
const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p: number): boolean => rand() < p;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const M_PER_DEG = (6_371_000 * Math.PI) / 180;
const wrapLon = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const clampLat = (d: number): number => Math.max(-90, Math.min(90, d));
const toE7 = (d: number): number => Math.round(d * 1e7);

const ODD_STRINGS = [
  'Pizza 🍕 run',
  'Café "Zürich"',
  'back\\slash',
  'tab\there\nnewline',
  '\u0001ctl\u001f',
  'lone \ud800 surrogate',
  'low \udc00 first',
  'sep  ',
  'ｆｕｌｌ～',
  '',
  'Business driving',
  '日本語の配達',
  'del\u007f',
];

function shiftId(i: number): string {
  if (chance(0.1)) return `shift-${pick(ODD_STRINGS)}-${i}`;
  const h = (n: number): string =>
    Math.floor(rand() * 16 ** n)
      .toString(16)
      .padStart(n, '0');
  return `${h(8)}-${h(4)}-4${h(3)}-8${h(3)}-${h(12)}`;
}

/** Accuracy: mostly good, some between 21 and 50 m (larger minimum move), some over 50 (dropped). */
function accuracy(poor: boolean): number {
  const r = rand();
  if (poor) return r < 0.6 ? int(51, 400) : int(15, 50);
  return r < 0.85 ? int(2, 15) : r < 0.97 ? int(16, 50) : int(51, 120);
}

interface Walker {
  lat: number;
  lon: number;
  t: number;
  heading: number;
}

function generate(i: number): ShiftInput {
  // Where on Earth: a mid-latitude city, high latitude, the antimeridian, the equator.
  const region = pick(['city', 'city', 'city', 'high', 'antimeridian', 'equator', 'south']);
  const w: Walker = {
    lat:
      region === 'high'
        ? (chance(0.5) ? 1 : -1) * (75 + rand() * 14.5)
        : region === 'equator'
          ? (rand() - 0.5) * 0.02
          : region === 'south'
            ? -(rand() * 55)
            : rand() * 120 - 60,
    lon:
      region === 'antimeridian'
        ? (chance(0.5) ? 1 : -1) * (179.97 + rand() * 0.03)
        : rand() * 360 - 180,
    t: chance(0.05)
      ? int(0, 1_000_000_000)
      : 1_600_000_000_000 + Math.floor(rand() * 200_000_000_000),
    heading: rand() * 2 * Math.PI,
  };
  const fixes: Fix[] = [];
  let seq = int(1, 1_000_000);
  const target = int(8, maxFixes);
  const poorShift = chance(0.12);
  const jitter = (m: number): [number, number] => [(rand() * 2 - 1) * m, (rand() * 2 - 1) * m];
  const move = (m: number, heading: number): void => {
    const cosLat = Math.max(1e-6, Math.cos((w.lat * Math.PI) / 180));
    w.lat = clampLat(w.lat + (m * Math.cos(heading)) / M_PER_DEG);
    w.lon = wrapLon(w.lon + (m * Math.sin(heading)) / (M_PER_DEG * cosLat));
  };
  const emit = (jm: number, acc = accuracy(poorShift)): void => {
    const [jx, jy] = jitter(jm);
    const cosLat = Math.max(1e-6, Math.cos((w.lat * Math.PI) / 180));
    const f: Fix = {
      seq: seq,
      recordedAt: w.t,
      latE7: toE7(clampLat(w.lat + jy / M_PER_DEG)),
      lonE7: toE7(wrapLon(w.lon + jx / (M_PER_DEG * cosLat))),
      accuracyM: acc,
    };
    seq += chance(0.03) ? int(2, 50) : 1; // gaps in seq are allowed
    if (chance(0.2)) f.speedDmps = int(0, 300);
    if (chance(0.1)) f.bearingDeg = int(0, 359);
    if (chance(0.1)) f.altitudeM = int(-50, 3000);
    fixes.push(f);
  };

  emit(3);
  while (fixes.length < target) {
    const what = rand();
    if (what < 0.5) {
      // Ride: 3-25 m/s, a fix every 1-15 s, slowly turning.
      const speed = 3 + rand() * 22;
      const n = int(3, 40);
      for (let k = 0; k < n && fixes.length < target; k++) {
        const dt = int(1, 15);
        w.t += dt * 1000 + int(-300, 300);
        w.heading += (rand() - 0.5) * 0.6;
        move(speed * dt, w.heading);
        emit(rand() * 12);
      }
    } else if (what < 0.75) {
      // Stop: 30 s to 45 min, parked jitter; sometimes the GPS sleeps (one wake-up fix).
      const dur = pick([30, 90, 150, 200, 400, 700, 1200, 2000, 2700]) * 1000 + int(0, 60_000);
      if (chance(0.3)) {
        w.t += dur;
        emit(rand() * 10);
      } else {
        const every = int(5, 30) * 1000;
        for (let el = every; el <= dur && fixes.length < target; el += every) {
          w.t += every;
          emit(rand() * 30);
        }
      }
    } else if (what < 0.85) {
      // Signal gap: 60 s to 20 min of silence, then far along (or a teleport, a spike).
      const silence = int(60, 1200) * 1000;
      w.t += silence;
      move(
        chance(0.2) ? int(5_000, 60_000) : (silence / 1000) * (2 + rand() * 15),
        rand() * 2 * Math.PI,
      );
      emit(5);
    } else if (what < 0.92) {
      // A glitch fix kilometres away, then back.
      w.t += int(1, 10) * 1000;
      const save = { lat: w.lat, lon: w.lon };
      move(int(500, 50_000), rand() * 2 * Math.PI);
      emit(0, int(3, 30));
      w.lat = save.lat;
      w.lon = save.lon;
    } else {
      // Poor accuracy burst, or two fixes at the same time.
      if (chance(0.5)) {
        for (let k = 0; k < int(2, 12) && fixes.length < target; k++) {
          w.t += int(1, 10) * 1000;
          move(int(0, 80), w.heading);
          emit(40, int(51, 500));
        }
      } else {
        emit(5);
      }
    }
  }

  // Duplicate seqs (exact retries, and conflicting content), then any order.
  const dups = chance(0.4) ? int(1, 8) : 0;
  for (let k = 0; k < dups; k++) {
    const f = pick(fixes);
    fixes.push(
      chance(0.6)
        ? { ...f }
        : { ...f, latE7: f.latE7 + int(-500, 500), recordedAt: f.recordedAt + int(-2000, 2000) },
    );
  }
  const first = Math.min(...fixes.map((f) => f.recordedAt));
  const last = Math.max(...fixes.map((f) => f.recordedAt));
  // Fixes outside the window.
  if (chance(0.2))
    fixes.push({
      seq: seq++,
      recordedAt: first - int(6, 60) * 60_000,
      latE7: fixes[0]!.latE7,
      lonE7: fixes[0]!.lonE7,
      accuracyM: 5,
    });
  if (chance(0.2))
    fixes.push({
      seq: seq++,
      recordedAt: last + int(11, 60) * 60_000,
      latE7: fixes[0]!.latE7,
      lonE7: fixes[0]!.lonE7,
      accuracyM: 5,
    });
  const order = rand();
  // order < 0.25: as recorded
  if (order >= 0.25 && order < 0.5) shuffle(fixes);
  else if (order < 0.65) fixes.reverse();
  else if (order < 0.8)
    for (let k = 0; k < int(1, 10); k++)
      swap(fixes, int(0, fixes.length - 1), int(0, fixes.length - 1));

  const startedAt = first + int(-6 * 60, 4 * 60) * 1000;
  const endedAt = Math.max(startedAt, last + int(-12 * 60, 12 * 60) * 1000);
  const input: ShiftInput = {
    shiftClientId: shiftId(i),
    startedAt,
    endedAt,
    fixes,
    segmenter: chance(0.7) ? 'stops' : 'whole_shift',
  };
  if (chance(0.25)) {
    input.interruptions = Array.from({ length: int(0, 3) }, () => {
      const from = int(startedAt, endedAt);
      return { fromMs: from, toMs: from + int(0, 3_600_000) };
    });
  }
  if (chance(0.2)) input.autoClosed = true;
  if (chance(0.5)) input.clockSkewMs = int(-400_000, 400_000);

  // Labels and edits refer to the stops and trips a first run finds, plus orphans and duplicates.
  const firstRun = processShift(input);
  if (chance(0.6)) {
    const labels: StopLabelInput[] = [];
    for (const s of firstRun.stops) {
      if (chance(0.5))
        labels.push({ stopKey: s.stopKey, role: pick(['pickup', 'dropoff', 'other'] as const) });
      if (chance(0.1))
        labels.push({ stopKey: s.stopKey, role: pick(['pickup', 'dropoff', 'other'] as const) });
    }
    if (chance(0.3))
      labels.push({ stopKey: `${input.shiftClientId}:${int(0, 1e12)}:stop`, role: 'pickup' });
    if (chance(0.1)) labels.push({ stopKey: pick(ODD_STRINGS), role: 'other' });
    shuffle(labels);
    input.stopLabels = labels;
  }
  const secondRun = input.stopLabels ? processShift(input) : firstRun;
  if (chance(0.6)) {
    const edits: TripEdit[] = [];
    for (const t of secondRun.trips) {
      if (!chance(0.5)) continue;
      const e: TripEdit = { tripKey: t.tripKey };
      if (chance(0.7)) e.kind = pick(['active', 'deadhead', 'personal'] as const);
      if (chance(0.5)) e.purpose = pick(ODD_STRINGS);
      edits.push(e);
      if (chance(0.15)) edits.push({ tripKey: t.tripKey, purpose: pick(ODD_STRINGS) });
    }
    if (chance(0.3))
      edits.push({ tripKey: `${input.shiftClientId}:${int(0, 1e12)}:active`, kind: 'personal' });
    if (chance(0.1)) edits.push({ tripKey: pick(ODD_STRINGS) });
    shuffle(edits);
    input.edits = edits;
  }
  return input;
}

function shuffle<T>(xs: T[]): void {
  for (let i = xs.length - 1; i > 0; i--) swap(xs, i, Math.floor(rand() * (i + 1)));
}
function swap<T>(xs: T[], i: number, j: number): void {
  const t = xs[i]!;
  xs[i] = xs[j]!;
  xs[j] = t;
}

mkdirSync(dirname(out), { recursive: true });
const lines: string[] = [];
let fixesTotal = 0;
for (let i = 0; i < count; i++) {
  const input = generate(i);
  fixesTotal += input.fixes.length;
  const live = createLiveAccumulator(input.startedAt);
  for (const f of input.fixes) live.push(f);
  const m = measureDistance(input.fixes, input.startedAt, input.endedAt);
  lines.push(
    JSON.stringify({
      name: `random_${seed}_${i}`,
      input,
      expected: canonicalJson(processShift(input)),
      liveM: live.runningTotalM(),
      lastFixEnd: lastFixEnd(input.fixes, input.startedAt),
      measure: {
        distanceM: m.distanceM,
        accepted: m.accepted.length,
        segments: m.segments.length,
        spikes: m.spikes.length,
        ...m.stats,
      },
    }),
  );
}
writeFileSync(
  out,
  `{"algorithmVersion":${algorithmVersion},"seed":${seed},"shifts":${count}}\n` +
    lines.join('\n') +
    '\n',
);
console.log(
  `wrote ${count} shifts (${fixesTotal} fixes) for algorithmVersion ${algorithmVersion} to ${out}`,
);
