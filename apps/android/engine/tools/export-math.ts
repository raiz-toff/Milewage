// Exports what Node's V8 computes for Math.sin, Math.cos, Math.atan2 and the engine's haversine,
// as raw double bits, so the Kotlin port (:engine) can be checked bit for bit.
// Dev tool only. From the repo root:
//   npx vite-node apps/android/engine/tools/export-math.ts -- [--out DIR] [--pairs N] [--calls N] [--seed S]
// Defaults: --out apps/android/engine/build/crosscheck, --pairs 250000, --calls 300000.
// --sample writes the small committed sample to apps/android/engine/src/test/resources instead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EARTH_RADIUS_M,
  haversineDm,
  roundHalfUp,
  e7ToDeg,
} from '../../../../packages/track-engine/src/index';
import { arg, bitsHex, mulberry32 } from './util';

const sample = process.argv.includes('--sample');
const out = arg(
  '--out',
  sample ? 'apps/android/engine/src/test/resources' : 'apps/android/engine/build/crosscheck',
);
const pairs = Number(arg('--pairs', sample ? '3000' : '250000'));
const calls = Number(arg('--calls', sample ? '1000' : '300000'));
const seed = Number(arg('--seed', sample ? '7' : '20261110'));
const rand = mulberry32(seed);

/** The engine's haversine before rounding: haversine.ts operation for operation. */
function rawDm(aLatE7: number, aLonE7: number, bLatE7: number, bLonE7: number): number {
  const rad = Math.PI / 180;
  const lat1 = e7ToDeg(aLatE7) * rad;
  const lat2 = e7ToDeg(bLatE7) * rad;
  const dLat = lat2 - lat1;
  const dLon = (e7ToDeg(bLonE7) - e7ToDeg(aLonE7)) * rad;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const a = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c * 10;
}

// ---- Math function vectors -------------------------------------------------------------------
const view = new DataView(new ArrayBuffer(8));
function randomBitsDouble(): number {
  view.setUint32(0, Math.floor(rand() * 4294967296));
  view.setUint32(4, Math.floor(rand() * 4294967296));
  return view.getFloat64(0);
}
function logUniform(lo: number, hi: number): number {
  return Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)));
}
const sign = (): number => (rand() < 0.5 ? -1 : 1);

function trigArg(i: number): number {
  switch (i % 8) {
    case 0:
    case 1:
      return (rand() * 2 - 1) * Math.PI; // the haversine's range
    case 2:
      return (rand() * 2 - 1) * 2 * Math.PI;
    case 3:
      return sign() * logUniform(1e-12, 1); // small, incl. below 2^-27
    case 4: // next to multiples of pi/4 (the reduction's branch points)
      return Math.floor(rand() * 16 - 8) * (Math.PI / 4) + sign() * logUniform(1e-17, 1e-3);
    case 5:
      return sign() * logUniform(1, 1e6); // the medium reduction
    case 6:
      return sign() * logUniform(1e6, 1e300); // __kernel_rem_pio2
    default:
      return randomBitsDouble(); // any bit pattern, incl. NaN, infinities, subnormals
  }
}
const SPECIAL = [
  0,
  -0,
  NaN,
  Infinity,
  -Infinity,
  5e-324,
  -5e-324,
  Number.MAX_VALUE,
  Math.PI,
  Math.PI / 2,
  Math.PI / 4,
  1e-300,
  2.2250738585072014e-308,
];

function atan2Args(i: number): [number, number] {
  switch (i % 6) {
    case 0: {
      const a = rand();
      return [Math.sqrt(a), Math.sqrt(1 - a)]; // the haversine's own call
    }
    case 1: {
      const a = logUniform(1e-20, 1e-3);
      return [Math.sqrt(a), Math.sqrt(1 - a)]; // short hops
    }
    case 2:
      return [sign() * logUniform(1e-10, 1e10), sign() * logUniform(1e-10, 1e10)];
    case 3:
      return [(rand() * 2 - 1) * 3, (rand() * 2 - 1) * 3]; // every atan branch
    case 4:
      return [sign() * logUniform(1e-300, 1e300), sign() * logUniform(1e-300, 1e300)];
    default:
      return [randomBitsDouble(), randomBitsDouble()];
  }
}

