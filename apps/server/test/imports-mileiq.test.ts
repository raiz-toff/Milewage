import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { dayOf, readAmount, readMileIq, readTime } from '../src/imports/mileiq';
import { harness, type Harness } from './support';

// The MileIQ preset of the import module. The fixtures follow the documented layout with made-up
// places; the harness owner is in Chicago (US), uses miles and has one vehicle, a Civic.
const US = readFileSync(new URL('./fixtures/mileiq/drive-report-us.csv', import.meta.url), 'utf8');
const KM = readFileSync(new URL('./fixtures/mileiq/drive-report-km.csv', import.meta.url), 'utf8');
const MI = 1609.344;

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
});
afterEach(() => h.close());

const post = (path: string, csv: string) =>
  h.app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    payload: csv,
    headers: { 'content-type': 'text/csv', cookie, origin: 'http://mw.test', host: 'mw.test' },
  });
const all = (sql: string) => h.db.prepare(sql).all() as Record<string, unknown>[];

describe('reading a MileIQ report', () => {
  test('the header is found by name after the summary; totals and footer lines are not drives', () => {
    const file = readMileIq(US, 'USD');
    expect(file.unit).toBe('mi');
    expect(file.hasValue).toBe(true);
    expect(file.dayOrder).toBe('mdy'); // 10/13/2026 can only be month first
    expect(file.rows).toHaveLength(9);
    expect(file.rows.filter((r) => 'error' in r)).toEqual([
      { line: 19, error: 'the start "10/16/2026 25:00" is not a date and time' },
      { line: 20, error: 'the distance "abc" is not a number' },
    ]);
    const second = file.rows[1]!;
    expect('drive' in second && second.drive).toMatchObject({
      line: 13,
      cls: 'business',
      distance: 14.3,
      parking: 550,
      tolls: 225,
      vehicle: 'Blue Corolla',
      notes: 'downtown lot, paid by card',
    });
  });

  test('dates in both orders, 12-hour times, amounts', () => {
    const t = readTime('03/04/2026 1:05 PM')!;
    expect(t.minutes).toBe(13 * 60 + 5);
    expect([dayOf(t, 'mdy'), dayOf(t, 'dmy')]).toEqual(['2026-03-04', '2026-04-03']);
    expect(dayOf(readTime('2026-03-04 07:00')!, 'dmy')).toBe('2026-03-04');
    expect(readTime('03/04/2026')).toBeUndefined(); // a time is required
    expect(dayOf(readTime('02/30/2026 10:00')!, 'mdy')).toBeUndefined();
    expect([readAmount('$5.50', 2), readAmount('', 2), readAmount('5.505', 2)]).toEqual([
      550,
      0,
      undefined,
    ]);
    expect(readAmount('1200', 0)).toBe(1200);
  });

  test('anything else is refused with a plain sentence', () => {
    expect(() => readMileIq('Date,Miles\n2026-01-01,4', 'USD')).toThrow(
      /not a MileIQ drive report/,
    );
  });
});

describe('POST /imports/mileiq/preview', () => {
  test('counts, classes, units, the day order, vehicles and costs, writing nothing', async () => {
    const res = await post('/imports/mileiq/preview', US);
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p).toMatchObject({
      drive_count: 9,
      summary: { ok: 7, duplicate: 0, error: 2, skipped: 0 },
      classes: { business: 3, personal: 2, other: 1, unclassified: 1 },
      distance_m: {
        business: [19.4, 14.3, 1021.6].reduce((a, m) => a + Math.round(m * MI), 0),
        personal: [3.2, 9.9, 2.4, 7.5].reduce((a, m) => a + Math.round(m * MI), 0),
      },
      unit: 'mi',
      date_order: 'mdy',
      date_order_source: 'file',
      unclassified: 'personal',
      value_ignored: true,
      costs: { parking_cents: 550, tolls_cents: 225 + 1200, expenses: 3, left_out: 1 },
    });
    // MileIQ's vehicle is not one of yours: the only vehicle takes the drives, and the preview says so.
    expect(p.vehicles).toEqual([
      { name: 'Blue Corolla', drives: 6, vehicle_id: 1, matched: false },
      { name: null, drives: 1, vehicle_id: 1, matched: false },
    ]);
    expect(p.rows[0]).toMatchObject({
      line: 12,
      status: 'ok',
      class: 'business',
      distance_m: Math.round(19.4 * MI),
      purpose: 'Deliveries',
    });
    expect(p.problems).toEqual([
      { line: 19, message: 'the start "10/16/2026 25:00" is not a date and time' },
      { line: 20, message: 'the distance "abc" is not a number' },
    ]);
    expect(all('SELECT id FROM shifts')).toHaveLength(0);
  });

  test('unclassified drives can be left out', async () => {
    const p = (await post('/imports/mileiq/preview?unclassified=skip', US)).json();
    expect(p.summary).toMatchObject({ ok: 6, skipped: 1 });
  });

  test('a file that is not a MileIQ report is a 422 with the reason', async () => {
    const res = await post('/imports/mileiq/preview', 'Date,Amount\n2026-01-01,5');
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].message).toMatch(/START_DATE and MILES/);
  });
});

