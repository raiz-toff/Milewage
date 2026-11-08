// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { targetInput, targetOf, valueText } from '../src/pages/Goals';
import { renderApp, settingsFixture, signedIn, pick, menu, DASHBOARD } from './support/kit';

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
  // A PATCH changes the list the next GET returns, as the server would.
  let shown = list;
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { goals: enabled } })),
      'GET /goals': () => ({ body: shown }),
      'POST /goals': () => ({ status: 201, body: goal({ id: 2 }) }),
      'PATCH /goals/1': ({ body }) => {
        const b = body as Record<string, unknown>;
        const target = typeof b.target === 'number' ? b.target : 50_000;
        shown = [goal({ ...b, target }, { target })];
        return { body: shown[0] };
      },
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
    pick(screen.getByLabelText('Measure'), 'hours');
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add goal' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({
      label: 'Hours',
      metric: 'hours',
      period: 'weekly',
      target: 1200,
    });
    menu('Weekly pay', 'Pause');
    await waitFor(() =>
      expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ active: false }),
    );
    menu('Weekly pay', 'Delete');
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('edits a goal in the add form, pre-filled, and saves the target in the stored unit', async () => {
    const s = open();
    await screen.findByText('$250.00 of $500.00');
    menu('Weekly pay', 'Edit');
    expect(screen.getByRole('heading', { name: 'Edit goal' })).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Weekly pay');
    expect((screen.getByLabelText('Target') as HTMLInputElement).value).toBe('500.00');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Monthly pay ' } });
    pick(screen.getByLabelText('Per'), 'monthly');
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      label: 'Monthly pay',
      metric: 'earnings',
      period: 'monthly',
      target: 60_000,
    });
    expect(await screen.findByText('$250.00 of $600.00')).toBeTruthy();
    expect(screen.getByText('Monthly pay')).toBeTruthy();
    // The form is the add form again, empty and back on the defaults.
    expect(screen.getByRole('heading', { name: 'Add a goal' })).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Per').textContent).toMatch(/weekly/);
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('cancel leaves the goal as it was and empties the form; deleting the edited goal ends the edit', async () => {
    const s = open([goal({ metric: 'hours', target: 90 }, { value: 30, target: 90 })]);
    await screen.findByText('Weekly pay');
    menu('Weekly pay', 'Edit');
    expect((screen.getByLabelText('Target') as HTMLInputElement).value).toBe('1.5');
    expect(screen.getByLabelText('Measure').textContent).toMatch(/Hours worked/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Add a goal' })).toBeTruthy();
    expect((screen.getByLabelText('Target') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Measure').textContent).toMatch(/Earnings/);
    menu('Weekly pay', 'Edit');
    menu('Weekly pay', 'Delete');
    expect(screen.getByRole('heading', { name: 'Add a goal' })).toBeTruthy();
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(s.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('dropdowns can shrink in the form grid, so a long measure does not spill over Per', async () => {
    open();
    await screen.findByText('Weekly pay');
    for (const name of ['Measure', 'Per']) {
      const trigger = screen.getByLabelText(name);
      expect(trigger.className).toMatch(/\bmin-w-0\b/);
      expect(trigger.parentElement!.className).toMatch(/\bmin-w-0\b/);
    }
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
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Goals' })).toBeNull();
    expect(s.calls.some((c) => c.path === '/goals')).toBe(false);
  });

  it('unit conversions', () => {
    expect([
      targetOf('earnings', '12.50', 'km', 'CAD'),
      targetOf('hours', '1.5', 'km', 'CAD'),
      targetOf('shifts', '4', 'km', 'CAD'),
    ]).toEqual([1250, 90, 4]);
    expect(targetOf('active_distance', '2', 'mi', 'CAD')).toBe(3219);
    expect(Number.isNaN(targetOf('shifts', '0', 'km', 'CAD'))).toBe(true);
    expect(valueText('hours', 90, 'km', 'CAD')).toBe('1.5 h');
    // The form shows a stored target as it was typed.
    expect([
      targetInput('earnings', 1250, 'km', 'CAD'),
      targetInput('hours', 90, 'km', 'CAD'),
      targetInput('shifts', 4, 'km', 'CAD'),
      targetInput('active_distance', 3219, 'mi', 'CAD'),
      targetInput('active_distance', 100_000, 'km', 'CAD'),
    ]).toEqual(['12.50', '1.5', '4', '2', '100']);
  });
});
