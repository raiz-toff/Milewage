// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

const summary = (over: object = {}) => ({
  from: '2023-11-13',
  to: '2023-11-19',
  shift_count: 2,
  hours: 8.4,
  earnings_cents: 21_550,
  tips_cents: 3_000,
  active_m: 21_000,
  deadhead_m: 9_000,
  personal_m: 0,
  total_m: 30_000,
  deduction_cents: 7_262,
  hourly_earnings_cents: 2_565,
  ...over,
});

const bucket = (start: string, cents: number | null) => ({
  start,
  shifts: 1,
  hours: 4.2,
  distance_m: 10_000,
  earnings_cents: cents,
  hourly_cents: null,
});

/** The dates on the shift cards, top to bottom. */
const cards = () =>
  within(screen.getByRole('list', { name: 'Shifts' }))
    .getAllByRole('link')
    .map((a) => a.querySelector('span')?.textContent);

function server(
  items: object[],
  extra: Record<string, Handler> = {},
  settings = settingsFixture(),
  url = '/shifts?week=2023-11-13',
) {
  return renderApp(
    {
      ...signedIn(settings),
      'GET /shifts': () => ({ body: { items, next_cursor: null } }),
      'GET /summary': () => ({ body: summary() }),
      'GET /analytics': () => ({
        body: {
          from: '2023-11-13',
          to: '2023-11-19',
          group: 'trends',
          data: {
            bucket: 'day',
            buckets: [bucket('2023-11-15', 9_000), bucket('2023-11-16', 12_550)],
          },
        },
      }),
      ...extra,
    },
    url,
  );
}

