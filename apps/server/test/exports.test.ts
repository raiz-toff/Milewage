import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { processShift, type Fix } from '@milewage/track-engine';
import { cell } from '../src/exporters/csv';
import { csvExporter } from '../src/exporters/csv';
import { createExporterRegistry, type Exporter } from '../src/exporters/registry';
import { ride, SHIFT, toWire } from './rides';
import { harness, TRACKING_OFF, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let fixes: Fix[];
let endedAt: number;

const web = (url: string) => h.call('GET', url, undefined, { cookie });
const range = '?from=2027-01-01&to=2027-12-31';
const text = async (url: string) => (await web(url)).body;
const lines = (csv: string) => csv.split('\r\n').filter(Boolean);
const engine = () =>
  processShift({ shiftClientId: SHIFT, startedAt: t0, endedAt, fixes, segmenter: 'stops' });

async function setup(
  modules: Record<string, boolean> = {},
  extra: Parameters<typeof harness>[1] = {},
) {
  h = harness(modules, extra);
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  for (let i = 0; i < fixes.length; i += 100) {
    const points = fixes.slice(i, i + 100).map(toWire);
    await h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points }, auth);
  }
  await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
}
const label = (extra: object = {}) => {
  const key = encodeURIComponent(engine().stops[0]!.stopKey);
  return h.call(
    'PUT',
    `/shifts/${SHIFT}/stop-labels/${key}`,
    { role: 'pickup', edited_at: h.clock.t, ...extra },
    { cookie },
  );
};
afterEach(() => h.close());

describe('csv (08 section 11)', () => {
  beforeEach(() => setup());

  test('trip level: one row per trip in the audit columns, CRLF, distances in the owner unit, estimated split marked', async () => {
    const res = await web(`/exports/csv${range}`);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="milewage-2027-01-01_2027-12-31.csv"',
    );
    const rows = lines(res.body);
    expect(rows[0]).toBe(
      'date,start_time,end_time,vehicle,kind,platform,purpose,start_location,end_location,distance,distance_unit,source',
    );
    const trips = engine().trips;
    expect(rows).toHaveLength(1 + trips.length);
    const first = rows[1]!.split(',');
    expect(first[0]).toBe('2027-01-15'); // owner time zone America/Chicago
    expect(first[3]).toBe('Civic');
    expect(first[4]).toBe(`${trips[0]!.kind} (estimated)`);
    expect(Number(first.at(-3))).toBe(Math.round((trips[0]!.distanceM / 1609.344) * 100) / 100);
    expect(first.slice(-2)).toEqual(['mi', 'auto']);
    expect(first[7]).toMatch(/^\d+\.\d{6} -?\d+\.\d{6}$/);
    expect(res.body.endsWith('\r\n')).toBe(true);
  });

  test('the platform of the stop that opened an active segment comes from the web label', async () => {
    await label({ platform: 'ubereats', payout_cents: 850, tip_cents: 200, place: 'Pizza Place' });
    const body = await text(`/exports/csv${range}`);
    const active = lines(body).find((l) => l.split(',')[4]!.startsWith('active'))!;
    expect(active.split(',')[5]).toBe('ubereats');
    expect(body).not.toContain('Pizza Place'); // customer data never leaves in the trip file
  });

  test('shift level: sums over labels, blank when nothing was labelled, split flagged as estimated', async () => {
    const before = lines(await text(`/exports/csv${range}&level=shift`));
    expect(before[0]).toBe(
      'Date,Shift_ID,Vehicle_ID,Start_Time,End_Time,Start_Location,End_Location,Platform,Deliveries_Completed,Gross_Pay,Tips,Active_Miles,Deadhead_Miles,Total_Miles,Deduction_Value,Split_Estimated,Notes,Odometer_Start_Miles,Odometer_End_Miles,Odometer_Check,Year_Odometer_Check,Bonus,Imported,Deduction_Rate',
    );
    const empty = before[1]!.split(',');
    expect(empty.slice(7, 11)).toEqual(['', '', '', '']); // platform, deliveries, pay, tips: "not entered", never 0
    expect(empty[13]).toBe(String(Math.round((engine().totals.totalM / 1609.344) * 100) / 100));
    expect(empty[14]).toBe(''); // no US rate for 2027
    expect(empty[15]).toBe('yes');

    await label({ platform: 'ubereats', payout_cents: 850, tip_cents: 200 });
    const row = lines(await text(`/exports/csv${range}&level=shift`))[1]!.split(',');
    expect(row.slice(7, 11)).toEqual(['ubereats', '0', '8.50', '2.00']); // one label, a pickup: no delivery counted
  });

  test('with the stops setting off the label money is not exported', async () => {
    await label({ payout_cents: 850, tip_cents: 200 });
    await h.call('PATCH', '/settings', { stops_enabled: false }, { cookie });
    const row = lines(await text(`/exports/csv${range}&level=shift`))[1]!.split(',');
    expect(row.slice(7, 11)).toEqual(['', '', '', '']);
  });

  test('cells: RFC 4180 quoting and the formula guard', () => {
    expect(cell('a,b')).toBe('"a,b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell('two\nlines')).toBe('"two\nlines"');
    for (const bad of ['=SUM(A1)', '+1', '-1+2', '@cmd', '\tx']) expect(cell(bad)).toBe(`'${bad}`);
    expect(cell(-5)).toBe('-5'); // a number is not text
    expect(cell(null)).toBe('');
  });

  test('selection: one shift, a vehicle filter, an active shift has nothing to export', async () => {
    expect(lines(await text('/exports/csv?shift_id=1')).length).toBe(1 + engine().trips.length);
    expect(lines(await text(`/exports/csv${range}&vehicle_id=2`))).toHaveLength(1); // header only
    expect((await web(`/exports/csv?shift_id=99`)).json().code).toBe('shift_not_found');
    h.db.prepare("UPDATE shifts SET status = 'active'").run();
    expect(lines(await text('/exports/csv?shift_id=1'))).toHaveLength(1);
  });

  test('validation', async () => {
    for (const q of [
      '',
      '?from=2026-01-01',
      '?from=2026-02-30&to=2026-03-01',
      '?from=2026-03-02&to=2026-03-01',
      '?from=2026-01-01&to=2027-01-02', // 367 days
      '?shift_id=1&from=2026-01-01&to=2026-01-02',
      `${range}&level=day`,
      `${range}&x=1`,
    ]) {
      expect((await web(`/exports/csv${q}`)).statusCode, q).toBe(422);
    }
    expect((await web('/exports/csv?from=2026-01-01&to=2026-12-31')).statusCode).toBe(200); // 365 days
    expect((await web('/exports/csv?from=2026-01-01&to=2027-01-01')).statusCode).toBe(200); // 366 days
  });

  test('access', async () => {
    expect((await h.call('GET', `/exports/csv${range}`)).json().code).toBe('auth_required');
    expect((await h.call('GET', `/exports/csv${range}`, undefined, auth)).statusCode).toBe(403);
  });
});

