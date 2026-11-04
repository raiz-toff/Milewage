// Cross-engine conformance runner (14 section 10.1). Run from the repo root:
//   npm run conformance -w @milewage/track-engine -- check
// See test/support/conformance.ts for the commands.
import { readFileSync, writeFileSync } from 'node:fs';
import { run } from '../test/support/conformance';

const goldenPath = new URL('../test/fixtures/golden-shift.json', import.meta.url).pathname;
process.exitCode = run(
  process.argv.slice(2),
  {
    read: (p) => readFileSync(p, 'utf8'),
    write: (p, t) => writeFileSync(p, t),
    out: (t) => void process.stdout.write(t),
  },
  goldenPath,
);
