import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { processShift } from '@milewage/track-engine';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let endedAt: number;

const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const events = async (kind: string) =>
  ((await web('GET', `/diagnostics/events?kind=${kind}&src=server`)).json().items ?? []) as {
    kind: string;
    shift: string | null;
    level: string;
    data: Record<string, unknown>;
  }[];
const SHIFT_ID = SHIFT;

async function runShift(phone = true) {
  t0 = h.clock.t;
  const fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  await h.call(
    'POST',
    '/telemetry/batch',
    { shift_client_id: SHIFT, points: fixes.map(toWire) },
    auth,
  );
  const r = processShift({
    shiftClientId: SHIFT,
    startedAt: t0,
    endedAt,
    fixes,
    segmenter: 'stops',
    stopLabels: [],
    interruptions: [],
  });
  const body = phone
    ? {
        ended_at: endedAt,
        manifest: { first_seq: 1, last_seq: 312, point_count: 312 },
        phone_result: {
          calc_version: r.algorithmVersion,
          segmenter: 'stops',
          input_digest: r.inputDigest,
          total_m: r.totals.totalM + 30,
          active_m: r.totals.activeM,
          deadhead_m: r.totals.deadheadM,
          personal_m: r.totals.personalM,
          trips_count: r.trips.length,
        },
      }
    : { ended_at: endedAt };
  await h.call('POST', `/shifts/${SHIFT}/end`, body, auth);
  return r;
}

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
});
afterEach(() => h.close());

describe('the server records its own engine and reconciliation events (16 section 3.2)', () => {
  test('a shift end gives engine.run and recon.result with the shift id and codes only', async () => {
    const r = await runShift();
    const [run] = await events('engine.run');
    expect(run).toMatchObject({
      level: 'basic',
      shift: SHIFT_ID,
      data: {
        host: 'server',
        reason: 'shift_end',
        calc_version: r.algorithmVersion,
        segmenter: 'stops',
        input_digest: r.inputDigest,
        trips: r.trips.length,
        stops: r.stops.length,
        total_m: r.totals.totalM,
        active_m: r.totals.activeM,
        deadhead_m: r.totals.deadheadM,
        stats: { fixes_in: 312 },
      },
    });
    expect(run!.data.flags).toEqual([...new Set(r.flags.map((f) => f.code))]);
    expect(run!.data.ms).toEqual(expect.any(Number));
    const [recon] = await events('recon.result');
    expect(recon!.data).toMatchObject({
      status: 'differs',
      reasons: ['engine_disagreement'],
      diff_m: -30,
      digest_equal: true,
      phone_calc_v: r.algorithmVersion,
      server_calc_v: r.algorithmVersion,
    });
  });

  test('no phone result is recon.result phone_missing; a label and a recalculate are engine.run reasons', async () => {
    await runShift(false);
    expect((await events('recon.result'))[0]!.data.status).toBe('phone_missing');
    await web('POST', `/shifts/${SHIFT}/recalculate`);
    const stopKey = `${SHIFT}:${t0 + 600_000}:stop`;
    await web('PUT', `/shifts/${SHIFT}/stop-labels/${encodeURIComponent(stopKey)}`, {
      role: 'dropoff',
      edited_at: h.clock.t,
    });
    const reasons = (await events('engine.run')).map((e) => e.data.reason);
    expect(reasons).toContain('shift_end');
    expect(reasons).toContain('recalc');
  });

  test('a backup is recorded as backup.run with its trigger and size', async () => {
    const res = await web('POST', '/backups');
    expect(res.statusCode).toBeLessThan(300);
    const [run] = await events('backup.run');
    expect(run!.data).toMatchObject({ trigger: 'manual', ok: true });
    expect(run!.data.bytes).toBeGreaterThan(0);
  });

  test('level off records nothing and the refusal is counted; module off records nothing at all', async () => {
    await web('PATCH', '/settings', { diagnostics_level: 'off' });
    await runShift();
    expect(await events('engine.run')).toHaveLength(0);
    expect(await events('recon.result')).toHaveLength(0);
    await h.close();
    h = harness({ diagnostics: false });
    ({ cookie } = await h.signUp());
    await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
    ({ auth } = await h.pair(cookie));
    await runShift();
    expect(await events('engine.run')).toHaveLength(0); // 404 body has no items
  });
});
