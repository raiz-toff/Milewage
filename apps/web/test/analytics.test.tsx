// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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

const bucket = (start: string, over: Record<string, unknown> = {}) => ({
  start,
  shift_count: 0,
  hours: 0,
  earnings_cents: 0,
  tips_cents: 0,
  active_m: 0,
  deadhead_m: 0,
  personal_m: 0,
  total_m: 0,
  unsplit_m: 0,
  platforms: [],
  ...over,
});
/** Every day (or month) of the asked range; the first two slots have shifts unless `empty`. */
function series(url: URL, mode?: unknown) {
  const from = url.searchParams.get('from')!;
  const to = url.searchParams.get('to')!;
  const by = url.searchParams.get('bucket') ?? 'day';
  const starts: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (by === 'day') starts.push(d);
    else if (!starts.includes(`${d.slice(0, 7)}-01`)) starts.push(`${d.slice(0, 7)}-01`);
  }
  const busy = mode !== 'empty';
  return {
    from,
    to,
    bucket: by,
    buckets: starts.map((s, i) =>
      busy && i === 0
        ? bucket(s, {
            shift_count: 1,
            hours: 2,
            earnings_cents: 10_000,
            tips_cents: 2_000,
            active_m: 6_000,
            deadhead_m: 4_000,
            total_m: 10_000,
            platforms:
              mode === 'one'
                ? [{ platform: 'doordash', earnings_cents: 10_000, tips_cents: 2_000 }]
                : [
                    { platform: 'doordash', earnings_cents: 7_000, tips_cents: 1_500 },
                    { platform: 'ubereats', earnings_cents: 3_000, tips_cents: 500 },
                  ],
          })
        : busy && i === 1
          ? bucket(s, {
              shift_count: 1,
              hours: 4,
              earnings_cents: 20_000,
              tips_cents: 0,
              active_m: 5_000,
              deadhead_m: 5_000,
              total_m: 10_000,
              platforms: [{ platform: 'doordash', earnings_cents: 20_000, tips_cents: 0 }],
            })
          : bucket(s),
    ),
  };
}
const breakdownFixture = {
  week_hours: [
    { weekday: 1, hour: 18, hours: 2, paid_hours: 2, earnings_cents: 8_000 },
    { weekday: 1, hour: 19, hours: 1, paid_hours: 1, earnings_cents: 4_000 },
    { weekday: 2, hour: 9, hours: 4, paid_hours: 4, earnings_cents: 6_000 },
  ],
  vehicles: [
    {
      vehicle_id: 1,
      shifts: 2,
      hours: 6,
      business_m: 20_000,
      personal_m: 0,
      earnings_cents: 30_000,
      expenses_cents: 500,
    },
  ],
  platforms: [
    {
      platform: 'doordash',
      earnings_cents: 27_000,
      tips_cents: 1_500,
      orders: 9,
      online_minutes: null,
      shifts: 2,
    },
    {
      platform: 'ubereats',
      earnings_cents: 3_000,
      tips_cents: 500,
      orders: null,
      online_minutes: null,
      shifts: 1,
    },
  ],
  expense_categories: [{ category: 'phone', cents: 500, count: 1 }],
};
const summaryFixture = {
  shift_count: 2,
  hours: 6,
  earnings_cents: 30_000,
  tips_cents: 2_000,
  active_m: 11_000,
  deadhead_m: 9_000,
  personal_m: 0,
  total_m: 20_000,
  deduction_cents: 1_400,
  deduction_rate: 'official',
  hourly_earnings_cents: 5_000,
};
const platformRow = (slug: string, label: string, sort: number) => ({
  slug,
  label,
  custom: false,
  color: null,
  emoji: null,
  active: true,
  sort,
  hourly_target_cents: null,
  logo_version: null,
});
const platformsFixture = [
  platformRow('doordash', 'DoorDash', 0),
  platformRow('ubereats', 'Uber Eats', 1),
];
const vehicle = (id: number, name: string) => ({
  id,
  name,
  kind: 'car',
  make: null,
  model: null,
  year: null,
  plate: null,
  power: null,
  ownership: 'owned',
  created_at: 1,
  archived_at: null,
});

