// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn, pick, optionsOf } from './support/kit';

afterEach(cleanup);

const preview = (ok = 2) => ({
  kind: 'expenses',
  columns: ['Date', 'Vendor', 'Amount'],
  fields: ['spent_on', 'merchant', 'amount'],
  mapping: { spent_on: 'Date', merchant: 'Vendor', amount: 'Amount' },
  row_count: 3,
  summary: { ok, duplicate: 0, error: 3 - ok },
  rows: [{ row: 3, status: 'error', message: 'amount is not a positive amount' }],
  problems: [{ row: 3, message: 'amount is not a positive amount' }],
});
/** A preview of `rows` rows where `errors` have a problem and the server lists `listed` of them. */
const many = (rows: number, errors: number, listed = errors) => ({
  ...preview(),
  row_count: rows,
  summary: { ok: rows - errors, duplicate: 0, error: errors },
  rows: [],
  problems: Array.from({ length: listed }, (_, i) => ({
    row: 201 + i,
    message: 'date is not YYYY-MM-DD',
  })),
});

function open(modules: object = {}, body: object = preview()) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { import: true, ...modules } })),
      'POST /imports/expenses/preview': () => ({ body }),
      'POST /imports/expenses': () => ({
        body: { kind: 'expenses', imported: 2, duplicates: 0, errors: 1, error_rows: [] },
      }),
    },
    '/settings/import',
  );
}
const file = () =>
  new File(['Date,Vendor,Amount\n2026-01-01,Shell,5'], 'x.csv', { type: 'text/csv' });
const choose = async () => {
  const input = (await screen.findByLabelText('CSV file')) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file()] } });
};

