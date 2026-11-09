// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { hourLabel } from '../src/ui/HourBars';
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

/** The API's 24 hours, with shifts starting at the given ones. */
const byHour = (shifts: Record<number, number>) =>
  Array.from({ length: 24 }, (_, hour) => ({ hour, shifts: shifts[hour] ?? 0 }));

function open(
  over: Record<string, unknown> = {},
  enabled = true,
  timeFormat: '12h' | '24h' = '24h',
) {
  const g = groups(over);
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { analytics: enabled }, time_format: timeFormat })),
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
    const sources = screen.getByRole('region', { name: 'Income sources' });
    // The platform's name and badge (plan 25), not its slug.
    expect(sources.textContent).toMatch(/DoorDash: \$300\.00 \(100%\)/);
    expect(sources.querySelector('[data-platform="doordash"]')).not.toBeNull();
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

  it('draws a column per hour of the day for shift start times, with the numbers in a table', async () => {
    open({
      rhythm: {
        by_weekday: [{ weekday: 2, shifts: 2, hours: 4 }],
        by_start_hour: byHour({ 9: 2, 17: 3 }),
        average_shift_minutes: 120,
      },
    });
    const region = await screen.findByRole('region', { name: 'Shift start times' });
    expect(region.querySelector('h2')!.textContent).toBe('Shift start times');
    expect(region.textContent).toMatch(/How many shifts started in each hour of the day/);
    const columns = region.querySelectorAll<HTMLElement>('[data-hour]');
    expect(columns).toHaveLength(24);
    // The columns are drawn to scale with the chart token, and hidden from a screen reader.
    const bar = (h: number) => columns[h]!.querySelector<HTMLElement>('.bg-chart-1')!;
    expect([bar(17).style.height, bar(9).style.height, bar(0).style.height]).toEqual([
      '100%',
      `${(2 / 3) * 100}%`,
      '0%',
    ]);
    expect(columns[0]!.closest('[aria-hidden]')).not.toBeNull();
    // Only the busiest hour is labelled on the chart; a tick every six hours.
    const chart = columns[0]!.parentElement!;
    expect([...chart.querySelectorAll('.absolute')].map((n) => n.textContent)).toEqual([
      '00:00',
      '06:00',
      '12:00',
      '3',
      '18:00',
    ]);
    // Hovering a column says its value and hour; leaving the chart clears it.
    fireEvent.pointerEnter(columns[9]!);
    expect(region.textContent).toMatch(/2 shifts at 09:00/);
    fireEvent.pointerLeave(chart);
    expect(region.textContent).not.toMatch(/2 shifts at 09:00/);
    // Every hour and its count are in the table a screen reader gets; the button shows it to all.
    const table = within(region).getByRole('table', { name: 'Shifts by start hour' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(25);
    expect(rows[18]!.textContent).toBe('17:003');
    expect(table.parentElement!.className).toBe('sr-only');
    const show = within(region).getByRole('button', { name: 'Show as a table' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
    expect(table.parentElement!.className).not.toMatch(/sr-only/);
    expect(
      within(region).getByRole('button', { name: 'Hide table' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('start times: hours follow the time format setting, and no shifts is words, not bars', async () => {
    open(
      { rhythm: { by_weekday: [], by_start_hour: byHour({ 17: 1 }), average_shift_minutes: 60 } },
      true,
      '12h',
    );
    const region = await screen.findByRole('region', { name: 'Shift start times' });
    expect([...region.querySelectorAll('[data-hour] .absolute')].map((n) => n.textContent)).toEqual(
      ['12 AM', '6 AM', '12 PM', '1', '6 PM'],
    );
    fireEvent.pointerEnter(region.querySelectorAll('[data-hour]')[17]!);
    expect(region.textContent).toMatch(/1 shift at 5 PM/);
    cleanup();
    open(); // the fixture's by_start_hour is empty
    const empty = await screen.findByRole('region', { name: 'Shift start times' });
    expect(empty.textContent).toMatch(/No shifts started in this period/);
    expect(empty.querySelectorAll('[data-hour]')).toHaveLength(0);
    expect(within(empty).queryByRole('table')).toBeNull();
    cleanup();
    open({ rhythm: { by_weekday: [], by_start_hour: byHour({}), average_shift_minutes: null } });
    expect((await screen.findByRole('region', { name: 'Shift start times' })).textContent).toMatch(
      /No shifts started in this period/,
    );
    expect([hourLabel(0, '12h'), hourLabel(12, '12h'), hourLabel(23, '24h')]).toEqual([
      '12 AM',
      '12 PM',
      '23:00',
    ]);
  });

  it('is absent when the module is off', async () => {
    const s = open({}, false);
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Analytics' })).toBeNull();
    expect(s.calls.some((c) => c.path === '/analytics')).toBe(false);
  });
});
