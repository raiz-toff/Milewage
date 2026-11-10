// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { sketchPath } from '../src/map/RouteSketch';
import { renderApp, settingsFixture, signedIn } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const T0 = Date.parse('2027-01-15T15:00:00Z'); // 10:00 in Toronto
const shift = (id: number, over: object = {}) => ({
  id,
  client_id: `00000000-0000-4000-8000-00000000000${id}`,
  vehicle_id: 1,
  status: 'ended',
  started_at: T0,
  ended_at: T0 + 2 * 3_600_000,
  local_date: '2027-01-15',
  segmenter: 'whole_shift',
  total_m: 52_000,
  active_m: 52_000,
  deadhead_m: 0,
  personal_m: 0,
  calc_version: 3,
  calculated_at: 1,
  notes: null,
  deduction_cents: null,
  flags: [],
  ...over,
});
const effective = (platform: string, total: number) => ({
  platform,
  gross_cents: total,
  tips_cents: 0,
  bonus_cents: 0,
  fees_cents: 0,
  adjustments_cents: 0,
  tax_withheld_cents: 0,
  total_cents: total,
  orders: null,
  source: 'entered',
});
const route = {
  source: 'raw' as const,
  t: [1, 2, 3],
  lat_e7: [436500000, 436500000, 436600000],
  lon_e7: [-793900000, -793800000, -793800000],
};

function open(table: Record<string, Handler>, modules: object = {}) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules })),
      'GET /platforms': () => ({
        body: [{ slug: 'doordash', label: 'DoorDash', custom: false, active: true, sort: 0 }],
      }),
      ...table,
    },
    '/dashboard',
  );
}
const recent = async () => within(await screen.findByRole('region', { name: 'Recent shifts' }));