describe('shifts week view', () => {
  it('asks for the whole week and lists its shifts newest first, in the driver unit, with the split marked', async () => {
    const asked: string[] = [];
    server([shift(2), shift(1)], {
      'GET /shifts': ({ url }) => {
        asked.push(`${url.searchParams.get('from')}..${url.searchParams.get('to')}`);
        return { body: { items: [shift(1), shift(2)], next_cursor: null } };
      },
    });
    await screen.findByText('$215.50');
    expect(asked).toEqual(['2023-11-13..2023-11-19']);
    expect(cards()).toEqual(['Thursday, Nov 16', 'Wednesday, Nov 15']);
    expect(screen.getByText('20.0 km')).toBeTruthy();
    expect(screen.getByText(/^14\.0 km active/).textContent).toContain('*');
    expect(screen.getByText('* estimated from detected stops')).toBeTruthy();
    expect(screen.getByText('Nov 13 – 19, 2023')).toBeTruthy();
  });

  it('filters the list and the headline to one day when its bar is clicked, and back', async () => {
    server([shift(1), shift(2)]);
    await screen.findByText('$215.50');
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday: $90.00' }));
    expect(cards()).toEqual(['Wednesday, Nov 15']);
    expect(screen.getByText('$90.00')).toBeTruthy();
    expect(screen.getByText('Shifts on Wednesday')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday: $90.00' }));
    expect(cards()).toEqual(['Thursday, Nov 16', 'Wednesday, Nov 15']);
  });

  it('moves between weeks, and cannot go past the current week', async () => {
    const { calls } = server([], {}, settingsFixture());
    await screen.findByText(/No shifts this week/);
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await screen.findByText('Nov 6 – 12, 2023');
    expect(calls.some((c) => c.path === '/summary')).toBe(true);
    cleanup();
    server([], {}, settingsFixture(), '/shifts');
    await screen.findByText(/No shifts this week/);
    expect((screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: 'This week' })).toBeNull();
  });

  it('with no earnings the headline and bars are distance, and hourly earnings read "not entered"', async () => {
    server([shift(1), shift(2)], {
      'GET /summary': () => ({
        body: summary({ earnings_cents: null, tips_cents: null, hourly_earnings_cents: null }),
      }),
    });
    expect((await screen.findAllByText('30.0 km')).length).toBe(2); // headline and Distance
    expect(screen.getByText('not entered')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thursday: 20.0 km' })).toBeTruthy();
  });

  it('shows miles when the unit is miles', async () => {
    server([shift(1)], {}, settingsFixture({ distance_unit: 'mi' }));
    expect(await screen.findByText('6.2 mi')).toBeTruthy(); // 10,000 m
  });

  it('with stops off there is one business total and no split', async () => {
    server([shift(1)], {}, settingsFixture({ modules: { stops: false } }));
    await screen.findByText('10.0 km');
    expect(screen.queryByText(/km active/)).toBeNull();
    expect(screen.queryByText(/estimated from detected stops/)).toBeNull();
  });

  it('a whole-shift shift shows no estimated split', async () => {
    server([shift(1, { segmenter: 'whole_shift' })]);
    await screen.findByText('10.0 km');
    expect(screen.queryByText(/km active/)).toBeNull();
  });

  it('marks a shift in progress and one with flags to review', async () => {
    server([
      shift(1, { status: 'active', ended_at: null }),
      shift(2, { flags: [{ code: 'long_gap', severity: 'review' }] }),
    ]);
    expect(await screen.findByText('In progress')).toBeTruthy();
    expect(screen.getByText('1 to review')).toBeTruthy();
  });
});

describe('sort helper', () => {
  it('keeps empty values last in both directions', () => {
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
});

describe('shift detail', () => {
  it('heads the page with the date, times and vehicle, then the key figures', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /shifts/1': () => ({ body: shift(1, { total_m: 54_200, personal_m: 2_000 }) }),
        'GET /vehicles': () => ({ body: [{ id: 1, name: 'Corolla' }] }),
      },
      '/shifts/1',
    );
    await screen.findByRole('heading', { name: 'Wednesday, Nov 15, 2023' });
    expect(await screen.findByText(/^\d\d:\d\d – \d\d:\d\d · 4h 12m · Corolla$/)).toBeTruthy();
    const figure = (label: string) => screen.getByText(label).parentElement!.textContent;
    expect(figure('Distance')).toBe('Distance54.2 km2.0 km personal');
    expect(figure('Business')).toBe('Business10.0 km7.0 km active*3.0 km deadhead*');
    expect(figure('Time')).toBe('Time4h 12m');
    expect(figure('Deduction')).toBe('Deduction$36.31');
  });

  it('shows what the shift earned, and the platforms in the header', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /shifts/1': () => ({ body: shift(1) }),
        'GET /platforms': () => ({ body: [{ slug: 'doordash', label: 'DoorDash' }] }),
        'GET /shifts/1/earnings': () => ({
          body: {
            entries: [],
            labels: [],
            effective: [
              { platform: 'doordash', total_cents: 5350 },
              { platform: 'skip', total_cents: 1000 },
            ],
          },
        }),
      },
      '/shifts/1',
    );
    expect(await screen.findByText(/ · 4h 12m · DoorDash · skip$/)).toBeTruthy();
    expect(screen.getByText('Earned').parentElement!.textContent).toBe('Earned$63.50');
  });

  it('earned reads "not entered" with nothing entered, and is absent with earnings off', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /shifts/1': () => ({ body: shift(1) }),
        'GET /shifts/1/earnings': () => ({ body: { entries: [], labels: [], effective: [] } }),
      },
      '/shifts/1',
    );
    const earned = await screen.findByText('Earned');
    await waitFor(() => expect(earned.parentElement!.textContent).toBe('Earnednot entered'));
    cleanup();
    renderApp(
      {
        ...signedIn(settingsFixture({ modules: { earnings: false } })),
        'GET /shifts/1': () => ({ body: shift(1) }),
      },
      '/shifts/1',
    );
    await screen.findByText('Business');
    expect(screen.queryByText('Earned')).toBeNull();
  });

  it('lists checks in plain words, review ones first, and counts them in the header', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /shifts/1': () => ({
          body: shift(1, {
            recon_status: 'differs',
            flags: [
              { code: 'long_stop', severity: 'info' },
              { code: 'gap_large', severity: 'review' },
              { code: 'new_flag', severity: 'info' },
            ],
          }),
        }),
        'GET /shifts/2': () => ({ body: shift(2) }),
      },
      '/shifts/1',
    );
    const checks = await screen.findByRole('region', { name: 'Checks' });
    expect(
      within(checks)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'A long signal gap: some distance may be missing.Review',
      'A stop of 30 minutes or more.',
      'new_flag',
      'The phone and the server worked out different totals.',
    ]);
    expect(screen.getByRole('link', { name: '1 to review' }).getAttribute('href')).toBe('#checks');
    cleanup();
    renderApp({ ...signedIn(), 'GET /shifts/2': () => ({ body: shift(2) }) }, '/shifts/2');
    expect(await screen.findByText('Nothing to check.')).toBeTruthy();
  });

  it('a missing deduction reads "not available", never zero', async () => {
    renderApp(
      { ...signedIn(), 'GET /shifts/1': () => ({ body: shift(1, { deduction_cents: null }) }) },
      '/shifts/1',
    );
    expect(await screen.findByText('not available')).toBeTruthy();
  });

  it('a deduction at the driver\'s own rate is labelled "your rate", never plain', async () => {
    const yours = settingsFixture({ mileage_rate: 'yours' });
    renderApp({ ...signedIn(yours), 'GET /shifts/1': () => ({ body: shift(1) }) }, '/shifts/1');
    expect(await screen.findByText('Deduction (your rate)')).toBeTruthy();
    expect(screen.queryByText('Deduction')).toBeNull();
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
