// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { targetOf, valueText } from '../src/pages/Goals';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const goal = (over: object = {}, progress: object = {}) => ({
  id: 1,
  label: 'Weekly pay',
  metric: 'earnings',
  period: 'weekly',
  target: 50_000,
  active: true,
  created_at: 1,
  progress: {
    value: 25_000,
    target: 50_000,
    ratio: 0.5,
    period_from: '2027-01-11',
    period_to: '2027-01-17',
    estimated: false,
    note: null,
    ...progress,
  },
  ...over,
});

function open(list: object[] = [goal()], enabled = true) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { goals: enabled } })),
      'GET /goals': () => ({ body: list }),
      'POST /goals': () => ({ status: 201, body: goal({ id: 2 }) }),
      'PATCH /goals/1': () => ({ body: goal({ active: false }) }),
      'DELETE /goals/1': () => ({ status: 204 }),
    },
    '/goals',
  );
}

describe('goals screen (module goals)', () => {
  it('shows progress in the driver units and an empty state that sets no goal', async () => {
    open();
    expect(await screen.findByText('$250.00 of $500.00')).toBeTruthy();
    expect(
      screen
        .getByRole('progressbar', { name: 'Weekly pay progress' })
        .getAttribute('aria-valuenow'),
    ).toBe('50');
    cleanup();
    open([]);
    expect(await screen.findByText(/none is set for you/)).toBeTruthy();
  });

  it('unknown progress is words, not an empty bar; distance says estimated', async () => {
    open([
      goal({}, { value: null, ratio: null, note: 'no earnings entered' }),
      goal(
        { id: 3, label: 'Km', metric: 'active_distance', target: 100_000 },
        { value: 40_000, target: 100_000, ratio: 0.4, estimated: true },
      ),
    ]);
    expect(await screen.findByText('no earnings entered')).toBeTruthy();
    expect(screen.getByText('40.0 km of 100.0 km (estimated)')).toBeTruthy();
    expect(
      screen
        .getByRole('progressbar', { name: 'Weekly pay progress' })
        .getAttribute('aria-valuenow'),
    ).toBeNull();
  });

  it('adds a goal with the target converted to the stored unit, pauses and deletes', async () => {
    const s = open();
    await screen.findByText('Weekly pay');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hours' } });
    fireEvent.change(screen.getByLabelText('Measure'), { target: { value: 'hours' } });
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add goal' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({
      label: 'Hours',
      metric: 'hours',
      period: 'weekly',
      target: 1200,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pause Weekly pay' }));
    await waitFor(() =>
      expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ active: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Weekly pay' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('refuses a target of zero without calling the server', async () => {
    const s = open();
    await screen.findByText('Weekly pay');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add goal' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/above zero/);
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('is absent when the module is off', async () => {
    const s = open([goal()], false);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Goals' })).toBeNull();
    expect(s.calls.some((c) => c.path === '/goals')).toBe(false);
  });

  it('unit conversions', () => {
    expect([
      targetOf('earnings', '12.50', 'km'),
      targetOf('hours', '1.5', 'km'),
      targetOf('shifts', '4', 'km'),
    ]).toEqual([1250, 90, 4]);
    expect(targetOf('active_distance', '2', 'mi')).toBe(3219);
    expect(Number.isNaN(targetOf('shifts', '0', 'km'))).toBe(true);
    expect(valueText('hours', 90, 'km', 'CAD')).toBe('1.5 h');
  });
});
