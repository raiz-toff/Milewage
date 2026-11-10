// Test vectors for the places where JavaScript and Kotlin semantics differ (engine README,
// "Exactness"), computed by the TypeScript engine on Node. Strings are written as arrays of
// UTF-16 code units so lone surrogates survive any JSON reader. Dev tool only. From the repo root:
//   npx vite-node apps/android/engine/tools/export-traps.ts
// Writes apps/android/engine/src/test/resources/trap-vectors.json (committed, prettier-formatted).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  canonicalInputText,
  canonicalJson,
  compareFixes,
  divRound,
  dmToM,
  fnv1a64Hex,
  minMoveDm,
  normalize,
  roundHalfUp,
  simplifyRoute,
  sortFlags,
  type Fix,
  type Flag,
  type ShiftInput,
} from '../../../../packages/track-engine/src/index';
import { bitsHex } from './util';

const units = (s: string): number[] => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));

const STRINGS = [
  '',
  'a',
  'v1',
  'Pizza 🍕 run',
  'Café "Zürich"',
  'back\\slash/',
  '\b\t\n\f\r\u0000\u0001\u001f\u007f\u0080',
  'lone \ud800 high',
  'lone \udc00 low',
  '􏿿 pair at the top',
  '\udc00\ud800 reversed pair',
  'end high \ud83d',
  '  ',
  'ｆｕｌｌ～ and 日本語',
  '￿￾',
];

const roundHalfUpCases = [
  2.5,
  -2.5,
  0.5,
  -0.5,
  -1.5,
  1.4999999999999998,
  0.49999999999999994,
  -0.49999999999999994,
  4503599627370495.5,
  -4503599627370495.5,
  123456789.5,
  -0.0,
  1e15 + 0.5,
];

const divRoundCases: [number, number][] = [
  [15, 10],
  [-15, 10],
  [-16, 10],
  [-14, 10],
  [-5, 10],
  [-4, 10],
  [-6, 10],
  [5, 10],
  [4, 10],
  [-1, 3],
  [-2, 3],
  [1, 3],
  [2, 3],
  [-25, 10],
  [25, 10],
  [-123456789, 10],
  [3000000000000, 7],
];

const fix = (o: Partial<Fix>): Fix => ({
  seq: 1,
  recordedAt: 1000,
  latE7: 0,
  lonE7: 0,
  accuracyM: 5,
  ...o,
});
const comparePairs: [Fix, Fix][] = [
  [fix({ lonE7: -1800000000 }), fix({ lonE7: 1800000000 })],
  [fix({ lonE7: 1800000000 }), fix({ lonE7: -1800000000 })],
  [fix({ latE7: -900000000 }), fix({ latE7: 900000000 })],
  [fix({ recordedAt: 9007199254740000 }), fix({ recordedAt: -9007199254740000 })],
  [fix({ seq: 1 }), fix({ seq: 9007199254740991 })],
  [fix({ accuracyM: 2147483647 }), fix({ accuracyM: -2147483648 })],
];

// Routes that cross the antimeridian (longitude differences beyond Int range), the poles, and a
// zigzag that RDP must keep.
const route = (pts: [number, number][]): { latE7: number; lonE7: number; t: number }[] =>
  pts.map(([latE7, lonE7], i) => ({ latE7, lonE7, t: 1_700_000_000_000 + i * 1000 }));
const routes = [
  route([
    [0, 1799990000],
    [10, 1799999999],
    [5000, -1799995000],
    [-3000, -1799990000],
    [0, -1799980000],
  ]),
  route([
    [0, -1800000000],
    [1000, 0],
    [2000, 1800000000],
    [3000, -1800000000],
  ]),
  route([
    [899999000, 0],
    [899999500, 900000000],
    [899999800, -1700000000],
    [899999000, 1000],
  ]),
  route(
    Array.from(
      { length: 40 },
      (_, i) => [436500000 + i * 900, -793800000 + (i % 2 === 0 ? 0 : 1500)] as [number, number],
    ),
  ),
  route(
    Array.from(
      { length: 30 },
      (_, i) =>
        [-336500000 - i * 2000, 1512000000 + Math.round(Math.sin(i / 3) * 4000)] as [
          number,
          number,
        ],
    ),
  ),
];

