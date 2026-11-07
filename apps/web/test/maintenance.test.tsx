// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn, pick } from './support/kit';

afterEach(cleanup);

const vehicle = {
  id: 1,
  name: 'Corolla',
  kind: 'car',
  make: null,
  model: null,
  year: null,
  plate: null,
  power: null,
  created_at: 1,
  archived_at: null,
};
const log = (over: object = {}) => ({
  id: 5,
  vehicle_id: 1,
  kind: 'oil_change',
  serviced_on: '2023-11-01',
  odometer_m: 54_000_000,
  cost_cents: 8900,
  expense_id: 3,
  double_counts: true,
  notes: null,
  created_at: 1,
  ...over,
});

function open(enabled = true, country = 'CA') {
  let rows = [log()];
  return renderApp(
    {
      ...signedIn(
        settingsFixture({
          modules: { maintenance: enabled, tax: false },
          distance_unit: 'km',
          country,
        }),
      ),
      'GET /vehicles': () => ({ body: [vehicle] }),
      'GET /vehicles/1/maintenance': () => ({ body: rows }),
      'POST /vehicles/1/maintenance': ({ body }) => {
        rows = [
          log({ id: 6, kind: (body as { kind: string }).kind, double_counts: false }),
          ...rows,
        ];
        return { status: 201, body: rows[0] };
      },
      'DELETE /maintenance/5': () => {
        rows = rows.filter((r) => r.id !== 5);
        return { status: 204 };
      },
    },
    '/vehicles',
  );
}

describe('vehicle service log (module maintenance)', () => {
  it('opens on request, shows cost, odometer and the mileage-rate marker, adds in cents and metres, deletes', async () => {
    const s = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Service log' }));
    expect(await screen.findByText('$89.00')).toBeTruthy();
    expect(screen.getByText('54,000 km')).toBeTruthy();
    expect(screen.getByText('covered by the mileage rate')).toBeTruthy();
    pick(screen.getByLabelText('Service'), 'tires');
    fireEvent.change(screen.getByLabelText(/^Cost/), { target: { value: '640.50' } });
    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: '54100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(s.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      kind: 'tires',
      cost_cents: 64_050,
      odometer_m: 54_100_000,
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /Delete service Nov 1, 2023 Oil change/ }),
    );
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it("writes the service day as other dates are written, in the country's order", async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Service log' }));
    expect(await screen.findByText('Nov 1, 2023')).toBeTruthy();
    expect(screen.queryByText('2023-11-01')).toBeNull();
    cleanup();
    open(true, 'GB');
    fireEvent.click(await screen.findByRole('button', { name: 'Service log' }));
    expect(await screen.findByText('1 Nov 2023')).toBeTruthy();
  });

  it('refuses a cost that is not a number without calling the server', async () => {
    const s = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Service log' }));
    await screen.findByText('$89.00');
    fireEvent.change(screen.getByLabelText(/^Cost/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/numbers/);
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('is absent when the module is off', async () => {
    const s = open(false);
    await screen.findByText('Corolla');
    expect(screen.queryByRole('button', { name: 'Service log' })).toBeNull();
    expect(s.calls.some((c) => c.path.includes('maintenance'))).toBe(false);
  });
});