describe('which formats exist', () => {
  test('GET /settings lists them; unknown and switched-off formats are 404', async () => {
    await setup({}, { enabledExportFormats: () => ['csv', 'expenses'] });
    expect((await web('/settings')).json().modules.exporters).toEqual(['csv', 'expenses']);
    for (const f of ['pdf', 'gpx', 'xlsx']) {
      const res = await web(`/exports/${f}${range}`);
      expect([res.statusCode, res.json().code]).toEqual([404, 'not_found']);
    }
    expect((await web(`/exports/expenses${range}`)).statusCode).toBe(200);
  });

  test('tracking off: every format stays', async () => {
    await setup(TRACKING_OFF);
    expect((await web('/settings')).json().modules.exporters).toEqual([
      'csv',
      'expenses',
      'tax_summary',
      'pdf',
    ]);
    expect((await web(`/exports/csv${range}`)).statusCode).toBe(200);
  });

  test('exporters module off: no route and an empty list', async () => {
    await setup({ exporters: false });
    expect((await web('/settings')).json().modules.exporters).toEqual([]);
    expect((await web(`/exports/csv${range}`)).statusCode).toBe(404);
  });

  test('a new format registers without editing any other module', async () => {
    const txt: Exporter = {
      format: 'txt',
      contentType: 'text/plain',
      extension: 'txt',
      requires: [],
      run: function* (c) {
        yield `shifts: ${c.shifts.length}\n`;
      },
    };
    await setup({}, { exporters: createExporterRegistry([csvExporter, txt]) });
    expect((await web('/settings')).json().modules.exporters).toEqual(['csv', 'txt']);
    const res = await web(`/exports/txt${range}`);
    expect([res.statusCode, res.body]).toEqual([200, 'shifts: 1\n']);
    expect((await web(`/exports/pdf${range}`)).statusCode).toBe(404);
  });
});
