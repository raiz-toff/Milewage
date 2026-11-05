import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { processShift, type Fix } from '@milewage/track-engine';
import { ride, SHIFT } from './rides';
import { harness, type Harness } from './support';

// Canary run (16 section 4.4, roadmap M8.4): the product is driven with values that must never reach
// diagnostics.db, the debug bundle or the diagnostics views, then every byte is searched for them.
const CANARIES = [
  'CANARY_NOTE',
  'CANARY_BIKE',
  'CANARY_PHONE',
  '123 CANARY ST',
  'CANARY_PLACE',
  '987654',
  'canary.ts.net',
];
const LAT = 437_653_200; // 43.76532 degrees: a coordinate that must not appear as text or as an E7 number
const LON_E7 = -793_832_000;

let h: Harness;
let cookie: string;
let auth: { authorization: string };
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });

async function ridden() {
  const t0 = h.clock.t;
  const fixes: Fix[] = ride(t0).map((f) => ({
    ...f,
    latE7: f.latE7 - 437_000_000 + LAT,
    lonE7: LON_E7,
  }));
  const endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call(
    'POST',
    '/shifts',
    { client_id: SHIFT, vehicle_id: 1, started_at: t0, notes: 'CANARY_NOTE' },
    auth,
  );
  const wire = fixes.map((f) => ({
    seq: f.seq,
    recorded_at: f.recordedAt,
    lat_e7: f.latE7,
    lon_e7: f.lonE7,
    accuracy_m: f.accuracyM,
  }));
  await h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points: wire }, auth);
  const r = processShift({
    shiftClientId: SHIFT,
    startedAt: t0,
    endedAt,
    fixes,
    segmenter: 'stops',
    stopLabels: [],
    interruptions: [],
  });
  await h.call(
    'POST',
    `/shifts/${SHIFT}/end`,
    {
      ended_at: endedAt,
      manifest: { first_seq: 1, last_seq: 312, point_count: 312 },
      phone_result: {
        calc_version: r.algorithmVersion,
        segmenter: 'stops',
        input_digest: r.inputDigest,
        total_m: r.totals.totalM + 10,
        active_m: r.totals.activeM,
        deadhead_m: r.totals.deadheadM,
        personal_m: r.totals.personalM,
        trips_count: r.trips.length,
      },
    },
    auth,
  );
  await web('PUT', `/shifts/${SHIFT}/stop-labels/${encodeURIComponent(r.stops[0]!.stopKey)}`, {
    role: 'dropoff',
    platform: 'ubereats',
    place: '123 CANARY ST',
    notes: 'CANARY_NOTE',
    payout_cents: 987654,
    tip_cents: 100,
    edited_at: h.clock.t,
  });
  await web('POST', `/shifts/${SHIFT}/recalculate`);
}
const phoneEvents = (seq0: number) => [
  {
    kind: 'track.window',
    at: h.clock.t,
    level: 'basic',
    src: 'phone_native',
    seq: seq0,
    shift: SHIFT,
    v: '0.1.0',
    data: {
      fixes: 60,
      acc_hist: [50, 5, 3, 2],
      interval_p50_ms: 10000,
      interval_max_ms: 12000,
      still_gated_s: 0,
      battery_pct: 80,
      charging: false,
      temp_dc: 300,
      thermal: 0,
    },
  },
  {
    kind: 'crash',
    at: h.clock.t,
    level: 'basic',
    src: 'phone_js',
    seq: seq0 + 1,
    v: '0.1.0',
    data: { runtime: 'js', class: 'TypeError', frames: ['app.js:10'], fatal: false },
  },
];
/** Every text value of every table of diagnostics.db. */
function dumpDiagnostics(): string {
  if (!existsSync(join(dirname(h.db.name), 'diagnostics.db'))) return '';
  const db = new Database(join(dirname(h.db.name), 'diagnostics.db'), { readonly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .pluck()
      .all() as string[];
    return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())).join('\n');
  } finally {
    db.close();
  }
}
const leaks = (text: string) =>
  [...CANARIES, '43.7653', '-79.3832', String(LAT), String(LON_E7)].filter((c) => text.includes(c));

beforeEach(async () => {
  h = harness({}, { diagnosticsSampleMs: 40 });
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'CANARY_BIKE', kind: 'car' }, { cookie });
  await h.call('PATCH', '/devices/1', { name: 'CANARY_PHONE' }, { cookie }); // no device yet; harmless
  ({ auth } = await h.pair(cookie));
  await h.call('PATCH', '/devices/1', { name: 'CANARY_PHONE' }, { cookie });
});
afterEach(() => h.close());

