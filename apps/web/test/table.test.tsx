// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SortTable, csvCell, toCsv } from '../src/ui/SortTable';
import type { Column } from '../src/ui/SortTable';

afterEach(cleanup);

interface Row {
  id: number;
  date: string;
  total: number;
  active: number;
}

const ROWS: Row[] = [
  { id: 3, date: '2023-11-17', total: 30, active: 18 },
  { id: 2, date: '2023-11-16', total: 20, active: 12 },
  { id: 1, date: '2023-11-15', total: 10, active: 6 },
];

/** The table on its own: a date that opens the row, a total, and an estimated column. */
function open(onOpen: (id: number) => void = () => {}) {
  const columns: Column<Row>[] = [
    {
      key: 'date',
      label: 'Date',
      sortValue: (r) => r.date,
      text: (r) => r.date,
      render: (r) => (
        <button type="button" onClick={() => onOpen(r.id)}>
          {r.date}
        </button>
      ),
    },
    {
      key: 'total',
      label: 'Total',
      numeric: true,
      sortValue: (r) => r.total,
      text: (r) => `${r.total.toFixed(1)} km`,
      render: (r) => `${r.total.toFixed(1)} km`,
    },
    {
      key: 'active',
      label: 'Active*',
      numeric: true,
      sortValue: (r) => r.active,
      text: (r) => `${r.active.toFixed(1)} km`,
      render: (r) => `${r.active.toFixed(1)} km`,
    },
  ];
  return render(<SortTable caption="Rows" columns={columns} rows={ROWS} rowKey={(r) => r.id} />);
}

const bodyRows = () => screen.getAllByRole('row').slice(1);
const dates = () =>
  within(screen.getByRole('table'))
    .getAllByRole('button')
    .filter((b) => /^\d{4}-/.test(b.textContent ?? ''))
    .map((b) => b.textContent);

describe('keyboard navigation', () => {
  it('only the first row is in the tab order; arrows, Home and End move focus', async () => {
    open();
    const rows = bodyRows(); // given order: id 3, 2, 1
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

  it('Enter opens the focused row', () => {
    const opened = vi.fn();
    open(opened);
    const first = bodyRows()[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(opened).toHaveBeenCalledWith(3);
  });

  it('column headers sort from the keyboard (they are buttons)', async () => {
    open();
    const header = screen.getByRole('button', { name: 'Total' });
    header.focus();
    fireEvent.click(header); // Enter and Space on a button produce a click
    expect(dates()).toEqual(['2023-11-15', '2023-11-16', '2023-11-17']);
    fireEvent.click(header);
    expect(dates()).toEqual(['2023-11-17', '2023-11-16', '2023-11-15']);
  });
});

describe('CSV copy', () => {
  it('copies the sorted rows as text, with the estimate named in the header', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copy CSV' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Copied 3 rows as CSV.'),
    );
    expect(writeText).toHaveBeenCalledWith(
      [
        'Date,Total,Active (estimated)',
        '2023-11-17,30.0 km,18.0 km',
        '2023-11-16,20.0 km,12.0 km',
        '2023-11-15,10.0 km,6.0 km',
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
