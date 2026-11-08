import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseCsv, toCents, zonedInstant } from '../src/imports/csv';
import { harness, type Harness } from './support';

// 18 section 12: the generic CSV import. The owner of the test harness is in Chicago and uses miles.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
});
afterEach(() => h.close());

const post = (path: string, csv: string | Buffer, headers: object = {}) =>
  h.app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    payload: csv,
    headers: {
      'content-type': 'text/csv',
      cookie,
      origin: 'http://mw.test',
      host: 'mw.test',
      ...headers,
    },
  });
const EXPENSES = [
  'Date,Category,Vendor,Amount,Deductible,Business use,Memo',
  '2026-03-01,Fuel,Shell,"$1,250.50",yes,100,fill up',
  '2026-03-02,phone,Rogers,80.00,,,',
  '2026-03-02,phone,Rogers,80.00,,,',
  'not a date,fuel,X,5,,,',
  '2026-03-03,fuel,Y,-5,,,',
].join('\n');
const SHIFTS = [
  'Date,Start,End,Miles,Vehicle,Platform,Gross,Tips',
  '2027-01-10,09:30,13:30,42.5,Civic,doordash,120.00,15.50',
  '2027-01-11,22:00,02:00,30,,,0,0',
  '2027-01-12,25:00,02:00,30,,,0,0',
  '2027-01-13,10:00,12:00,abc,,,0,0',
].join('\n');

describe('reading', () => {
  test('quotes, doubled quotes, line endings, a byte-order mark, amounts and zone arithmetic', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', '2'],
    ]);
    expect([toCents('$1,234.5'), toCents('12'), toCents('1.234'), toCents('x')]).toEqual([
      123_450,
      1200,
      NaN,
      NaN,
    ]);
    expect(new Date(zonedInstant('2027-01-10', 570, 'America/Chicago')).toISOString()).toBe(
      '2027-01-10T15:30:00.000Z',
    );
    expect(new Date(zonedInstant('2027-07-10', 570, 'America/Chicago')).toISOString()).toBe(
      '2027-07-10T14:30:00.000Z',
    ); // daylight time
  });
});

describe('expenses', () => {
  test('preview guesses the columns and writes nothing; rows are ok, duplicate or error', async () => {
    const res = await post('/imports/expenses/preview', EXPENSES);
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.mapping).toMatchObject({
      spent_on: 'Date',
      category: 'Category',
      amount: 'Amount',
      merchant: 'Vendor',
      business_pct: 'Business use',
      notes: 'Memo',
    });
    expect(p.summary).toEqual({ ok: 2, duplicate: 1, error: 2 });
    expect(p.rows.map((r: { status: string }) => r.status)).toEqual([
      'ok',
      'ok',
      'duplicate',
      'error',
      'error',
    ]);
    expect(p.rows[3].message).toMatch(/date/);
    expect(p.problems).toEqual([
      { row: 4, message: expect.stringMatching(/date/) },
      { row: 5, message: expect.stringMatching(/amount/) },
    ]);
    expect(h.db.prepare('SELECT count(*) FROM expenses').pluck().get()).toBe(0);
  });

  test('preview lists every problem row, past the first 200 rows, up to 1000', async () => {
    const good = (i: number) => `2026-03-01,fuel,Shop ${i},5`;
    const lines = ['Date,Category,Vendor,Amount'];
    for (let i = 1; i <= 300; i++) lines.push(i === 250 ? 'not a date,fuel,X,5' : good(i));
    const late = (await post('/imports/expenses/preview', lines.join('\n'))).json();
    expect(late.rows).toHaveLength(200);
    expect(late.problems).toEqual([{ row: 250, message: expect.stringMatching(/date/) }]);

    const bad = ['Date,Category,Vendor,Amount', ...Array(1200).fill('x,fuel,X,5')].join('\n');
    const many = (await post('/imports/expenses/preview', bad)).json();
    expect(many.summary.error).toBe(1200);
    expect(many.problems).toHaveLength(1000);
    expect(many.problems.at(-1).row).toBe(1000);
  });

  test('commit writes the ok rows once; the same file again imports nothing', async () => {
    const first = (await post('/imports/expenses', EXPENSES)).json();
    expect(first).toMatchObject({ imported: 2, duplicates: 1, errors: 2 });
    expect(first.error_rows).toHaveLength(2);
    const items = (await h.call('GET', '/expenses', undefined, { cookie })).json().items;
    expect(items.map((e: { merchant: string }) => e.merchant).sort()).toEqual(['Rogers', 'Shell']);
    expect(items.find((e: { merchant: string }) => e.merchant === 'Shell')).toMatchObject({
      amount_cents: 125_050,
      category: 'fuel',
      notes: 'fill up',
    });
    expect(items.find((e: { merchant: string }) => e.merchant === 'Rogers')).toMatchObject({
      category: 'phone',
      business_pct: 50,
    });
    const again = (await post('/imports/expenses', EXPENSES)).json();
    expect(again).toMatchObject({ imported: 0, duplicates: 3 });
  });

  test('a confirmed mapping overrides the guess; a mapping to a missing column is refused', async () => {
    const csv = 'when,what,howmuch\n2026-05-01,tolls,7.25';
    const m = encodeURIComponent(
      JSON.stringify({ spent_on: 'when', category: 'what', amount: 'howmuch' }),
    );
    const r = (await post(`/imports/expenses?mapping=${m}`, csv)).json();
    expect(r.imported).toBe(1);
    const bad = encodeURIComponent(JSON.stringify({ amount: 'nope' }));
    expect((await post(`/imports/expenses/preview?mapping=${bad}`, csv)).statusCode).toBe(422);
    expect((await post('/imports/expenses/preview', 'when,what\n')).statusCode).toBe(422);
  });

  test('a gzip body is accepted, and text/plain is read like text/csv', async () => {
    const res = await post('/imports/expenses/preview', gzipSync(EXPENSES), {
      'content-encoding': 'gzip',
    });
    expect(res.json().summary.ok).toBe(2);
    // a browser may label a .csv file text/plain; the body is read the same way
    expect(
      (await post('/imports/expenses/preview', EXPENSES, { 'content-type': 'text/plain' })).json()
        .summary.ok,
    ).toBe(2);
  });
});