describe('import card (module import)', () => {
  it('previews first and writes only after the driver confirms, with the mapping they see', async () => {
    const s = open();
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: /Preview x\.csv/ }));
    expect(
      await screen.findByText(/3 rows: 2 ready, 0 already there, 1 with problems/),
    ).toBeTruthy();
    expect(screen.getByText('Row 3: amount is not a positive amount')).toBeTruthy();
    expect(s.calls.some((c) => c.path === '/imports/expenses')).toBe(false); // nothing written yet
    // The preview went as the raw CSV (after it, the shown reads are asked again).
    const preview = s.calls.find((c) => c.path === '/imports/expenses/preview');
    expect(preview?.contentType).toBe('text/csv');
    pick(screen.getByLabelText('Column for merchant'), 'Date');
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 rows' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Imported 2 rows/);
    const commit = s.calls.find((c) => c.method === 'POST' && c.path === '/imports/expenses');
    expect(commit?.body).toContain('Date,Vendor,Amount');
  });

  it('lists the first 10 problems and every one on Show all problems, even past row 200', async () => {
    open({}, many(400, 15));
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: /Preview x\.csv/ }));
    expect(
      await screen.findByText(/400 rows: 385 ready, 0 already there, 15 with problems/),
    ).toBeTruthy();
    const listed = () => screen.queryAllByText(/^Row \d+: date/).length;
    expect(listed()).toBe(10);
    const toggle = screen.getByRole('button', { name: 'Show all problems' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(listed()).toBe(15);
    expect(screen.getByText('Row 215: date is not YYYY-MM-DD')).toBeTruthy();
    expect(screen.queryByText(/not listed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(listed()).toBe(10);
  });

  it('says how many problems the server did not list', async () => {
    open({}, many(5000, 1200, 1000));
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: /Preview x\.csv/ }));
    await screen.findByText(/1200 with problems/);
    expect(screen.queryByText(/not listed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all problems' }));
    expect(screen.queryAllByText(/^Row \d+: date/)).toHaveLength(1000);
    expect(screen.getByText(/And 200 more rows with problems, not listed/)).toBeTruthy();
  });

  it('has no toggle when every problem is shown', async () => {
    open();
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: /Preview x\.csv/ }));
    await screen.findByText('Row 3: amount is not a positive amount');
    expect(screen.queryByRole('button', { name: 'Show all problems' })).toBeNull();
  });

  it('shows the server message when the file is refused', async () => {
    renderApp(
      {
        ...signedIn(settingsFixture({ modules: { import: true } })),
        'POST /imports/expenses/preview': () => ({
          status: 422,
          body: { code: 'validation_failed', detail: 'the file needs a header row' },
        }),
      },
      '/settings/import',
    );
    await choose();
    fireEvent.click(await screen.findByRole('button', { name: /Preview/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/header row/);
  });

  it('offers only shifts and MileIQ drives when the expenses module is off, and nothing when import is off', async () => {
    open({ expenses: false });
    expect(optionsOf(await screen.findByLabelText('What is in the file'))).toEqual([
      'shifts',
      'mileiq',
    ]);
    cleanup();
    const s = open({ import: false });
    // The old address opens Your data, which still leads to backups and exports.
    await screen.findByRole('heading', { level: 2, name: 'Your data' });
    const sections = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(sections).queryByRole('link', { name: 'Import' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Import' })).toBeNull();
    await waitFor(() => expect(s.calls.some((c) => c.path.startsWith('/imports'))).toBe(false));
  });
});

describe('MileIQ preset', () => {
  const mileiq = (over: object = {}) => ({
    drive_count: 4,
    summary: { ok: 3, duplicate: 0, error: 1, skipped: 0 },
    classes: { business: 2, personal: 0, other: 0, unclassified: 1 },
    distance_m: { business: 31_221, personal: 3862 },
    unit: 'mi',
    date_order: 'mdy',
    date_order_source: 'file',
    unclassified: 'personal',
    value_ignored: true,
    vehicles: [{ name: 'Blue Corolla', drives: 3, vehicle_id: 1, matched: false }],
    costs: { parking_cents: 550, tolls_cents: 225, expenses: 2, left_out: 0 },
    rows: [
      {
        line: 12,
        status: 'ok',
        message: null,
        class: 'business',
        started_at: 1_791_482_400_000,
        distance_m: 31_221,
        purpose: 'Deliveries',
      },
    ],
    problems: [{ line: 19, message: 'the distance "abc" is not a number' }],
    ...over,
  });
  function openMileIq() {
    return renderApp(
      {
        ...signedIn(settingsFixture({ modules: { import: true } })),
        'GET /vehicles': () => ({ body: [{ id: 1, name: 'Civic', kind: 'car', archived: false }] }),
        'POST /imports/mileiq/preview': ({ url }) => ({
          body: mileiq(
            url.searchParams.get('unclassified') === 'skip'
              ? { unclassified: 'skip', summary: { ok: 2, duplicate: 0, error: 1, skipped: 1 } }
              : {},
          ),
        }),
        'POST /imports/mileiq': () => ({
          body: { imported: 2, duplicates: 0, errors: 1, skipped: 1, expenses: 2 },
        }),
      },
      '/settings/import',
    );
  }

  it('previews what each kind of drive becomes, then imports with the choices shown', async () => {
    const s = openMileIq();
    pick(await screen.findByLabelText('What is in the file'), 'mileiq');
    const input = (await screen.findByLabelText('MileIQ report (CSV)')) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['START_DATE*,MILES*\n'], 'drives.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Preview drives\.csv/ }));
    expect(
      await screen.findByText(/4 drives: 3 ready, 0 already imported, 1 with problems/),
    ).toBeTruthy();
    expect(screen.getByText(/They count as business distance/)).toBeTruthy();
    expect(screen.getByText(/never in your deduction/)).toBeTruthy();
    expect(screen.getByText(/value column is not imported/)).toBeTruthy();
    expect(
      screen.getByText(/Blue Corolla \(3 drives\): to your Civic, your default vehicle/),
    ).toBeTruthy();
    expect(screen.getByText(/become 2 expenses on their shifts/)).toBeTruthy();
    expect(screen.getByText('Line 19: the distance "abc" is not a number')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'First drives in the file' })).toBeTruthy();
    // Leaving unclassified drives out asks the server again with that choice.
    fireEvent.click(screen.getByRole('button', { name: 'Leave out' }));
    expect(
      await screen.findByText(/2 ready, 0 already imported, 1 with problems, 1 left out/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 drives' }));
    expect((await screen.findByRole('status')).textContent).toMatch(
      /Imported 2 drives as shifts.*Added 2 parking or toll expenses/,
    );
    const commit = s.calls.find((c) => c.path === '/imports/mileiq');
    expect(commit?.query).toContain('unclassified=skip');
    expect(commit?.contentType).toBe('text/csv');
  });
});
