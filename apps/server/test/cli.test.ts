import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { algorithmVersion, processShift } from '@milewage/track-engine';
import Database from 'better-sqlite3';
import { runCli } from '../src/cli';
import { recalcReport } from '../src/processing/recalc-report';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let endedAt: number;

const cli = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(
    argv,
    { MILEWAGE_DATA_DIR: dirname(h.db.name) },
    {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    },
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
};
const dump = () =>
  JSON.stringify(
    ['shifts', 'trips', 'shift_flags', 'telemetry_points'].map((t) =>
      h.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(),
    ),
  );

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  const fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  await h.call(
    'POST',
    '/telemetry/batch',
    { shift_client_id: SHIFT, points: fixes.slice(0, 250).map(toWire) },
    auth,
  );
  await h.call(
    'POST',
    '/telemetry/batch',
    { shift_client_id: SHIFT, points: fixes.slice(250).map(toWire) },
    auth,
  );
  await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
});
afterEach(() => h.close());

describe('milewage-cli recalc --dry-run (14 section 11)', () => {
  test('an up-to-date shift shows no difference', async () => {
    const r = await cli('recalc', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('1 shifts compared, 0 differ, 0 skipped. Nothing was changed.');
  });

  test('prints the difference of a stale finalized shift and changes nothing', async () => {
    await h.call('POST', `/shifts/${SHIFT}/finalize`, undefined, { cookie });
    const want = processShift({
      shiftClientId: SHIFT,
      startedAt: t0,
      endedAt,
      fixes: ride(t0),
      segmenter: 'stops',
      stopLabels: [],
      interruptions: [],
    });
    h.db
      .prepare('UPDATE shifts SET total_m = 100, active_m = 100, deadhead_m = 0, calc_version = 1')
      .run();
    const before = dump();
    const r = await cli('recalc', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('finalized');
    expect(r.out).toContain(`1>${algorithmVersion}`);
    expect(r.out).toContain(String(want.totals.totalM));
    expect(r.out).toContain(`+${want.totals.totalM - 100}`);
    expect(r.out).toContain('1 shifts compared, 1 differ');
    expect(dump()).toBe(before);

    const json = JSON.parse((await cli('recalc', '--dry-run', '--json')).out);
    expect(json.changed_nothing).toBe(true);
    expect(json.shifts[0]).toMatchObject({
      shiftId: 1,
      status: 'finalized',
      oldCalcVersion: 1,
      newCalcVersion: algorithmVersion,
      changed: true,
      old: { totalM: 100 },
      next: { totalM: want.totals.totalM },
      diff: { totalM: want.totals.totalM - 100 },
    });
    expect(dump()).toBe(before);
  });

  test('manual trips count the way a recompute counts them; --since filters by local date', async () => {
    await h.call(
      'PUT',
      `/shifts/${SHIFT}/trips/aaaaaaaa-1111-4222-8333-444444444444`,
      {
        kind: 'active',
        started_at: t0 + 1000,
        ended_at: t0 + 2000,
        distance_m: 800,
        purpose: 'x',
        edited_at: h.clock.t,
      },
      auth,
    );
    expect((await cli('recalc', '--dry-run')).out).toContain('0 differ');
    const date = h.db.prepare('SELECT local_date FROM shifts').pluck().get() as string;
    expect((await cli('recalc', '--dry-run', '--since', date)).out).toContain('1 shifts compared');
    expect((await cli('recalc', '--dry-run', `--since=${date}`)).out).toContain(
      '1 shifts compared',
    );
    expect((await cli('recalc', '--dry-run', '--since', '2999-01-01')).out).toContain(
      '0 shifts compared',
    );
  });

  test('an archived shift is skipped, not compared', async () => {
    h.db
      .prepare('INSERT INTO route_archives VALUES (1, 1, \'{"coordinates":[]}\', 0, 0, 5, 1)')
      .run();
    const r = await cli('recalc', '--dry-run');
    expect(r.out).toContain('skipped: raw points were archived');
    expect(r.out).toContain('0 shifts compared, 0 differ, 1 skipped');
  });

  test('usage: --dry-run is required, bad options and dates are refused, there is no database', async () => {
    expect((await cli('recalc')).code).toBe(2);
    expect((await cli('recalc')).err).toContain('--dry-run');
    expect((await cli('recalc', '--dry-run', '--apply')).code).toBe(2);
    expect((await cli('recalc', '--dry-run', '--since', 'yesterday')).code).toBe(2);
    expect((await cli('frobnicate')).code).toBe(2);
    expect((await cli()).code).toBe(0);
    expect((await cli('help')).err).toContain('restore --file <backup.db.gz.age>');
    const none = await runCli(
      ['recalc', '--dry-run'],
      { MILEWAGE_DATA_DIR: '/nonexistent' },
      { out() {}, err() {} },
    );
    expect(none).toBe(1);
  });

  test('the report runs on a read-only connection, so it can never be a second writer', () => {
    const ro = new Database(h.db.name, { readonly: true, fileMustExist: true });
    try {
      expect(recalcReport(ro)).toHaveLength(1);
      expect(() => ro.prepare('UPDATE shifts SET notes = 1').run()).toThrow(/readonly/);
    } finally {
      ro.close();
    }
  });
});
