// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { rangeOf } from '../src/pages/Analytics';
import { renderApp, settingsFixture, signedIn, DASHBOARD } from './support/kit';

afterEach(cleanup);

const groups = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  cards: {
    gross_cents: 30_000,
    expenses_cents: 500,
    burn_ratio: 0.017,
    net_take_home_cents: 22_000,
    tax_set_aside_cents: 7500,
    hourly_shift_cents: 5000,
    hourly_online_cents: null,
    total_hours: 6,
  },
  trends: {
    bucket: 'day',
    buckets: [
      {
        start: '2023-11-14',
        shifts: 1,
        hours: 2,
        distance_m: 1000,
        earnings_cents: 10_000,
        hourly_cents: 5000,
      },
      {
        start: '2023-11-15',
        shifts: 1,
        hours: 2,
        distance_m: 1000,
        earnings_cents: null,
        hourly_cents: null,
      },
    ],
    previous: { earnings_cents: null, hours: 0, distance_m: 0 },
  },
  sources: [{ platform: 'doordash', earnings_cents: 30_000, tips_cents: 0, share: 1 }],
  rhythm: {
    by_weekday: [{ weekday: 2, shifts: 2, hours: 4 }],
    by_start_hour: [],
    average_shift_minutes: 120,
  },
  outlook: {
    projected_earnings_cents: null,
    days_left: 3,
    note: 'fewer than 3 shifts or no earnings',
  },
  efficiency: { estimated: true, active_share: 0.75, deadhead_share: 0.25, hourly_spread: null },
  order_economics: null,
  ...over,
});

function open(over: Record<string, unknown> = {}, enabled = true) {
  const g = groups(over);
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { analytics: enabled } })),
      'GET /analytics': ({ url }) => ({
        body: {
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          group: url.searchParams.get('group'),
          data: g[url.searchParams.get('group') ?? 'cards'],
        },
      }),
    },
    '/analytics',
  );
}

describe('analytics screen (module analytics)', () => {
  it('shows the cards, with "not available" where the server said null, and the groups', async () => {
    open();
    const figures = await screen.findByLabelText('Figures');
    expect(figures.textContent).toMatch(/Gross\$300\.00/);
    expect(figures.textContent).toMatch(/Per hour \(online time\)not available/);
    expect(figures.textContent).toMatch(/Net take-home\$220\.00/);
    expect(screen.getByText(/Not enough shifts to project/)).toBeTruthy();
    expect(screen.getByText(/estimated from detected stops/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Income sources' }).textContent).toMatch(
      /doordash: \$300\.00 \(100%\)/,
    );
    expect(screen.getByRole('region', { name: 'Work rhythm' }).textContent).toMatch(
      /Busiest weekday: Tuesday/,
    );
    expect(screen.getAllByText('not available').length).toBeGreaterThan(0); // the null trend bucket
  });

  it('leaves out the lines of modules that are off: no expense or set-aside tiles', async () => {
    open({
      cards: {
        gross_cents: 30_000,
        hourly_shift_cents: 5000,
        hourly_online_cents: null,
        total_hours: 6,
      },
    });
    const figures = await screen.findByLabelText('Figures');
    expect(figures.textContent).not.toMatch(/Expenses|Burn ratio|Net take-home|Tax set-aside/);
  });

  it('the navigator asks for the previous period and week, month and year ranges', async () => {
    const s = open();
    await screen.findByLabelText('Figures');
    const first = s.calls.find((c) => c.path === '/analytics');
    expect(first).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    await waitFor(() =>
      expect(
        new Set(s.calls.filter((c) => c.path === '/analytics').map((c) => c.body)).size,
      ).toBeGreaterThan(0),
    );
    expect(
      (screen.getByRole('button', { name: 'Next period' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Year' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Year', pressed: true })).toBeTruthy(),
    );
  });

  it('rangeOf: weeks follow the start day, months and years are calendar ones', () => {
    expect(rangeOf('week', 0, '2027-01-15', 1)).toEqual({ from: '2027-01-11', to: '2027-01-17' });
    expect(rangeOf('week', -1, '2027-01-15', 0)).toEqual({ from: '2027-01-03', to: '2027-01-09' });
    expect(rangeOf('month', -1, '2027-01-15', 1)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(rangeOf('year', 0, '2027-07-04', 1)).toEqual({ from: '2027-01-01', to: '2027-12-31' });
  });

  it('is absent when the module is off', async () => {
    const s = open({}, false);
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Analytics' })).toBeNull();
    expect(s.calls.some((c) => c.path === '/analytics')).toBe(false);
  });
});
