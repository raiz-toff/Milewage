import { describe, expect, test } from 'vitest';
import { normalize, qualify, type Fix } from '../src/index';

const T0 = 1_700_000_000_000;
const END = T0 + 3_600_000;

const fix = (seq: number, dtS: number, accuracyM = 5): Fix => ({
  seq,
  recordedAt: T0 + dtS * 1000,
  latE7: 436_500_000 + seq * 1000,
  lonE7: -793_800_000,
  accuracyM,
});

// Small seeded PRNG so the property tests are reproducible (the engine itself uses none).
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
function shuffle<T>(a: T[], r: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

const base = Array.from({ length: 40 }, (_, i) => fix(i + 1, i * 10, (i * 7) % 90));

describe('normalize', () => {
  test('empty and single-fix inputs', () => {
    expect(normalize([], T0, END)).toEqual([]);
    expect(normalize([fix(1, 0)], T0, END)).toEqual([fix(1, 0)]);
  });

  test('sorts by (recordedAt, seq)', () => {
    expect(normalize([fix(2, 5), fix(1, 5)], T0, END).map((f) => f.seq)).toEqual([1, 2]);
  });

  test('shuffling the input changes nothing', () => {
    const want = qualify(normalize(base, T0, END));
    for (let seed = 1; seed <= 20; seed++) {
      expect(qualify(normalize(shuffle(base, rng(seed)), T0, END))).toEqual(want);
    }
  });

  test('duplicating fixes changes nothing', () => {
    const want = normalize(base, T0, END);
    const dup = shuffle([...base, ...base.slice(5, 20), ...base], rng(9));
    expect(normalize(dup, T0, END)).toEqual(want);
  });

  test('window: 5 min before start and 10 min after end are kept, beyond dropped', () => {
    const f = (seq: number, at: number): Fix => ({ ...fix(seq, 0), recordedAt: at });
    const kept = [f(1, T0 - 300_000), f(2, END + 600_000)];
    const dropped = [f(3, T0 - 300_001), f(4, END + 600_001)];
    expect(normalize([...dropped, ...kept], T0, END).map((x) => x.seq)).toEqual([1, 2]);
  });

  test('does not mutate its input', () => {
    const input = shuffle(base, rng(3));
    const copy = [...input];
    normalize(input, T0, END);
    expect(input).toEqual(copy);
  });
});

describe('qualify', () => {
  test('accuracy boundary at 50: 50 kept, 51 dropped', () => {
    const out = qualify([fix(1, 0, 50), fix(2, 10, 51), fix(3, 20, 0)]);
    expect(out.map((f) => f.seq)).toEqual([1, 3]);
  });

  test('empty input', () => {
    expect(qualify([])).toEqual([]);
  });
});
