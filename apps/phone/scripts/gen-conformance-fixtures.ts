// Regenerates src/conformance/fixtures.json: the engine's golden inputs plus the canonical JSON
// that Node produces for each. Run with `npm run conformance:fixtures -w apps/phone` after the
// engine's algorithmVersion changes. Dev tool only: it is bundled by esbuild and run by Node.
import { writeFileSync } from 'node:fs';
import {
  algorithmVersion,
  canonicalJson,
  processShift,
} from '../../../packages/track-engine/src/index';
import { goldenInputs } from '../../../packages/track-engine/test/support/goldenShift';

const inputs = goldenInputs();
const expected: Record<string, string> = {};
for (const name of Object.keys(inputs).sort())
  expected[name] = canonicalJson(processShift(inputs[name]!));

const out = new URL('../src/conformance/fixtures.json', import.meta.url);
writeFileSync(out, JSON.stringify({ algorithmVersion, inputs, expected }));
console.log(
  `wrote ${Object.keys(inputs).length} fixtures for algorithmVersion ${algorithmVersion}`,
);