describe('POST /imports/mileiq', () => {
  test('one imported shift per drive; business and personal trips; parking and tolls as linked expenses', async () => {
    const res = await post('/imports/mileiq', US);
    expect(res.json()).toEqual({ imported: 7, duplicates: 0, errors: 2, skipped: 0, expenses: 3 });
    const shifts = all(
      'SELECT id, status, segmenter, local_date, total_m, active_m, personal_m, notes, vehicle_id, started_at, ended_at FROM shifts ORDER BY started_at',
    );
    expect(shifts).toHaveLength(7);
    expect(shifts[0]).toMatchObject({
      status: 'finalized',
      segmenter: 'whole_shift',
      local_date: '2026-10-08',
      total_m: Math.round(19.4 * MI),
      active_m: Math.round(19.4 * MI),
      personal_m: 0,
      vehicle_id: 1,
      ended_at: (shifts[0]!.started_at as number) + 27 * 60_000,
    });
    // 13:00 in Chicago (CDT, UTC-5) on 8 October 2026.
    expect(shifts[0]!.started_at).toBe(Date.UTC(2026, 9, 8, 18, 0));
    expect(shifts[0]!.notes).toBe(
      'Imported from MileIQ. From: 100 Example Ave, Springfield, IL, 62701, United States. To: 200 Sample St, Springfield, IL, 62702, United States.',
    );
    const personal = shifts.filter((s) => s.personal_m !== 0);
    expect(personal).toHaveLength(4);
    expect(personal.every((s) => s.active_m === 0)).toBe(true);
    expect(String(personal.find((s) => s.local_date === '2026-10-14')!.notes)).toContain(
      'MileIQ category: Medical.',
    );
    expect(String(personal.find((s) => s.local_date === '2026-10-13')!.notes)).toContain(
      'Unclassified in MileIQ, imported as personal.',
    );
    const trips = all('SELECT kind, source, purpose FROM trips ORDER BY started_at');
    expect(trips.map((t) => t.kind)).toEqual([
      'active',
      'active',
      'personal',
      'personal',
      'personal',
      'personal',
      'active',
    ]);
    expect(trips.every((t) => t.source === 'manual')).toBe(true);
    expect(trips[1]!.purpose).toBe('Deliveries');
    expect(all("SELECT detail FROM shift_flags WHERE code = 'imported'")).toHaveLength(7);

    const costs = all(
      'SELECT category, amount_cents, shift_id, vehicle_id, spent_on FROM expenses ORDER BY id',
    );
    expect(costs).toEqual([
      {
        category: 'parking',
        amount_cents: 550,
        shift_id: shifts[1]!.id,
        vehicle_id: 1,
        spent_on: '2026-10-08',
      },
      {
        category: 'tolls',
        amount_cents: 225,
        shift_id: shifts[1]!.id,
        vehicle_id: 1,
        spent_on: '2026-10-08',
      },
      {
        category: 'tolls',
        amount_cents: 1200,
        shift_id: shifts[6]!.id,
        vehicle_id: 1,
        spent_on: '2026-10-15',
      },
    ]);

    // The deduction counts business distance only (ADR 0005): the summary of the period says so.
    const sum = (
      await h.call('GET', '/summary?from=2026-10-01&to=2026-10-31', undefined, { cookie })
    ).json();
    expect(sum.personal_m).toBe([3.2, 9.9, 2.4, 7.5].reduce((a, m) => a + Math.round(m * MI), 0));

    // The same file again imports nothing.
    const again = (await post('/imports/mileiq', US)).json();
    expect(again).toEqual({ imported: 0, duplicates: 7, errors: 2, skipped: 0, expenses: 0 });
    expect(all('SELECT id FROM shifts')).toHaveLength(7);
    expect(all('SELECT id FROM expenses')).toHaveLength(3);
  });

  test('a kilometre report with the day first', async () => {
    const p = (await post('/imports/mileiq/preview', KM)).json();
    expect(p).toMatchObject({
      unit: 'km',
      date_order: 'dmy',
      date_order_source: 'file',
      summary: { ok: 2, error: 0 },
      vehicles: [{ name: 'Civic', drives: 2, vehicle_id: 1, matched: true }],
    });
    await post('/imports/mileiq', KM);
    expect(all('SELECT local_date, total_m FROM shifts ORDER BY started_at')).toEqual([
      { local_date: '2026-03-14', total_m: 12_500 },
      { local_date: '2026-04-02', total_m: 8_000 },
    ]);
  });

  test('with the expenses module off, no costs are written and the preview says so', async () => {
    h.close();
    h = harness({ expenses: false, receipts: false });
    ({ cookie } = await h.signUp());
    await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
    const p = (await post('/imports/mileiq/preview', US)).json();
    expect(p.costs).toEqual({ parking_cents: 0, tolls_cents: 0, expenses: 0, left_out: 3 });
    expect((await post('/imports/mileiq', US)).json().expenses).toBe(0);
  });
});

test("a country's own date order decides when every date fits both", async () => {
  const { countryDayOrder } = await import('../src/imports/mileiq');
  expect(['US', 'CA', 'GB', 'AU', 'IN'].map(countryDayOrder)).toEqual([
    'mdy',
    'mdy',
    'dmy',
    'dmy',
    'dmy',
  ]);
});
