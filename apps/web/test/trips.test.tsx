// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { shift, trip } from './support/fixtures';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const open = (
  settings = settingsFixture(),
  trips: object[] = [trip(1), trip(2, { kind: 'deadhead' })],
) =>
  renderApp(
    {
      ...signedIn(settings),
      'GET /shifts/1': () => ({ body: shift() }),
      'GET /shifts/1/trips': () => ({ body: trips }),
    },
    '/shifts/1',
  );

const tripsTable = async () =>
  within(await screen.findByRole('region', { name: 'Trips' })).findByRole('table');

describe('trips table in shift detail', () => {
  it('lists trips with distance in the driver unit and auto kinds marked estimated', async () => {
    open();
    const table = await tripsTable();
    expect(within(table).getByText('active (estimated)')).toBeTruthy();
    expect(within(table).getByText('deadhead (estimated)')).toBeTruthy();
    expect(within(table).getByText('2.0 km')).toBeTruthy();
    expect(within(table).getAllByRole('row').length).toBe(3);
  });

  it('a manual trip and a personal trip carry no estimate marker', async () => {
    open(settingsFixture(), [
      trip(1, { source: 'manual', purpose: 'Bank run' }),
      trip(2, { kind: 'personal' }),
    ]);
    const table = await tripsTable();
    expect(within(table).getByText('active')).toBeTruthy();
    expect(within(table).getByText('personal')).toBeTruthy();
    expect(within(table).getByText('Bank run')).toBeTruthy();
    expect(within(table).queryByText(/estimated/)).toBeNull();
  });

  it('sorts by distance on a click', async () => {
    open();
    const table = await tripsTable();
    fireEvent.click(within(table).getByRole('button', { name: 'Distance' }));
    fireEvent.click(within(table).getByRole('button', { name: 'Distance' }));
    const first = within(table).getAllByRole('row')[1]!;
    expect(within(first).getByText('2.0 km')).toBeTruthy();
  });

  it('with stops off the kinds read business or personal, never estimated', async () => {
    open(settingsFixture({ modules: { stops: false } }), [
      trip(1),
      trip(2, { kind: 'deadhead' }),
      trip(3, { kind: 'personal' }),
    ]);
    const table = await tripsTable();
    expect(within(table).getAllByText('business').length).toBe(2);
    expect(within(table).getByText('personal')).toBeTruthy();
    expect(within(table).queryByText(/estimated|deadhead/)).toBeNull();
  });

  it('says so when the shift has no trips, and when trips cannot be read', async () => {
    open(settingsFixture(), []);
    expect(await screen.findByText('No trips were recorded.')).toBeTruthy();
    cleanup();
    renderApp({ ...signedIn(), 'GET /shifts/1': () => ({ body: shift() }) }, '/shifts/1');
    expect(await screen.findByText(/Trips could not be loaded/)).toBeTruthy();
  });
});