describe('dashboard recent shifts (Comma rows)', () => {
  it('shows platforms, date, time, distance, earnings and per hour', async () => {
    open({
      'GET /shifts': () => ({
        body: {
          items: [shift(1, { flags: [{ code: 'gap_counted', severity: 'review' }] })],
          next_cursor: null,
        },
      }),
      'GET /shifts/1/earnings': () => ({
        body: {
          entries: [],
          labels: [],
          effective: [effective('doordash', 9_000), effective('skip', 3_000)],
        },
      }),
    });
    const box = await recent();
    const row = await box.findByRole('link', { name: /DoorDash, skip/ });
    expect(row.getAttribute('href')).toBe('/shifts/1');
    // Each platform has its badge (hidden from screen readers; the names are written beside it).
    const badges = [...row.querySelectorAll('[data-platform]')];
    expect(
      badges.map((b) => [b.getAttribute('data-platform'), b.getAttribute('data-look')]),
    ).toEqual([
      ['doordash', 'initials'],
      ['skip', 'initials'],
    ]);
    expect(badges[0]!.textContent).toBe('DD');
    expect(badges.every((b) => b.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(row.textContent).toMatch(/1 to review/);
    expect(row.textContent).toMatch(/Fri, Jan 15 ·.*10:00–12:00 ·.*52\.0 km/);
    expect(within(row).getByText('$120.00')).toBeTruthy();
    expect(within(row).getByText('$60.00 / h')).toBeTruthy();
    expect(box.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/shifts');
  });

  it("shows the driver's own logo as a platform's badge", async () => {
    open({
      'GET /platforms': () => ({
        body: [
          {
            slug: 'cityeats',
            label: 'City Eats',
            custom: true,
            active: true,
            sort: 0,
            logo_version: 'v7',
          },
        ],
      }),
      'GET /shifts': () => ({ body: { items: [shift(1)], next_cursor: null } }),
      'GET /shifts/1/earnings': () => ({
        body: { entries: [], labels: [], effective: [effective('cityeats', 5_000)] },
      }),
    });
    const row = await (await recent()).findByRole('link', { name: /City Eats/ });
    const badge = row.querySelector('[data-platform="cityeats"]')!;
    expect(badge.getAttribute('data-look')).toBe('image');
    expect(badge.querySelector('img')!.getAttribute('src')).toBe(
      '/api/v1/platforms/cityeats/logo?v=v7',
    );
  });

  it('says "not entered" without earnings; asks nothing with the module off', async () => {
    const s = open({
      'GET /shifts': () => ({ body: { items: [shift(1)], next_cursor: null } }),
      'GET /shifts/1/earnings': () => ({ body: { entries: [], labels: [], effective: [] } }),
    });
    const row = await (await recent()).findByRole('link', { name: /Shift/ });
    expect(await within(row).findByText('not entered')).toBeTruthy();
    cleanup();
    const off = open(
      { 'GET /shifts': () => ({ body: { items: [shift(1)], next_cursor: null } }) },
      { earnings: false },
    );
    await (await recent()).findByRole('link', { name: /Shift/ });
    await new Promise((r) => setTimeout(r, 20));
    expect(off.calls.some((c) => c.path === '/shifts/1/earnings')).toBe(false);
    expect(s.calls.some((c) => c.path === '/shifts/1/earnings')).toBe(true);
    expect(screen.queryByText('not entered')).toBeNull();
  });

  it('offers the phone when there are no shifts, and a retry when they cannot be read', async () => {
    open({ 'GET /shifts': () => ({ body: { items: [], next_cursor: null } }) });
    const box = await recent();
    expect(await box.findByText(/No shifts yet\. Shifts are recorded on the phone\./)).toBeTruthy();
    expect(box.getByRole('link', { name: 'Pair your phone' }).getAttribute('href')).toBe(
      '/devices',
    );
    cleanup();
    let fail = true;
    open({
      'GET /shifts': () =>
        fail
          ? { status: 500, body: { code: 'internal' } }
          : { body: { items: [shift(1)], next_cursor: null } },
    });
    const failed = await recent();
    fail = false;
    fireEvent.click(await failed.findByRole('button', { name: 'Try again' }));
    expect(await failed.findByRole('link', { name: /Shift/ })).toBeTruthy();
  });
  it('draws a sketch of the route, hidden from screen readers; none without a route or replay', async () => {
    const list = () => ({ body: { items: [shift(1)], next_cursor: null } });
    open({ 'GET /shifts': list, 'GET /shifts/1/route': () => ({ body: route }) });
    const row = await (await recent()).findByRole('link', { name: /Shift/ });
    const svg = await within(row).findByTestId('route-sketch');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const lines = [...svg.querySelectorAll('polyline')];
    expect(lines).toHaveLength(1);
    expect(lines[0]!.getAttribute('points')!.split(' ')).toHaveLength(3);
    // A quiet line in the text colour: the yellow route belongs to the shift's own map.
    expect(lines[0]!.getAttribute('stroke')).toBe('currentColor');
    cleanup();
    open({
      'GET /shifts': list,
      'GET /shifts/1/route': () => ({ status: 404, body: { code: 'not_found' } }),
    });
    const bare = await (await recent()).findByRole('link', { name: /Shift/ });
    await new Promise((r) => setTimeout(r, 20));
    expect(within(bare).queryByTestId('route-sketch')).toBeNull();
    cleanup();
    const off = open({ 'GET /shifts': list }, { replay: false });
    await (await recent()).findByRole('link', { name: /Shift/ });
    await new Promise((r) => setTimeout(r, 20));
    expect(off.calls.some((c) => c.path === '/shifts/1/route')).toBe(false);
  });

  it('fits the route into the sketch box, keeping its shape', () => {
    // Due east: a flat line across the middle, not squeezed into a dot.
    const flat = { source: 'raw' as const, t: [1, 2], lat_e7: [0, 0], lon_e7: [0, 100000] };
    expect(sketchPath(flat, 64, 48, 4)).toBe('4.0,24.0 60.0,24.0');
    // A square stays square: 40 px high fits, so it is 40 px wide, centred.
    const square = {
      source: 'raw' as const,
      t: [1, 2, 3],
      lat_e7: [0, 0, 100000],
      lon_e7: [0, 100000, 100000],
    };
    expect(sketchPath(square, 64, 48, 4)).toBe('12.0,44.0 52.0,44.0 52.0,4.0');
    expect(sketchPath({ source: 'raw', t: [1], lat_e7: [0], lon_e7: [0] })).toBeNull();
  });
});
