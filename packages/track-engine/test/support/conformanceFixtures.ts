// The conformance fixtures every other engine is checked against (conformance/fixtures.json): the
// golden inputs and the canonical JSON Node's processShift gives for each. The Kotlin port in
// apps/android/engine reads the file in place (ConformanceTest) and must produce the same bytes.
import { algorithmVersion, canonicalJson, processShift, type ShiftInput } from '../../src/index';
import { goldenInputs } from './goldenShift';

export interface ConformanceFixtures {
  algorithmVersion: number;
  inputs: Record<string, ShiftInput>;
  /** Fixture name -> canonicalJson(processShift(input)), as Node produces it. */
  expected: Record<string, string>;
}

/** What the file must hold for the engine as it is now. */
export function currentFixtures(): ConformanceFixtures {
  const inputs = goldenInputs();
  const expected: Record<string, string> = {};
  for (const name of Object.keys(inputs).sort())
    expected[name] = canonicalJson(processShift(inputs[name]!));
  return { algorithmVersion, inputs, expected };
}

/**
 * Differences between a fixtures file and what the TypeScript engine produces now: an empty list
 * means every input is the golden input and every stored string is byte for byte Node's output.
 */
export function checkFixtures(file: ConformanceFixtures): string[] {
  const want = currentFixtures();
  const problems: string[] = [];
  if (file.algorithmVersion !== want.algorithmVersion)
    problems.push(
      `algorithmVersion is ${file.algorithmVersion}, the engine is ${want.algorithmVersion}`,
    );
  const names = new Set([...Object.keys(file.inputs ?? {}), ...Object.keys(want.inputs)]);
  for (const name of [...names].sort()) {
    const input = file.inputs?.[name];
    if (input === undefined) problems.push(`${name}: missing from the file`);
    else if (!(name in want.inputs)) problems.push(`${name}: not a golden input any more`);
    else if (canonicalJson(input) !== canonicalJson(want.inputs[name]!))
      problems.push(`${name}: the input differs from the golden input`);
    else if (file.expected?.[name] !== want.expected[name])
      problems.push(`${name}: the stored output differs from processShift's`);
  }
  for (const name of Object.keys(file.expected ?? {}))
    if (!(name in want.inputs)) problems.push(`${name}: an expected output with no input`);
  return problems;
}
