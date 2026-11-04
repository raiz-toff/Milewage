// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvCell, toCsv } from '../src/ui/SortTable';
import { renderApp, signedIn } from './support/kit';

afterEach(cleanup);

const shift = (id: number, over: object = {}) => ({
  id,
  client_id: `00000000-0000-4000-8000-00000000000${id}`,
  vehicle_id: 1,
  status: 'ended',
  segmenter: 'stops',
  started_at: 1_700_000_000_000 + id * 86_400_000,
  ended_at: 1_700_000_000_000 + id * 86_400_000 + 3_600_000,
  local_date: `2023-11-${14 + id}`,
  total_m: id * 10_000,
  active_m: id * 6_000,
  deadhead_m: id * 4_000,
  personal_m: 0,
  calc_version: 3,
  calculated_at: 1,
  notes: null,
  deduction_cents: null,
  flags: [],
  ...over,
});

function open() {
  return renderApp(
    {
      ...signedIn(),
      'GET /shifts': () => ({ body: { items: [shift(1), shift(2), shift(3)], next_cursor: null } }),
      'GET /shifts/3': () => ({ body: shift(3) }),
    },
    '/shifts',
  );
}

const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('keyboard navigation', () => {
  it('only the first row is in the tab order; arrows, Home and End move focus', async () => {
    open();
    await screen.findByRole('table');
    const rows = bodyRows(); // newest first: id 3, 2, 1
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'End' });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2]!, { key: 'ArrowDown' }); // stays on the last row
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('Enter opens the focused row', async () => {
    open();
    await screen.findByRole('table');
    const first = bodyRows()[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: /2023-11-17/ })).toBeTruthy();
  });

  it('column headers sort from the keyboard (they are buttons)', async () => {
    open();
    await screen.findByRole('table');
    const header = screen.getByRole('button', { name: 'Total' });
    header.focus();
    fireEvent.click(header); // Enter and Space on a button produce a click
    const dates = () =>
      within(screen.getByRole('table'))
        .getAllByRole('link')
        .map((a) => a.textContent);
    expect(dates()).toEqual(['2023-11-15', '2023-11-16', '2023-11-17']);
  });
});

describe('CSV copy', () => {
  it('copies the sorted rows as text, with the estimate named in the header', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Copy CSV' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Copied 3 rows as CSV.'),
    );
    expect(writeText).toHaveBeenCalledWith(
      [
        'Date,Duration,Total,Active (estimated),Deadhead (estimated),Flags,Status',
        '2023-11-17,1h 00m,30.0 km,18.0 km,12.0 km,0,ended',
        '2023-11-16,1h 00m,20.0 km,12.0 km,8.0 km,0,ended',
        '2023-11-15,1h 00m,10.0 km,6.0 km,4.0 km,0,ended',
        '',
      ].join('\r\n'),
    );
  });

  it('says so when the browser refuses the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    open();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Copy CSV' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Copy was blocked by the browser.',
    );
  });

  it('quotes commas, quotes and newlines, and defuses spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5')).toBe('-5'); // a number, not a formula
    expect(toCsv([{ key: 'a', label: 'A', sortValue: () => null, render: () => null }], [1])).toBe(
      'A\r\n\r\n',
    );
  });
});
