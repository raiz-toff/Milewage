// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERIODS, localDate } from '../src/pages/Dashboard';
import { renderApp, settingsFixture, signedIn } from './support/kit';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-15T15:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const summary = (over: object = {}) => ({
  from: '2026-02-14',
  to: '2026-03-15',
  shift_count: 4,
  hours: 20.5,
  earnings_cents: 41_000,
  tips_cents: 6_000,
  active_m: 120_000,
  deadhead_m: 80_000,
  personal_m: 0,
  total_m: 200_000,
  deduction_cents: 14_000,
  hourly_earnings_cents: 2_000,
  ...over,
});

function open(body: object, settings = settingsFixture()) {
  return renderApp({ ...signedIn(settings), 'GET /summary': () => ({ body }) }, '/dashboard');
}
const metric = async (name: string) => within(await screen.findByRole('region', { name }));
const tile = async (name: string) => within(await screen.findByRole('group', { name }));
const tab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }));
const asked = (calls: { path: string; query: string }[]) =>
  calls.filter((c) => c.path === '/summary').map((c) => c.query);

describe('dashboard', () => {
  it('shows Comma tiles and the deduction tip, the split marked as an estimate', async () => {
    open(summary());
    expect((await tile('Shift time')).getByText('20.5 h')).toBeTruthy();
    expect((await tile('Business distance')).getByText('200.0 km')).toBeTruthy();
    expect((await tile('Per hour')).getByText('$20.00')).toBeTruthy();
    const split = screen.getByText(/Of that, 120\.0 km active/);
    expect(split.textContent).toMatch(/120\.0 km active\* and 80\.0 km deadhead\*/);
    expect(split.textContent).toContain('* Estimated from detected stops.');
    const note = screen.getByRole('note', { name: 'Deduction value' });
    expect(note.textContent).toMatch(/Estimated deduction value: \$140\.00 on 200\.0 km/);
    expect(note.textContent).toMatch(/it is not money paid to you/);
    expect(within(note).getByRole('link', { name: 'Open Tax' }).getAttribute('href')).toBe('/tax');
    expect(screen.queryByText(/Hourly earnings|Active vs deadhead/)).toBeNull(); // the old cards
  });

  it('greets the driver in their time zone, by name when there is one', async () => {
    open(summary(), settingsFixture({ display_name: 'Sam' }));
    // 15:00 UTC is 11:00 in Toronto.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Good morning, Sam' }),
    ).toBeTruthy();
    expect(screen.getByText('Sunday, March 15')).toBeTruthy();
    cleanup();
    vi.setSystemTime(new Date('2026-03-15T23:30:00Z'));
    open(summary());
    expect(await screen.findByRole('heading', { level: 1, name: 'Good evening' })).toBeTruthy();
  });

  it('leads with this week earned and today on the line under it; Today shows the week there', async () => {
    const { calls } = renderApp(
      {
        ...signedIn(),
        'GET /summary': ({ url }) => ({
          body:
            url.searchParams.get('from') === url.searchParams.get('to')
              ? summary({ shift_count: 1, earnings_cents: 9_000 })
              : summary(),
        }),
      },
      '/dashboard',
    );
    const hero = await metric('Earned');
    expect(screen.getByRole('tab', { name: 'Week', selected: true })).toBeTruthy();
    expect(screen.getByText('Mar 9 – 15, 2026')).toBeTruthy();
    expect(hero.getByText('$410.00')).toBeTruthy();
    expect(hero.getByText('$90.00 today · 4 shifts this week')).toBeTruthy();
    expect(asked(calls)).toContain('?from=2026-03-09&to=2026-03-15');
    expect(asked(calls)).toContain('?from=2026-03-15&to=2026-03-15');
    tab('Today');
    expect(await screen.findByText('Sunday, Mar 15')).toBeTruthy();
    expect(
      (await metric('Earned')).getByText('$410.00 this week · 4 shifts this week'),
    ).toBeTruthy();
  });

  it('keeps the longer periods as tabs', async () => {
    const { calls } = open(summary());
    await tile('Per hour');
    tab('Year');
    expect(await screen.findByText('Jan 1 – Mar 15, 2026')).toBeTruthy();
    tab('30 days');
    expect(await screen.findByText('Feb 14 – Mar 15, 2026')).toBeTruthy();
    expect(asked(calls)).toContain('?from=2026-01-01&to=2026-03-15');
    expect(asked(calls)).toContain('?from=2026-02-14&to=2026-03-15');
  });

  it('reads "Not entered", never zero, when nothing was entered; zero with no shift', async () => {
    open(summary({ earnings_cents: null, tips_cents: null, hourly_earnings_cents: null }));
    expect((await metric('Earned')).getByText('Not entered')).toBeTruthy();
    expect(screen.getByText('Enter what the apps paid on a shift to see it here.')).toBeTruthy();
    expect((await tile('Per hour')).getByText('—')).toBeTruthy();
    expect((await tile('Per hour')).getByText('No earnings entered')).toBeTruthy();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
    cleanup();
    open(summary({ shift_count: 0, hours: 0, earnings_cents: null, hourly_earnings_cents: null }));
    expect((await metric('Earned')).getByText('$0.00')).toBeTruthy(); // no shift: nothing to enter
    expect((await tile('Per hour')).getByText('No shift time yet')).toBeTruthy();
  });

  it("hides the deduction tip without a rate; the driver's own rate is named so", async () => {
    open(summary({ deduction_cents: null }));
    await tile('Per hour');
    expect(screen.queryByRole('note', { name: /Deduction value/ })).toBeNull();
    cleanup();
    open(summary(), settingsFixture({ mileage_rate: 'yours', modules: { tax: false } }));
    const note = await screen.findByRole('note', { name: 'Deduction value (your rate)' });
    expect(note.textContent).toMatch(/Estimated deduction value \(your rate\): \$140\.00/);
    expect(within(note).queryByRole('link')).toBeNull();
  });

  it('with stops and earnings off: no split, no estimate marker, earnings unavailable', async () => {
    open(
      summary({ earnings_cents: null, hourly_earnings_cents: null }),
      settingsFixture({ modules: { stops: false, earnings: false } }),
    );
    expect((await tile('Business distance')).getByText('200.0 km')).toBeTruthy();
    expect((await tile('Per hour')).getByText('Earnings are off')).toBeTruthy();
    expect((await metric('Earned')).getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText(/from detected stops/)).toBeNull();
    expect(document.querySelector('abbr')).toBeNull();
  });

  it('shows a server refusal, and the hero can try again', async () => {
    let fail = true;
    renderApp(
      {
        ...signedIn(),
        'GET /summary': () =>
          fail ? { status: 422, body: { code: 'validation_failed' } } : { body: summary() },
      },
      '/dashboard',
    );
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    fail = false;
    fireEvent.click(
      within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Try again' }),
    );
    expect(await metric('Earned')).toBeTruthy();
  });

  it('Add expense opens the expense form; it is not there with expenses off', async () => {
    open(summary());
    fireEvent.click(await screen.findByRole('link', { name: 'Add expense' }));
    expect(await screen.findByText('New expense')).toBeTruthy();
    cleanup();
    open(summary(), settingsFixture({ modules: { expenses: false } }));
    await screen.findByRole('region', { name: 'Earned' });
    expect(screen.queryByRole('link', { name: 'Add expense' })).toBeNull();
  });

  it('computes period bounds in the given zone', () => {
    const now = Date.parse('2026-03-01T03:00:00Z'); // still 28 Feb in Toronto
    expect(localDate(now, 'America/Toronto')).toBe('2026-02-28');
    const month = PERIODS.find((p) => p.id === 'month')!;
    expect(month.range(now, 'America/Toronto')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
