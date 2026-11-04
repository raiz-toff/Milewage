// Comma sanity check (14 section 10.2 item 2). Run from the repo root:
//   npm run comma-sanity -w @milewage/track-engine -- path/to/comma-export.json --unit km
// See test/support/comma.ts for the export format and the limits.
import { readFileSync, writeFileSync } from 'node:fs';
import { run } from '../test/support/comma';

process.exitCode = run(process.argv.slice(2), {
  read: (p) => readFileSync(p, 'utf8'),
  write: (p, t) => writeFileSync(p, t),
  out: (t) => void process.stdout.write(t),
});
