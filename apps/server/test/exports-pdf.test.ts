import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { harness, type Harness } from './support';

// The mileage and expenses report for an accountant (DECISIONS.md, 2026-11-10). Text is read back with unpdf
// (pdf.js), a test-only dependency, so the assertions are on what a reader of the file sees.
let h: Harness;
let cookie: string;
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });

let n = 0;
/** An ended shift on a day, with business and personal metres, a note and flags. */
function seedShift(
  date: string,
  o: {
    totalM?: number;
    personalM?: number;
    notes?: string;
    vehicle?: number;
    flags?: string[];
  } = {},
) {
  n += 1;
  const start = Date.parse(`${date}T14:00:00Z`);
  const id = Number(
    h.db
      .prepare(
        `INSERT INTO shifts (user_id, client_id, vehicle_id, status, started_at, ended_at, local_date,
           total_m, personal_m, segmenter, notes, updated_at)
         VALUES (1, ?, ?, 'ended', ?, ?, ?, ?, ?, 'stops', ?, 1)`,
      )
      .run(
        `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        o.vehicle ?? 1,
        start,
        start + 4 * 3_600_000,
        date,
        o.totalM ?? 50_000,
        o.personalM ?? 0,
        o.notes ?? null,
      ).lastInsertRowid,
  );
  for (const code of o.flags ?? []) {
    h.db
      .prepare(
        "INSERT INTO shift_flags (user_id, shift_id, code, severity, created_at) VALUES (1, ?, ?, 'info', 1)",
      )
      .run(id, code);
  }
  return id;
}

async function pdfOf(url: string) {
  const res = await web('GET', url);
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  const bytes = new Uint8Array(res.rawPayload);
  // MILEWAGE_PDF_SAMPLE=/some/dir keeps each file made here, to look at by eye.
  const keep = process.env.MILEWAGE_PDF_SAMPLE;
  if (keep)
    writeFileSync(
      `${keep}/report-${expect.getState().currentTestName?.slice(17, 40).replace(/\W+/g, '-')}.pdf`,
      bytes,
    );
  // pdf.js takes the buffer it is given; keep ours readable.
  const doc = await getDocumentProxy(bytes.slice());
  const { totalPages, text } = await extractText(doc, { mergePages: false });
  const first = await doc.getPage(1);
  const [, , w, hgt] = first.view;
  return {
    res,
    bytes,
    pages: totalPages,
    text,
    all: text.join('\n').replace(/\s+/g, ' '),
    size: [Math.round(w!), Math.round(hgt!)],
    meta: await getMeta(doc),
  };
}

const cad = (minor: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(minor / 100);

beforeEach(async () => {
  n = 0;
  h = harness();
  ({ cookie } = await h.signUp());
  await web('PATCH', '/settings', {
    country: 'CA',
    region: 'ON',
    distance_unit: 'km',
    currency: 'CAD',
    display_name: 'Zoë Łódź-Øster',
  });
  await web('POST', '/vehicles', { name: 'Civic', kind: 'car' });
  // 2026: 40 km (10 personal), 120 km, and one in 2025 that is outside the period.
  seedShift('2026-03-01', { totalM: 40_000, personalM: 10_000, flags: ['gap_counted'] });
  seedShift('2026-03-02', { totalM: 120_000, notes: 'Airport run' });
  seedShift('2025-12-31', { totalM: 7_000 });
  const exp = (b: object) =>
    web('POST', '/expenses', { spent_on: '2026-04-01', amount_cents: 1000, ...b });
  await exp({ category: 'phone', amount_cents: 10_000, merchant: 'Télécom €' });
  await exp({ category: 'fuel', amount_cents: 5000, vehicle_id: 1 });
  await exp({ category: 'parking', amount_cents: 650, vehicle_id: 1, shift_id: 1 });
});
afterEach(() => h.close());

describe('GET /exports/pdf', () => {
  test('a tagged, titled PDF with the cover, the summary, the log and the notices', async () => {
    const { res, bytes, all, meta, size } = await pdfOf('/exports/pdf?year=2026');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('milewage-pdf-2026.pdf');
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(meta.info).toMatchObject({ Language: 'en', Author: 'Zoë Łódź-Øster' });
    expect(String((meta.info as { Title: string }).Title)).toMatch(/^Mileage and expenses report/);
    expect(Buffer.from(bytes).toString('latin1')).toContain('/MarkInfo');
    expect(size).toEqual([612, 792]); // Canada prints on US Letter (CLDR)
    for (const want of [
      'Mileage and expenses report',
      'Zoë Łódź-Øster',
      'Jan 1, 2026 to Dec 31, 2026',
      'Canada',
      'MileWage 0.',
      'Total distance 160.0 km',
      'Business distance 150.0 km',
      'Personal distance 10.0 km',
      'Unverified rates',
      'not tax advice',
      'Country rate: First 5,000 km',
      'Airport run',
      'distance estimated across a signal gap',
      'Télécom €',
      'covered by the mileage rate',
      'Page 1 of',
    ]) {
      expect(all, want).toContain(want);
    }
    expect(all).not.toContain('Dec 31, 2025'); // the 2025 shift is outside the period
  });

  test('its totals are the tax summary and the CSV figures for the same period', async () => {
    const tax = (await web('GET', '/exports/tax_summary?year=2026&format=json')).json();
    const { all } = await pdfOf('/exports/pdf?year=2026');
    expect(all).toContain(
      `Mileage deduction ${cad(tax.deductions.mileage_cents)} Rate used The country rate`,
    );
    expect(all).toContain(`Deductible expenses ${cad(tax.deductions.expenses_cents)}`);
    const csv = (await web('GET', '/exports/csv?from=2026-01-01&to=2026-12-31&level=shift')).body
      .split('\r\n')
      .filter(Boolean);
    const head = csv[0]!.split(',');
    const col = (name: string) => csv.slice(1).map((r) => r.split(',')[head.indexOf(name)]!);
    const csvDeduction = col('Deduction_Value').reduce(
      (a, v) => a + Math.round(Number(v) * 100),
      0,
    );
    expect(csvDeduction).toBe(tax.deductions.mileage_cents);
    for (const v of col('Deduction_Value')) expect(all).toContain(cad(Math.round(Number(v) * 100)));
    const expenses = (await web('GET', '/expenses/totals?year=2026')).json();
    expect(expenses.deductible_cents).toBe(tax.deductions.expenses_cents);
    expect(all).toContain(`Expenses ${cad(expenses.total_cents)}`);
  });

  test('a long log runs onto more pages, each with the column headers and a page number', async () => {
    for (let d = 0; d < 160; d++) {
      const day = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
      seedShift(day, {
        totalM: 20_000 + d,
        notes: d % 7 === 0 ? 'A longer note to wrap the cell' : undefined,
      });
    }
    const { pages, text } = await pdfOf('/exports/pdf?from=2026-01-01&to=2026-12-31');
    expect(pages).toBeGreaterThan(3);
    // Pages with a shift of a day that has no expense: log pages only.
    const logPages = text.filter((t) => /(Jan 5|Feb 9|Mar 30|May 20|Jun 8), 2026/.test(t));
    expect(logPages.length).toBeGreaterThan(1);
    for (const t of logPages)
      expect(t.replace(/\s+/g, ' ')).toMatch(/Date Time Vehicle Platform Business \(km\)/);
    text.forEach((t, i) => expect(t).toContain(`Page ${i + 1} of ${pages}`));
  });

  test('paper: A4 outside the Letter countries, and the query wins', async () => {
    expect((await pdfOf('/exports/pdf?year=2026&paper=a4')).size).toEqual([595, 842]);
    await web('PATCH', '/settings', { country: 'GB', currency: 'GBP', distance_unit: 'mi' });
    expect((await pdfOf('/exports/pdf?year=2026')).size).toEqual([595, 842]);
    expect((await pdfOf('/exports/pdf?year=2026&paper=letter')).size).toEqual([612, 792]);
  });

  test('your mileage rate is named as yours, never official', async () => {
    await web('PATCH', '/settings', { use_own_mileage_rate: true });
    await web('POST', '/own-mileage-rates', {
      effective_from: '2026-03-02',
      cents_per_unit: 72.5,
      unit: 'km',
      note: 'Employer',
    });
    const { all } = await pdfOf('/exports/pdf?year=2026');
    expect(all).toContain('Your mileage rate is a figure you entered. It is not an official rate.');
    expect(all).toContain('Your mileage rate Entered by you, not an official rate');
    expect(all).toContain('$0.725 per km');
    expect(all).toContain(`${cad(8700)} your rate`); // 120 km at 72.5 cents on 2 March
    expect(all).toContain(
      'Rate used The country rate before Mar 2, 2026, then your mileage rate (not an official rate)',
    );
  });

  test('a period is checked, a vehicle narrows it, and switched-off modules leave their parts out', async () => {
    expect((await web('GET', '/exports/pdf?from=2026-01-01&to=2027-06-01')).statusCode).toBe(422);
    expect((await web('GET', '/exports/pdf?from=2026-02-01')).statusCode).toBe(422);
    expect((await web('GET', '/exports/pdf?paper=a3')).statusCode).toBe(422);
    await web('POST', '/vehicles', { name: 'Vespa', kind: 'scooter' });
    seedShift('2026-05-05', { vehicle: 2, totalM: 9_000 });
    const only = (await pdfOf('/exports/pdf?year=2026&vehicle_id=2')).all;
    expect(only).toContain('Vespa only');
    expect(only).toContain('Total distance 9.0 km');

    const off = harness({
      expenses: false,
      receipts: false,
      import: false,
      earnings: false,
    });
    try {
      const a = await off.signUp();
      const res = await off.call('GET', '/exports/pdf', undefined, { cookie: a.cookie });
      expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
      const pdf = await getDocumentProxy(new Uint8Array(res.rawPayload).slice());
      const { text } = await extractText(pdf, {
        mergePages: true,
      });
      expect(text).toContain('No ended shifts in this period.');
      expect(text).not.toContain('Expenses by category');
      expect(text).not.toContain('Earnings after app fees');
    } finally {
      off.close();
    }
  });
});
