// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { sortRows } from '../src/ui/SortTable';
import type { Column } from '../src/ui/SortTable';
import { renderApp, settingsFixture, signedIn } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const HOUR = 3_600_000;
const shift = (id: number, over: object = {}) => ({
  id,
  client_id: `00000000-0000-4000-8000-00000000000${id}`,
  vehicle_id: 1,
  status: 'ended',
  segmenter: 'stops',
  started_at: 1_700_000_000_000 + id * 24 * HOUR,
  ended_at: 1_700_000_000_000 + id * 24 * HOUR + 4 * HOUR + 12 * 60_000,
  local_date: `2023-11-${14 + id}`,
  total_m: id * 10_000,
  active_m: id * 7_000,
  deadhead_m: id * 3_000,
  personal_m: 0,
  calc_version: 3,
  calculated_at: 1,
  notes: null,
  deduction_cents: 3631,
  flags: [],
  ...over,
});

const dates = () =>
  within(screen.getByRole('table'))
    .getAllByRole('link')
    .map((a) => a.textContent);

function server(
  items: object[],
  extra: Record<string, Handler> = {},
  settings = settingsFixture(),
) {
  return renderApp(
    {
      ...signedIn(settings),
      'GET /shifts': ({ url }) => {
        const status = url.searchParams.get('status');
        return {
          body: {
            items: status
              ? items.filter((s) => (s as { status: string }).status === status)
              : items,
            next_cursor: null,
          },
        };
      },
      ...extra,
    },
    '/shifts',
  );
}

describe('shifts list', () => {
  it('lists shifts newest first with distances in the driver unit and a marked split', async () => {
    server([shift(1), shift(2)]);
    await screen.findByRole('table');
    expect(dates()).toEqual(['2023-11-16', '2023-11-15']);
    expect(screen.getByText('20.0 km')).toBeTruthy();
    expect(screen.getByText('14.0 km')).toBeTruthy(); // active, estimated
    expect(screen.getByRole('columnheader', { name: 'Active*' })).toBeTruthy();
    expect(screen.getByText('* estimated from detected stops')).toBeTruthy();
    expect(screen.getAllByText('4h 12m').length).toBe(2);
  });

  it('sorts by a column and flips direction on a second click', async () => {
    server([shift(1), shift(3), shift(2)]);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Total' }));
    expect(dates()).toEqual(['2023-11-15', '2023-11-16', '2023-11-17']);
    expect(screen.getByRole('columnheader', { name: 'Total' }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Total' }));
    expect(dates()).toEqual(['2023-11-17', '2023-11-16', '2023-11-15']);
  });

  it('keeps empty values last in both directions and shows a dash, not zero', () => {
    const col: Column<{ v: number | null }> = {
      key: 'v',
      label: 'V',
      sortValue: (r) => r.v,
      render: () => null,
    };
    const rows = [{ v: null }, { v: 2 }, { v: 1 }];
    expect(sortRows(rows, col, 'asc').map((r) => r.v)).toEqual([1, 2, null]);
    expect(sortRows(rows, col, 'desc').map((r) => r.v)).toEqual([2, 1, null]);
  });

  it('shows miles when the unit is miles', async () => {
    server([shift(1)], {}, settingsFixture({ distance_unit: 'mi' }));
    await screen.findByRole('table');
    expect(screen.getByText('6.2 mi')).toBeTruthy(); // 10,000 m
  });

  it('with stops off there is one business total and no split columns', async () => {
    server([shift(1)], {}, settingsFixture({ modules: { stops: false } }));
    await screen.findByRole('table');
    expect(screen.queryByRole('columnheader', { name: 'Active*' })).toBeNull();
    expect(screen.queryByText(/estimated from detected stops/)).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeTruthy();
  });

  it('a whole-shift shift shows a dash in the split columns, not a number', async () => {
    server([shift(1, { segmenter: 'whole_shift', active_m: 10_000, deadhead_m: 0 })]);
    await screen.findByRole('table');
    const row = screen.getAllByRole('row')[1]!;
    expect(within(row).getAllByText('—').length).toBe(2);
  });

  it('filters by status through the server and says when there is nothing', async () => {
    const { calls } = server([shift(1)]);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: 'active' } });
    expect(await screen.findByText(/No shifts yet/)).toBeTruthy();
    expect(calls.filter((c) => c.path === '/shifts').length).toBe(2);
  });
});

describe('shift detail', () => {
  it('shows totals with the estimate marked and the total not', async () => {
    renderApp(
      { ...signedIn(), 'GET /shifts/1': () => ({ body: shift(1, { total_m: 54_200 }) }) },
      '/shifts/1',
    );
    await screen.findByRole('heading', { name: /2023-11-15/ });
    expect(screen.getByText('54.2 km').textContent).not.toContain('*');
    const active = screen.getByText('Active').parentElement!;
    expect(active.textContent).toContain('*');
    expect(screen.getByText('$36.31')).toBeTruthy();
  });

  it('shows review flags and an empty flag list', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /shifts/1': () => ({
          body: shift(1, { flags: [{ code: 'long_gap', severity: 'review' }] }),
        }),
        'GET /shifts/2': () => ({ body: shift(2) }),
      },
      '/shifts/1',
    );
    const flags = await screen.findByRole('region', { name: 'Flags' });
    expect(within(flags).getByText('long_gap')).toBeTruthy();
    cleanup();
    renderApp({ ...signedIn(), 'GET /shifts/2': () => ({ body: shift(2) }) }, '/shifts/2');
    expect(await screen.findByText('None.')).toBeTruthy();
  });

  it('a missing deduction reads "not available", never zero', async () => {
    renderApp(
      { ...signedIn(), 'GET /shifts/1': () => ({ body: shift(1, { deduction_cents: null }) }) },
      '/shifts/1',
    );
    expect(await screen.findByText('not available')).toBeTruthy();
  });

  it('saves notes and reads them back', async () => {
    const { calls } = renderApp(
      {
        ...signedIn(),
        'GET /shifts/1': () => ({ body: shift(1) }),
        'PATCH /shifts/1': ({ body }) => ({
          body: shift(1, { notes: (body as { notes: string }).notes }),
        }),
      },
      '/shifts/1',
    );
    const box = await screen.findByLabelText('Notes');
    fireEvent.change(box, { target: { value: 'Rain, slow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    expect((await screen.findByRole('status')).textContent).toBe('Saved.');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ notes: 'Rain, slow' });
  });

  it('shows an unknown shift as an error', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /shifts/9': () => ({
          status: 404,
          body: { code: 'shift_not_found', detail: 'No such shift.' },
        }),
      },
      '/shifts/9',
    );
    expect((await screen.findByRole('alert')).textContent).toBe('No such shift.');
  });
});