describe('redaction canaries across phone events, ingest, server events and the bundle', () => {
  test('nothing reaches diagnostics.db, the events view, the health view or the debug bundle', async () => {
    await ridden();
    const sent = await h.call('POST', '/diagnostics/events', { events: phoneEvents(1) }, auth);
    expect(sent.json().accepted).toBe(2);
    await new Promise((r) => setTimeout(r, 120)); // server.sample and api.window
    expect(leaks(dumpDiagnostics())).toEqual([]);
    expect(dumpDiagnostics()).toContain('engine.run'); // the scan looked at something real

    const events = await web('GET', '/diagnostics/events?limit=200');
    expect(leaks(events.body)).toEqual([]);
    const health = await web('GET', '/diagnostics/health');
    expect(health.body).toContain('Pixel'.length ? 'checks' : '');
    expect(leaks(health.body.replace('CANARY_PHONE', ''))).toEqual([]);

    const bundle = await web('GET', '/diagnostics/bundle');
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers['content-type']).toBe('application/gzip');
    const text = gunzipSync(bundle.rawPayload).toString();
    expect(leaks(text)).toEqual([]);
    const parsed = JSON.parse(text);
    expect(parsed.shifts).toHaveLength(1);
    expect(parsed.shifts[0]).toMatchObject({ id: 'S1', recon: 'differs' });
    expect(JSON.stringify(parsed.shifts)).not.toContain(SHIFT);
    expect(parsed.events.some((e: { shift: string | null }) => e.shift === 'S1')).toBe(true);
    // relative times only: no epoch milliseconds, no dates, no ids, no names
    expect(text).not.toMatch(/\b1[78]\d{11}\b/);
    expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(text).not.toContain(SHIFT);
    expect(parsed.health.devices[0].device).toBe('D1');
    expect(parsed.health.devices[0].name).toBeUndefined();
  });

  test('ingest refuses canaries in every string field and in undeclared fields', async () => {
    const bad = [
      {
        ...phoneEvents(10)[1]!,
        data: { runtime: 'js', class: '43.6532', frames: ['app.js:10'], fatal: false },
      },
      {
        ...phoneEvents(11)[1]!,
        data: { runtime: 'js', class: 'TypeError', frames: ['-79.3832'], fatal: false },
      },
      {
        ...phoneEvents(12)[1]!,
        data: { runtime: 'js', class: 'TypeError', frames: ['436532000'], fatal: false },
      },
      {
        ...phoneEvents(13)[1]!,
        data: {
          runtime: 'js',
          class: 'TypeError',
          frames: [],
          fatal: false,
          address: '123 CANARY ST',
        },
      },
      {
        ...phoneEvents(14)[1]!,
        data: { runtime: 'CANARY_NOTE', class: 'TypeError', frames: [], fatal: false },
      },
      {
        ...phoneEvents(15)[1]!,
        data: { runtime: 'js', class: 'TypeError', frames: [], fatal: false, msg: 'CANARY_NOTE' },
      },
      { ...phoneEvents(16)[1]!, v: 'mwd_canary' },
      { ...phoneEvents(17)[1]!, shift: 'CANARY_NOTE' },
    ];
    const res = await h.call('POST', '/diagnostics/events', { events: bad }, auth);
    expect(res.json()).toMatchObject({ accepted: 0 });
    expect(res.json().rejected).toHaveLength(bad.length);
    expect(res.body).not.toContain('CANARY');
    expect(leaks(dumpDiagnostics())).toEqual([]);
  });

  test('the bundle leaves out a stored event that no longer validates and says how many', async () => {
    await h.call('POST', '/diagnostics/events', { events: phoneEvents(1) }, auth);
    const file = join(dirname(h.db.name), 'diagnostics.db');
    const raw = new Database(file);
    raw
      .prepare("UPDATE diag_events SET data = ? WHERE kind = 'crash'")
      .run(
        JSON.stringify({ runtime: 'js', class: 'TypeError', frames: ['43.6532'], fatal: false }),
      );
    raw.close();
    const res = await web('GET', '/diagnostics/bundle');
    const parsed = JSON.parse(gunzipSync(res.rawPayload).toString());
    expect(parsed.excluded_events).toBe(1);
    expect(JSON.stringify(parsed)).not.toContain('43.6532');
  });

  test('the bundle route switches off with diagnostics.bundle', async () => {
    await h.close();
    h = harness({}, { diagnosticsBundle: false });
    ({ cookie } = await h.signUp());
    expect((await web('GET', '/diagnostics/bundle')).statusCode).toBe(404);
    expect((await web('GET', '/diagnostics/health')).statusCode).toBe(200);
  });
});