describe('shifts', () => {
  test('preview reports each row; a bad time, distance or vehicle is an error with the reason', async () => {
    const p = (await post('/imports/shifts/preview', SHIFTS)).json();
    expect(p.summary).toEqual({ ok: 2, duplicate: 0, error: 2 });
    expect(p.rows[2].message).toMatch(/start time/);
    expect(p.rows[3].message).toMatch(/distance/);
    const novehicle = (
      await post(
        '/imports/shifts/preview',
        'Date,Start,End,Miles,Vehicle\n2027-01-10,09:00,10:00,5,Truck',
      )
    ).json();
    expect(novehicle.rows[0].message).toMatch(/no vehicle/);
  });

  test('commit: finalized whole-shift records with one manual trip, an imported flag and an import earnings row', async () => {
    const r = (await post('/imports/shifts', SHIFTS)).json();
    expect(r).toMatchObject({ imported: 2, errors: 2 });
    const s = (await h.call('GET', '/shifts/1', undefined, { cookie })).json();
    expect(s).toMatchObject({
      status: 'finalized',
      segmenter: 'whole_shift',
      local_date: '2027-01-10',
      vehicle_id: 1,
      started_at: Date.parse('2027-01-10T15:30:00Z'),
      ended_at: Date.parse('2027-01-10T19:30:00Z'),
      total_m: Math.round(42.5 * 1609.344),
    });
    expect(s.flags.map((f: { code: string }) => f.code)).toContain('imported');
    const trips = (await h.call('GET', '/shifts/1/trips', undefined, { cookie })).json();
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({
      source: 'manual',
      purpose: 'Imported',
      distance_m: s.total_m,
    });
    const e = (await h.call('GET', '/shifts/1/earnings', undefined, { cookie })).json();
    expect(e.entries[0]).toMatchObject({
      platform: 'doordash',
      gross_cents: 12_000,
      tips_cents: 1550,
      source: 'import',
    });
    // the overnight row crosses midnight: 22:00 to 02:00 is four hours
    expect((await h.call('GET', '/shifts/2', undefined, { cookie })).json().ended_at).toBe(
      Date.parse('2027-01-12T08:00:00Z'),
    );
  });

  test('every export marks the shift as imported, and a repeat imports nothing', async () => {
    await post('/imports/shifts', SHIFTS);
    const csv = (
      await h.call('GET', '/exports/csv?from=2027-01-01&to=2027-01-31&level=shift', undefined, {
        cookie,
      })
    ).body.split('\r\n');
    const head = csv[0]!.split(',');
    expect(csv[1]!.split(',')[head.indexOf('Imported')]).toBe('yes');
    const trip = (
      await h.call('GET', '/exports/csv?from=2027-01-01&to=2027-01-31', undefined, { cookie })
    ).body;
    expect(trip).toMatch(/Imported,/);
    expect(trip).toMatch(/,manual\r?\n/);
    expect((await post('/imports/shifts', SHIFTS)).json()).toMatchObject({
      imported: 0,
      duplicates: 2,
    });
  });
});

describe('modules', () => {
  test('without expenses the shifts import still works and the expenses kind is a 404', async () => {
    const off = harness({ expenses: false, receipts: false });
    try {
      const { cookie: c } = await off.signUp();
      await off.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie: c });
      const send = (path: string, csv: string) =>
        off.app.inject({
          method: 'POST',
          url: `/api/v1${path}`,
          payload: csv,
          headers: {
            'content-type': 'text/csv',
            cookie: c,
            origin: 'http://mw.test',
            host: 'mw.test',
          },
        });
      expect((await send('/imports/expenses/preview', EXPENSES)).statusCode).toBe(404);
      expect((await send('/imports/shifts', SHIFTS)).json().imported).toBe(2);
    } finally {
      await off.close();
    }
  });

  test('import off: no routes and the flag is false', async () => {
    const off = harness({ import: false });
    try {
      const { cookie: c } = await off.signUp();
      const r = await off.app.inject({
        method: 'POST',
        url: '/api/v1/imports/expenses/preview',
        payload: EXPENSES,
        headers: {
          'content-type': 'text/csv',
          cookie: c,
          origin: 'http://mw.test',
          host: 'mw.test',
        },
      });
      expect(r.statusCode).toBe(404);
      expect(
        (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules.import,
      ).toBe(false);
    } finally {
      await off.close();
    }
  });
});
