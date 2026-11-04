// Cross-engine conformance runner (14 section 10.1). The same fixture inputs go through
// processShift on every host (Node here, Hermes on the S24 Ultra in Spike A); the canonical
// JSON of each result must be byte-identical. This module is the runner; scripts/conformance.ts
// wires it to the file system.
import { createHash } from 'node:crypto';
import { canonicalJson, processShift, type ShiftInput } from '../../src/index';
import { goldenInputs, type ShiftGolden } from './goldenShift';

export interface Io {
  read(path: string): string;
  write(path: string, text: string): void;
  out(text: string): void;
}

/** Name -> canonical JSON text of processShift(input). The unit that is compared byte for byte. */
export function runInputs(inputs: Record<string, ShiftInput>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(inputs).sort())
    out[name] = canonicalJson(processShift(inputs[name]!));
  return out;
}

export interface Mismatch {
  name: string;
  /** Index of the first differing character, or -1 when one side lacks the fixture. */
  at: number;
  detail: string;
}

export function compareOutputs(a: Record<string, string>, b: Record<string, string>): Mismatch[] {
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const bad: Mismatch[] = [];
  for (const name of names) {
    const x = a[name];
    const y = b[name];
    if (x === undefined || y === undefined) {
      bad.push({
        name,
        at: -1,
        detail: `missing on the ${x === undefined ? 'first' : 'second'} side`,
      });
      continue;
    }
    if (x === y) continue;
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    bad.push({
      name,
      at: i,
      detail: `…${x.slice(Math.max(0, i - 20), i + 30)} | …${y.slice(Math.max(0, i - 20), i + 30)}`,
    });
  }
  return bad;
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/** Two fresh runs agree with each other and with the committed golden results. */
export function checkAgainstGolden(golden: ShiftGolden): { ok: boolean; lines: string[] } {
  const inputs = goldenInputs();
  const first = runInputs(inputs);
  const second = runInputs(inputs);
  const committed: Record<string, string> = {};
  for (const name of Object.keys(golden.results).sort())
    committed[name] = canonicalJson(golden.results[name]);
  const repeat = compareOutputs(first, second);
  const vsGolden = compareOutputs(first, committed);
  const lines = Object.keys(first).map(
    (n) => `${n.padEnd(28)} ${sha(first[n]!)}  ${first[n]!.length} bytes`,
  );
  for (const m of repeat) lines.push(`REPEAT MISMATCH ${m.name} at ${m.at}: ${m.detail}`);
  for (const m of vsGolden) lines.push(`GOLDEN MISMATCH ${m.name} at ${m.at}: ${m.detail}`);
  const ok = repeat.length === 0 && vsGolden.length === 0 && Object.keys(first).length > 0;
  lines.push(
    ok
      ? `OK: ${Object.keys(first).length} fixtures, repeat runs and golden byte-identical`
      : 'FAILED',
  );
  return { ok, lines };
}

const USAGE = `usage: conformance check
       conformance emit-inputs <inputs.json>
       conformance emit-outputs <inputs.json> <outputs.json>
       conformance compare <outputsA.json> <outputsB.json>`;

/** Returns the exit code. */
export function run(argv: readonly string[], io: Io, goldenPath: string): number {
  const [cmd, a, b] = argv;
  if (cmd === 'check') {
    const r = checkAgainstGolden(JSON.parse(io.read(goldenPath)) as ShiftGolden);
    io.out(r.lines.join('\n') + '\n');
    return r.ok ? 0 : 1;
  }
  if (cmd === 'emit-inputs' && a) {
    io.write(a, JSON.stringify(goldenInputs()) + '\n');
    io.out(`wrote ${Object.keys(goldenInputs()).length} inputs to ${a}\n`);
    return 0;
  }
  if (cmd === 'emit-outputs' && a && b) {
    const outputs = runInputs(JSON.parse(io.read(a)) as Record<string, ShiftInput>);
    io.write(b, JSON.stringify(outputs) + '\n');
    io.out(`wrote ${Object.keys(outputs).length} canonical results to ${b}\n`);
    return 0;
  }
  if (cmd === 'compare' && a && b) {
    const bad = compareOutputs(
      JSON.parse(io.read(a)) as Record<string, string>,
      JSON.parse(io.read(b)) as Record<string, string>,
    );
    for (const m of bad) io.out(`MISMATCH ${m.name} at ${m.at}: ${m.detail}\n`);
    io.out(bad.length === 0 ? 'byte-identical\n' : `${bad.length} mismatching fixtures\n`);
    return bad.length === 0 ? 0 : 1;
  }
  io.out(USAGE + '\n');
  return 2;
}
