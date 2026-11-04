// Deterministic synthetic rides with known truth (14 section 10.2 item 1).
// Test support only: the engine itself never uses randomness.
import { degToE7, type Fix, type ShiftInput } from '../../src/index';

export type RideName = 'straight' | 'grid' | 'loop' | 'stop_and_go';

export interface Ride {
  input: ShiftInput;
  /** Analytic path length in metres. */
  truthM: number;
}

export const RIDE_SEEDS: Record<RideName, number> = {
  straight: 101,
  grid: 202,
  loop: 303,
  stop_and_go: 404,
};

const T0 = 1_700_000_000_000; // fixed start: no clock
const ORIGIN_LAT = 43.65;
const ORIGIN_LON = -79.38;
const DEG_M = (6_371_000 * Math.PI) / 180; // metres per degree of latitude
const COS_LAT = Math.cos((ORIGIN_LAT * Math.PI) / 180);
const SPEED_MPS = 10;
const STEP_M = 100; // maximum spacing of fixes along a leg

/** mulberry32: small, fast, fully deterministic. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = readonly [number, number]; // metres east, north of the origin

class Recorder {
  fixes: Fix[] = [];
  t = T0;
  constructor(private rand: () => number) {}
  add(p: Pt, jitterM = 0): void {
    const jx = jitterM ? (this.rand() * 2 - 1) * jitterM : 0;
    const jy = jitterM ? (this.rand() * 2 - 1) * jitterM : 0;
    this.fixes.push({
      seq: this.fixes.length + 1,
      recordedAt: this.t,
      latE7: degToE7(ORIGIN_LAT + (p[1] + jy) / DEG_M),
      lonE7: degToE7(ORIGIN_LON + (p[0] + jx) / (DEG_M * COS_LAT)),
      accuracyM: 3 + Math.floor(this.rand() * 10),
    });
  }
}

/** Walk the vertices, emitting a fix at each vertex and evenly between them. Returns length. */
function walk(rec: Recorder, vertices: readonly Pt[]): number {
  let total = 0;
  if (rec.fixes.length === 0) rec.add(vertices[0]!);
  for (let i = 1; i < vertices.length; i++) {
    const [x0, y0] = vertices[i - 1]!;
    const [x1, y1] = vertices[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / STEP_M));
    for (let k = 1; k <= n; k++) {
      rec.t += Math.round(((len / n) * 1000) / SPEED_MPS);
      rec.add([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
    total += len;
  }
  return total;
}

function finish(name: RideName, rec: Recorder, truthM: number): Ride {
  return {
    truthM,
    input: {
      shiftClientId: `synthetic-${name}`,
      startedAt: T0,
      endedAt: rec.t,
      fixes: rec.fixes,
      segmenter: 'whole_shift',
    },
  };
}

export function generateRide(name: RideName, seed: number = RIDE_SEEDS[name]): Ride {
  const rec = new Recorder(seeded(seed));
  if (name === 'straight') {
    return finish(
      name,
      rec,
      walk(rec, [
        [0, 0],
        [0, 5000],
      ]),
    );
  }
  if (name === 'grid') {
    // 200 m blocks, 90-degree turns: N, E, N, E, S, E, N, N.
    const dirs: Pt[] = [
      [0, 1],
      [1, 0],
      [0, 1],
      [1, 0],
      [0, -1],
      [1, 0],
      [0, 1],
      [0, 1],
    ];
    const v: Pt[] = [[0, 0]];
    for (const [dx, dy] of dirs) {
      const [x, y] = v[v.length - 1]!;
      v.push([x + dx * 200, y + dy * 200]);
    }
    return finish(name, rec, walk(rec, v));
  }
  if (name === 'loop') {
    const v: Pt[] = Array.from({ length: 41 }, (_, i) => {
      const a = (2 * Math.PI * (i % 40)) / 40;
      return [300 * Math.sin(a), 300 * (1 - Math.cos(a))] as const;
    });
    return finish(name, rec, walk(rec, v));
  }
  // stop_and_go: four 500 m legs, each followed by a 3-minute wait with GPS jitter.
  let truth = 0;
  let y = 0;
  for (let leg = 0; leg < 4; leg++) {
    truth += walk(rec, [
      [0, y],
      [0, y + 500],
    ]);
    y += 500;
    for (let s = 0; s < 18; s++) {
      rec.t += 10_000;
      rec.add([0, y], s < 17 ? 4 : 0); // the last wait fix is exact, so legs start on the vertex
    }
  }
  return finish(name, rec, truth);
}
