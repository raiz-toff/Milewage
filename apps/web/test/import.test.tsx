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
    expect(s.calls[s.calls.length - 1]?.contentType).toBe('text/csv');
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

  it('offers only shifts when the expenses module is off, and nothing when import is off', async () => {
    open({ expenses: false });
    expect(optionsOf(await screen.findByLabelText('What is in the file'))).toEqual(['shifts']);
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
