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
});

function open(modules: object = {}) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { import: true, ...modules } })),
      'POST /imports/expenses/preview': () => ({ body: preview() }),
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
