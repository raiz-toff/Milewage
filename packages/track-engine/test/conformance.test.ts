import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { canonicalJson, processShift, type ShiftInput } from '../src/index';
import { checkAgainstGolden, compareOutputs, run, runInputs, type Io } from './support/conformance';
import { goldenInputs, type ShiftGolden } from './support/goldenShift';

const goldenPath = new URL('./fixtures/golden-shift.json', import.meta.url).pathname;
const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as ShiftGolden;

function memoryIo(files: Record<string, string> = {}) {
  const out: string[] = [];
  const io: Io = {
    read: (p) => {
      const t = files[p];
      if (t === undefined) throw new Error(`no such file ${p}`);
      return t;
    },
    write: (p, t) => void (files[p] = t),
    out: (t) => void out.push(t),
  };
  return { io, files, text: () => out.join('') };
}

describe('conformance runner', () => {
  test('repeat runs of every fixture are byte-identical and equal the committed results', () => {
    const r = checkAgainstGolden(golden);
    expect(r.ok).toBe(true);
    expect(r.lines.at(-1)).toMatch(/^OK: \d+ fixtures/);
    expect(runInputs(goldenInputs())).toEqual(runInputs(goldenInputs()));
  });

  test('inputs survive the JSON file a device harness would load (the Hermes path)', () => {
    const m = memoryIo();
    expect(run(['emit-inputs', 'in.json'], m.io, goldenPath)).toBe(0);
    expect(run(['emit-outputs', 'in.json', 'node.json'], m.io, goldenPath)).toBe(0);
    const viaFile = JSON.parse(m.files['node.json']!) as Record<string, string>;
    expect(compareOutputs(viaFile, runInputs(goldenInputs()))).toEqual([]);
  });

  test('compare reports byte-identical files and names the first differing byte otherwise', () => {
    const outputs = runInputs(goldenInputs());
    const other = { ...outputs };
    const name = Object.keys(outputs)[0]!;
    other[name] = outputs[name]!.replace('"totalM":', '"totalM":1');
    delete other[Object.keys(outputs)[1]!];
    const m = memoryIo({
      'a.json': JSON.stringify(outputs),
      'b.json': JSON.stringify(other),
      'c.json': JSON.stringify(outputs),
    });
    expect(run(['compare', 'a.json', 'c.json'], m.io, goldenPath)).toBe(0);
    expect(m.text()).toContain('byte-identical');
    expect(run(['compare', 'a.json', 'b.json'], m.io, goldenPath)).toBe(1);
    expect(m.text()).toContain(`MISMATCH ${name} at`);
    expect(m.text()).toContain('missing on the second side');
  });

  test('check fails when a committed result differs, and the CLI check command reports it', () => {
    const bad = structuredClone(golden);
    bad.results.ride_straight!.totals.totalM += 1;
    expect(checkAgainstGolden(bad).ok).toBe(false);
    const m = memoryIo({ [goldenPath]: JSON.stringify(bad) });
    expect(run(['check'], m.io, goldenPath)).toBe(1);
    expect(m.text()).toContain('GOLDEN MISMATCH ride_straight');
    const good = memoryIo({ [goldenPath]: JSON.stringify(golden) });
    expect(run(['check'], good.io, goldenPath)).toBe(0);
  });

  test('usage on bad arguments', () => {
    const m = memoryIo();
    expect(run([], m.io, goldenPath)).toBe(2);
    expect(m.text()).toContain('usage');
  });
});

describe('what the result bytes must not contain', () => {
  test('only integers, strings and structure: no float, no undefined, no NaN', () => {
    const inputs: Record<string, ShiftInput> = goldenInputs();
    for (const input of Object.values(inputs)) {
      const text = canonicalJson(processShift(input));
      expect(text).not.toMatch(/\d\.\d/);
      expect(text).not.toMatch(/undefined|NaN|Infinity/);
    }
  });
});
