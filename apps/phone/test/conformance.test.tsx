import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { algorithmVersion, canonicalJson, processShift } from '@milewage/track-engine';
import { goldenInputs } from '../../../packages/track-engine/test/support/goldenShift';
import { App } from '../src/App';
import {
  formatReport,
  runConformance,
  TIMING_BAR_MS,
  TIMING_FIXES,
  timingInput,
  type ConformanceFixtures,
} from '../src/conformance/harness';
import fixtureFile from '../src/conformance/fixtures.json';
import { makeServices, mockServer } from './support/mock';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const fx = fixtureFile as unknown as ConformanceFixtures;

describe('fixtures are current', () => {
  it('inputs equal the engine golden inputs and expected equals the committed golden results', () => {
    expect(canonicalJson(fx.inputs)).toBe(canonicalJson(goldenInputs()));
    const golden = JSON.parse(
      readFileSync(
        require.resolve('../../../packages/track-engine/test/fixtures/golden-shift.json'),
        'utf8',
      ),
    ) as { results: Record<string, unknown> };
    for (const name of Object.keys(fx.inputs)) {
      expect(fx.expected[name]).toBe(canonicalJson(golden.results[name]));
    }
    // If this fails after an engine change: npm run conformance:fixtures -w apps/phone
    expect(fx.algorithmVersion).toBe(algorithmVersion);
  });
});

describe('A10 byte-identical harness', () => {
  it('passes on Node: every fixture matches the stored canonical JSON', () => {
    const r = runConformance(fx, algorithmVersion);
    expect(r.fixtures.length).toBeGreaterThanOrEqual(10);
    expect(r.fixtures.filter((f) => !f.ok)).toEqual([]);
    expect(r.allIdentical).toBe(true);
    expect(r.versionMatches).toBe(true);
    expect(formatReport(r)).toContain('A10 byte-identical: PASS');
  });

  it('a one-unit difference is caught and located; so is a version or fixture mismatch', () => {
    const name = Object.keys(fx.inputs).sort()[0]!;
    const bad = runConformance(fx, algorithmVersion, {
      process: (input) => {
        const out = processShift(input);
        return input === fx.inputs[name]
          ? { ...out, totals: { ...out.totals, totalM: out.totals.totalM + 1 } }
          : out;
      },
      runs: 1,
    });
    expect(bad.allIdentical).toBe(false);
    const hit = bad.fixtures.find((f) => !f.ok)!;
    expect(hit.name).toBe(name);
    expect(hit.firstDiffAt).toBeGreaterThan(0);
    expect(formatReport(bad)).toContain(`MISMATCH ${name}`);

    expect(runConformance(fx, algorithmVersion + 1, { runs: 1 }).allIdentical).toBe(false);
    const missing = runConformance({ ...fx, inputs: {} }, algorithmVersion, { runs: 1 });
    expect(missing.allIdentical).toBe(false);
    expect(missing.fixtures.every((f) => f.excerpt === 'no input')).toBe(true);
  });

  it('records the raw Math results so a Hermes difference can be explained', () => {
    const probe = runConformance(fx, algorithmVersion, { runs: 1 }).mathProbe;
    expect(Object.keys(probe)).toHaveLength(16);
    expect(probe['sqrt(0.5)']).toBe(String(Math.sqrt(0.5)));
  });
});

describe('A12 timing harness', () => {
  it('uses a deterministic 5,000-fix input', () => {
    const a = timingInput();
    expect(a.fixes).toHaveLength(TIMING_FIXES);
    expect(canonicalJson(a)).toBe(canonicalJson(timingInput()));
    const r = processShift(a);
    expect(r.totals.totalM).toBeGreaterThan(10_000);
    expect(canonicalJson(r)).toBe(canonicalJson(processShift(timingInput())));
  });

  it('reports min, median and max against the 200 ms bar with an injected clock', () => {
    let t = 0;
    const steps = [10, 300, 50, 120, 80];
    let i = 0;
    const clock = () => {
      // Each timed run reads the clock twice: start, then end = start + step.
      const idx = i++;
      if (idx % 2 === 0) return t;
      t += steps[(idx - 1) / 2]!;
      return t;
    };
    const r = runConformance(fx, algorithmVersion, { now: clock, runs: 5 });
    expect(r.timing).toMatchObject({ minMs: 10, medianMs: 80, maxMs: 300, withinBar: true });
    const slow = runConformance(fx, algorithmVersion, {
      now: (() => {
        let c = 0;
        return () => (c += 250);
      })(),
      runs: 3,
    });
    expect(slow.timing.withinBar).toBe(false);
    expect(slow.timing.barMs).toBe(TIMING_BAR_MS);
  });

  it('a real run yields finite timings', () => {
    const r = runConformance(fx, algorithmVersion, { runs: 2 });
    expect(Number.isFinite(r.timing.medianMs)).toBe(true);
    expect(r.timing.medianMs).toBeGreaterThanOrEqual(0);
  });
});

describe('engine check screen', () => {
  it('runs the check from Settings and shows the report', async () => {
    render(<App services={makeServices(mockServer({}).fetch, { paired: true }).services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Engine check' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Run engine check' }));
    const text = (await screen.findByTestId('conformance-report')).props.children as string;
    expect(text).toContain('A10 byte-identical: PASS');
    expect(text).toContain(`A12 ${TIMING_FIXES} fixes: median`);
    expect(text).toMatch(/runtime: (hermes|v8-or-other)/);
  });
});