mkdirSync(out, { recursive: true });
const lines: string[] = [];
for (const x of SPECIAL) {
  lines.push(`sin ${bitsHex(x)} ${bitsHex(Math.sin(x))}`);
  lines.push(`cos ${bitsHex(x)} ${bitsHex(Math.cos(x))}`);
  for (const y of SPECIAL)
    lines.push(`atan2 ${bitsHex(y)} ${bitsHex(x)} ${bitsHex(Math.atan2(y, x))}`);
}
for (let i = 0; i < calls; i++) {
  const x = trigArg(i);
  lines.push(`sin ${bitsHex(x)} ${bitsHex(Math.sin(x))}`);
  const z = trigArg(i + 3);
  lines.push(`cos ${bitsHex(z)} ${bitsHex(Math.cos(z))}`);
  const [y, w] = atan2Args(i);
  lines.push(`atan2 ${bitsHex(y)} ${bitsHex(w)} ${bitsHex(Math.atan2(y, w))}`);
}
const mathFile = join(out, sample ? 'math-sample.txt' : 'math.txt');
writeFileSync(mathFile, lines.join('\n') + '\n');
console.log(`wrote ${lines.length} Math vectors to ${mathFile}`);

// ---- Haversine pairs -------------------------------------------------------------------------
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;
const clampLat = (d: number): number => Math.max(-90, Math.min(90, d));
const wrapLon = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const toE7 = (d: number): number => Math.round(d * 1e7);

/** A point `m` metres from (lat, lon) in a random direction, as E7 integers. */
function hop(lat: number, lon: number, m: number): [number, number, number, number] {
  const th = rand() * 2 * Math.PI;
  const cosLat = Math.max(1e-6, Math.cos((lat * Math.PI) / 180));
  const lat2 = clampLat(lat + (m * Math.cos(th)) / M_PER_DEG);
  const lon2 = wrapLon(lon + (m * Math.sin(th)) / (M_PER_DEG * cosLat));
  return [toE7(lat), toE7(wrapLon(lon)), toE7(lat2), toE7(lon2)];
}

type Pair = [number, number, number, number];
const CATEGORIES: [string, () => Pair][] = [
  ['short 1-100 m', () => hop(rand() * 170 - 85, rand() * 360 - 180, 1 + rand() * 99)],
  ['sub-metre', () => hop(rand() * 170 - 85, rand() * 360 - 180, rand())],
  ['city 100 m-50 km', () => hop(rand() * 140 - 70, rand() * 360 - 180, logUniform(100, 50_000))],
  [
    'long, anywhere',
    () => [
      toE7(rand() * 180 - 90),
      toE7(rand() * 360 - 180),
      toE7(rand() * 180 - 90),
      toE7(rand() * 360 - 180),
    ],
  ],
  [
    'high latitude',
    () => hop(sign() * (80 + rand() * 10), rand() * 360 - 180, logUniform(1, 20_000)),
  ],
  [
    'antimeridian',
    () => hop(rand() * 120 - 60, sign() * (179.9 + rand() * 0.1), logUniform(1, 20_000)),
  ],
  ['equator', () => hop((rand() * 2 - 1) * 0.01, rand() * 360 - 180, logUniform(1, 20_000))],
  [
    'near antipodal',
    () => {
      const lat = rand() * 180 - 90;
      const lon = rand() * 360 - 180;
      return [
        toE7(lat),
        toE7(lon),
        toE7(-lat + (rand() - 0.5) * 1e-3),
        toE7(wrapLon(lon + 180 + (rand() - 0.5) * 1e-3)),
      ];
    },
  ],
];
const EDGES: Pair[] = [
  [0, 0, 0, 0],
  [900000000, 0, -900000000, 0],
  [900000000, 1800000000, 900000000, -1800000000],
  [0, 1800000000, 0, -1800000000],
  [0, 0, 0, 1800000000],
  [0, -1800000000, 0, 1800000000],
  [436500000, -793800000, 436500001, -793800000],
  [-900000000, 123, 900000000, -123],
  [2147483647, 2147483647, -2147483648, -2147483648], // Int extremes, outside the server's range
];

const rows: string[] = [];
let checked = 0;
const emit = ([a, b, c, d]: Pair): void => {
  const raw = rawDm(a, b, c, d);
  const dm = haversineDm(a, b, c, d);
  if (roundHalfUp(raw) !== dm) throw new Error(`rawDm is not haversine.ts for ${a},${b},${c},${d}`);
  rows.push(`${a},${b},${c},${d},${bitsHex(raw)},${dm}`);
  checked++;
};
EDGES.forEach(emit);
for (let i = 0; rows.length < pairs; i++) emit(CATEGORIES[i % CATEGORIES.length]![1]());
const pairFile = join(out, sample ? 'haversine-sample.csv' : 'haversine.csv');
writeFileSync(
  pairFile,
  '# aLatE7,aLonE7,bLatE7,bLonE7,raw dm double bits,haversineDm\n' + rows.join('\n') + '\n',
);
console.log(
  `wrote ${checked} haversine pairs (${CATEGORIES.map((c) => c[0]).join(', ')}) to ${pairFile}`,
);
