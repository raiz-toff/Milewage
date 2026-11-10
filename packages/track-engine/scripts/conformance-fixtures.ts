// Writes or checks conformance/fixtures.json: the engine's golden inputs plus the canonical JSON
// that Node produces for each. The Kotlin port (apps/android/engine, ConformanceTest) reads this
// file and must give the same bytes. From the repository root, with Node 22:
//   npm run conformance:fixtures -w @milewage/track-engine   writes it (after an engine change)
//   npm run conformance:check -w @milewage/track-engine      fails when it is stale
// `npm test` runs the same check (test/conformance-fixtures.test.ts), so `npm run verify` does too.
import { readFileSync, writeFileSync } from 'node:fs';
import { checkFixtures, currentFixtures } from '../test/support/conformanceFixtures';

const file = new URL('../conformance/fixtures.json', import.meta.url);

if (process.argv.includes('--check')) {
  const problems = checkFixtures(JSON.parse(readFileSync(file, 'utf8')));
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(
      'conformance/fixtures.json is stale: npm run conformance:fixtures -w @milewage/track-engine',
    );
    process.exitCode = 1;
  } else console.log('conformance fixtures ok');
} else {
  const fixtures = currentFixtures();
  writeFileSync(file, JSON.stringify(fixtures));
  console.log(
    `wrote ${Object.keys(fixtures.inputs).length} fixtures for algorithmVersion ${fixtures.algorithmVersion}`,
  );
}
