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

describe('dashboard', () => {
  it('shows exactly the three metrics, the split marked as an estimate', async () => {
    open(summary());
    expect((await metric('Hourly earnings')).getByText('$20.00 / h')).toBeTruthy();
    expect((await metric('Deduction value')).getByText('$140.00')).toBeTruthy();
    const split = await metric('Active vs deadhead');
    expect(split.getByText(/120\.0 km/).textContent).toContain('80.0 km');
    expect(split.getByText(/120\.0 km/).textContent).toContain('*');
    expect(screen.getByText('* estimated from detected stops')).toBeTruthy();
    expect(screen.getAllByRole('region').length).toBe(3);
    expect(screen.getByText(/4 shifts, 20\.5 hours, 200\.0 km in total/)).toBeTruthy();
  });

  it('asks for the last 30 days in the instance time zone, then for another period', async () => {
    const { calls } = open(summary());
    await metric('Hourly earnings');
    const first = calls.find((c) => c.path === '/summary')!;
    expect(first).toBeTruthy();
    expect(screen.getByText('2026-02-14 to 2026-03-15')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Period/), { target: { value: 'year' } });
    expect(await screen.findByText('2026-01-01 to 2026-03-15')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/summary').length).toBe(2);
  });

  it('reads "not entered", never zero, when nothing was labelled', async () => {
    open(summary({ earnings_cents: null, tips_cents: null, hourly_earnings_cents: null }));
    const m = await metric('Hourly earnings');
    expect(m.getByText('not entered')).toBeTruthy();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });

  it('reads "not available" when the country has no rate pack', async () => {
    open(summary({ deduction_cents: null }));
    expect((await metric('Deduction value')).getByText('not available')).toBeTruthy();
  });

  it('with stops off there is a business total, no split and no estimate marker', async () => {
    open(
      summary({ earnings_cents: null, hourly_earnings_cents: null }),
      settingsFixture({ modules: { stops: false } }),
    );
    expect((await metric('Business distance')).getByText('200.0 km')).toBeTruthy();
    expect((await metric('Hourly earnings')).getByText('unavailable')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Active vs deadhead' })).toBeNull();
    expect(screen.queryByText(/estimated/)).toBeNull();
  });

  it('shows a server refusal', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /summary': () => ({ status: 422, body: { code: 'validation_failed' } }),
      },
      '/dashboard',
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('computes period bounds in the given zone', () => {
    const now = Date.parse('2026-03-01T03:00:00Z'); // still 28 Feb in Toronto
    expect(localDate(now, 'America/Toronto')).toBe('2026-02-28');
    const month = PERIODS.find((p) => p.id === 'month')!;
    expect(month.range(now, 'America/Toronto')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