// Flags whose order depends on UTF-16 code unit order and on the code strings (not enum order).
const flags: Flag[] = [
  { code: 'gap_counted', at: 5, detail: 'b' },
  { code: 'clock_skew', detail: 'median_ms=1' },
  { code: 'override_orphaned', detail: '～' },
  { code: 'override_orphaned', detail: '😀' },
  { code: 'override_orphaned', detail: 'Z' },
  { code: 'override_orphaned', detail: 'a' },
  { code: 'gap_counted', at: -5, detail: 'a' },
  { code: 'gap_counted', detail: 'a' },
  { code: 'calc_mismatch' },
  { code: 'tracking_interrupted', at: 3, detail: 'to=4' },
];

// Stable sort: two fixes equal in every compared field keep their input order.
const stable = normalize(
  [
    fix({ seq: 7, speedDmps: 1 }),
    fix({ seq: 7, speedDmps: 2 }),
    fix({ seq: 3, recordedAt: 999, speedDmps: 3 }),
  ],
  0,
  2000,
);

const digestInput: ShiftInput = {
  shiftClientId: 'shift-🍕-"x"',
  startedAt: 1700000000000,
  endedAt: 1700000600000,
  fixes: [
    fix({ seq: 2, recordedAt: 1700000001000, latE7: -336500000, lonE7: 1512000000 }),
    fix({
      seq: 1,
      recordedAt: 1700000000000,
      latE7: -336500001,
      lonE7: -1800000000,
      accuracyM: 51,
    }),
  ],
  segmenter: 'stops',
  stopLabels: [
    { stopKey: 'b', role: 'pickup' },
    { stopKey: 'b', role: 'dropoff' },
    { stopKey: '\ud800', role: 'other' },
    { stopKey: 'A', role: 'pickup' },
  ],
  interruptions: [
    { fromMs: 5, toMs: 9 },
    { fromMs: 5, toMs: 6 },
    { fromMs: -3, toMs: 0 },
  ],
  edits: [
    { tripKey: 'k', purpose: 'é' },
    { tripKey: 'k', kind: 'personal' },
    { tripKey: 'k' },
    { tripKey: 'K', kind: 'active', purpose: '' },
  ],
  autoClosed: true,
  clockSkewMs: -130000,
};

const out = {
  strings: STRINGS.map((s) => ({
    units: units(s),
    json: units(JSON.stringify(s)),
    fnv: fnv1a64Hex(s),
  })),
  roundHalfUp: roundHalfUpCases.map((x) => ({ x: bitsHex(x), r: roundHalfUp(x) })),
  divRound: divRoundCases.map(([n, d]) => ({ num: n, den: d, r: divRound(n, d), m: dmToM(n) })),
  compareFixes: comparePairs.map(([a, b]) => ({ a, b, sign: Math.sign(compareFixes(a, b)) })),
  minMoveDm: [
    {
      a: fix({ accuracyM: 2147483647 }),
      b: fix({ accuracyM: 3 }),
      dm: minMoveDm(fix({ accuracyM: 2147483647 }), fix({ accuracyM: 3 })),
    },
    {
      a: fix({ accuracyM: 21 }),
      b: fix({ accuracyM: 35 }),
      dm: minMoveDm(fix({ accuracyM: 21 }), fix({ accuracyM: 35 })),
    },
  ],
  routes: routes.map((r) => ({
    points: r,
    simplified: simplifyRoute(r),
    simplified5m: simplifyRoute(r, 50),
  })),
  flags,
  sortedFlags: canonicalJson(sortFlags(flags)),
  stableSpeeds: stable.map((f) => f.speedDmps),
  digestInput,
  digestText: units(
    canonicalInputText(
      digestInput,
      normalize(digestInput.fixes, digestInput.startedAt, digestInput.endedAt),
    ),
  ),
};
const path = 'apps/android/engine/src/test/resources/trap-vectors.json';
writeFileSync(path, JSON.stringify(out) + '\n');
execFileSync('npx', ['prettier', '--write', '--log-level=warn', path], { stdio: 'inherit' }); // committed, so `npm run lint` checks it
console.log(`wrote ${path}`);