function open(
  over: Record<string, unknown> = {},
  enabled = true,
  timeFormat: '12h' | '24h' = '24h',
  extra: Record<string, unknown> = {},
  modules: Record<string, boolean> = {},
) {
  const g = groups(over);
  return renderApp(
    {
      ...signedIn(
        settingsFixture({ modules: { analytics: enabled, ...modules }, time_format: timeFormat }),
      ),
      'GET /summary/series': ({ url }) => ({ body: series(url, extra.series) }),
      'GET /analytics/breakdown': ({ url }) => ({
        body: {
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          ...breakdownFixture,
          ...(extra.breakdown as object),
        },
      }),
      'GET /summary': ({ url }) => ({
        body: {
          ...summaryFixture,
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          ...(extra.summary as object),
        },
      }),
      'GET /vehicles': () => ({ body: (extra.vehicles as unknown[]) ?? [vehicle(1, 'Civic')] }),
      'GET /expenses/categories': () => ({
        body: [
          { slug: 'fuel', label: 'Fuel' },
          { slug: 'phone', label: 'Phone' },
        ],
      }),
      'GET /platforms': () => ({ body: platformsFixture }),
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
  it('shows the cards: earned after app fees, per mile, and online time only when there is some', async () => {
    open();
    const figures = await screen.findByLabelText('Figures');
    expect(figures.textContent).toMatch(/Earned, after app fees\$300\.00/);
    expect(figures.textContent).toMatch(/Net take-home\$220\.00/);
    // 300.00 over 20 km of business distance.
    expect(figures.textContent).toMatch(/Per km \(business\)\$15\.00/);
    expect(figures.textContent).not.toMatch(/online time/);
    expect(screen.getByText(/Not enough shifts to project/)).toBeTruthy();
    expect(screen.getByText(/estimated from detected stops/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Work rhythm' }).textContent).toMatch(
      /Busiest weekday: Tuesday/,
    );
    cleanup();
    open({
      cards: {
        gross_cents: 30_000,
        hourly_shift_cents: 5000,
        hourly_online_cents: 6000,
        total_hours: 6,
      },
    });
    expect((await screen.findByLabelText('Figures')).textContent).toMatch(
      /Per hour \(online time\)\$60\.00/,
    );
  });

  it('compares the period with the one before, in words', async () => {
    const s = open({}, true, '24h', { summary: {} });
    const words = await screen.findByTestId('comparison');
    // Both sides come from the fixture (300.00): the same.
    expect(words.textContent).toBe('The same as by this point last week ($300.00)');
    const asked = s.calls.filter((c) => c.path === '/summary').map((c) => c.query);
    expect(asked.length).toBeGreaterThanOrEqual(3); // to date, the week before to the same day, the whole week
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

  it('shows the period as a date picker; a day picked opens the period that holds it', async () => {
    const s = open();
    await screen.findByLabelText('Figures');
    const trigger = screen.getByRole('button', { name: /^Period: / });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Pick a period' });
    expect(dialog.querySelectorAll('select')).toHaveLength(2); // month and year dropdowns
    // The week shown is shaded: its first and last day and the five between.
    expect(dialog.querySelectorAll('.rdp-range_start, .rdp-range_end')).toHaveLength(2);
    expect(dialog.querySelectorAll('.rdp-range_middle')).toHaveLength(5);
    const days = [...dialog.querySelectorAll<HTMLButtonElement>('button[aria-label]')].filter(
      (b) => /\d{4}/.test(b.getAttribute('aria-label')!) && !b.disabled,
    );
    fireEvent.click(days[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      (screen.getByRole('button', { name: 'Next period' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(s.calls.filter((c) => c.path === '/analytics').length).toBeGreaterThan(1);
  });

  it('draws earnings stacked by platform, with the same numbers in its table', async () => {
    open();
    const region = await screen.findByRole('region', { name: 'Earnings' });
    const figure = within(region).getByRole('figure', { name: 'Earned each day, this week' });
    const legend = within(figure).getAllByRole('list')[0]!; // the legend, before the table
    expect(legend.textContent).toBe('DoorDashUber Eats');
    expect(figure.textContent).toMatch(/Tips were \$20\.00 of it \(7%\)/);
    const table = within(figure).getByRole('table', { name: 'Earned each day, this week' });
    const rows = within(table).getAllByRole('row');
    expect(rows[0]!.textContent).toBe('DayDoorDashUber EatsTipsEarned');
    expect(rows[1]!.textContent).toMatch(/\$70\.00\$30\.00\$20\.00\$100\.00$/);
    expect(rows[2]!.textContent).toMatch(/\$200\.00\$0\.00\$0\.00\$200\.00$/);
    // The keyboard reads the chart: focus, then the arrows.
    const chart = within(figure).getByRole('group', { name: /^Earned each day/ });
    fireEvent.focus(chart);
    expect(within(figure).getByRole('tooltip').textContent).toMatch(
      /^\$100\.00.*\$70\.00DoorDash\$30\.00Uber Eats1 shift, \$20\.00 in tips$/,
    );
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(within(figure).getByRole('tooltip').textContent).toMatch(/^\$200\.00/);
  });

  it('draws the pace, the pay rates, the distance split and when it pays', async () => {
    open();
    const pace = await screen.findByRole('region', { name: 'Pace' });
    expect(within(pace).getByRole('table').textContent).toMatch(/\$100\.00\$100\.00/); // day 1, both periods
    const pay = screen.getByRole('region', { name: 'Pay rate' });
    expect(
      within(pay).getByRole('figure', { name: /^Per hour \(shift time\) each day worked/ }),
    ).toBeTruthy();
    expect(within(pay).getByRole('figure', { name: /^Per km \(business distance\)/ })).toBeTruthy();
    // 300.00 over 6 h; 300.00 over 20 km.
    expect(pay.textContent).toMatch(/The line is the whole period: \$50\.00 an hour/);
    expect(pay.textContent).toMatch(/The line is the whole period: \$15\.00 a km/);
    const distance = screen.getByRole('region', { name: 'Distance' });
    expect(within(distance).getAllByRole('list')[0]!.textContent).toBe('Active*Deadhead*');
    expect(distance.textContent).toMatch(/\* Estimated from detected stops/);
    const when = screen.getByRole('region', { name: 'When it pays' });
    // Monday 18:00 to 21:00: 120.00 over 3 h.
    expect(when.textContent).toMatch(
      /Best: Mondays, 18:00 to 21:00, at \$40\.00 an hour \(3\.0 h on shift\)/,
    );
    fireEvent.click(within(when).getByRole('button', { name: 'Time on shift' }));
    expect(
      within(when).getByRole('table', { name: /^Time on shift by day and time/ }),
    ).toBeTruthy();
  });

  it('money in and out, the platforms side by side, and the vehicles only with two', async () => {
    open({}, true, '24h', {
      vehicles: [vehicle(1, 'Civic'), vehicle(2, 'Prius')],
      breakdown: {
        vehicles: [
          ...breakdownFixture.vehicles,
          {
            vehicle_id: 2,
            shifts: 1,
            hours: 1,
            business_m: 0,
            personal_m: 0,
            earnings_cents: null,
            expenses_cents: 0,
          },
        ],
      },
    });
    const money = await screen.findByRole('region', { name: 'Money in and out' });
    expect(money.textContent).toMatch(/Left after expenses: \$295\.00/);
    expect(money.textContent).toMatch(/Phone\$5\.00100%/);
    expect(money.textContent).toMatch(/Estimated deduction value: \$14\.00 on 20\.0 km/);
    const platforms = screen.getByRole('region', { name: 'Platforms' });
    const rows = within(within(platforms).getByRole('table')).getAllByRole('row');
    expect(rows[1]!.textContent).toMatch(/^DDDoorDash\$270\.0090%\$15\.0029\$30\.00/);
    expect(
      within(platforms).getByRole('img', { name: 'DoorDash, earned each day of this week' }),
    ).toBeTruthy();
    const vehicles = screen.getByRole('region', { name: 'Vehicles' });
    expect(within(vehicles).getAllByRole('row')[2]!.textContent).toMatch(
      /^Prius11\.0 h0\.0 kmNot entered/,
    );
    cleanup();
    open();
    await screen.findByRole('region', { name: 'Platforms' });
    expect(screen.queryByRole('region', { name: 'Vehicles' })).toBeNull(); // one vehicle: nothing to compare
  });

  it('with platforms and expenses off: pay and tips, no platform table, the deduction alone', async () => {
    open(
      {
        cards: {
          gross_cents: 30_000,
          hourly_shift_cents: 5000,
          hourly_online_cents: null,
          total_hours: 6,
        },
      },
      true,
      '24h',
      {},
      { platforms: false, expenses: false, receipts: false },
    );
    const earnings = await screen.findByRole('region', { name: 'Earnings' });
    expect(within(earnings).getAllByRole('list')[0]!.textContent).toBe('PayTips');
    expect(screen.queryByRole('region', { name: 'Platforms' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Money in and out' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Deduction' }).textContent).toMatch(/\$14\.00/);
  });

  it('a period with no shifts says so once, with a way forward; a year asks by month', async () => {
    const s = open({}, true, '24h', {
      series: 'empty',
      breakdown: { week_hours: [], platforms: [], vehicles: [] },
    });
    expect(
      await screen.findByText(/No shifts in this week yet\. Start one on your phone/),
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Earnings' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Year' }));
    await waitFor(() =>
      expect(
        s.calls.some((c) => c.path === '/summary/series' && c.query.includes('bucket=month')),
      ).toBe(true),
    );
  });

  it('is absent when the module is off', async () => {
    const s = open({}, false);
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Analytics' })).toBeNull();
    expect(s.calls.some((c) => c.path === '/analytics')).toBe(false);
  });
});
