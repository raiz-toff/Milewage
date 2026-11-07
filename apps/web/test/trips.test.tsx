// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { shift, stop, trip } from './support/fixtures';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const open = (
  settings = settingsFixture(),
  trips: object[] = [trip(1), trip(2, { kind: 'deadhead' })],
  stops: object[] = [],
) =>
  renderApp(
    {
      ...signedIn(settings),
      'GET /shifts/1': () => ({ body: shift() }),
      'GET /shifts/1/trips': () => ({ body: trips }),
      'GET /shifts/1/stops': () => ({ body: stops }),
    },
    '/shifts/1',
  );

const timeline = async () =>
  within(await screen.findByRole('region', { name: 'Timeline' })).findByRole('list', {
    name: 'Timeline',
  });
const rows = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('timeline in shift detail', () => {
  it('lists trips in time order, between start and end, with the estimate marked', async () => {
    open();
    const list = await timeline();
    expect(rows(list)).toEqual([
      '17:13Shift started',
      '17:23Trip · 1.0 km · active*17:23 – 17:28 · 5 min',
      '17:33Trip · 2.0 km · deadhead*17:33 – 17:38 · 5 min',
      '18:13Shift ended',
    ]);
    expect(screen.getByText('2 trips · 0 stops')).toBeTruthy();
  });

  it('lists trips and numbered stops in time order, between start and end', async () => {
    open(
      settingsFixture(),
      [trip(1), trip(3, { kind: 'deadhead' })],
      [
        stop(2, { dwell_s: 240 }),
        stop(4, { label: { role: 'dropoff', place: 'King St W' } as never }),
      ],
    );
    const list = await timeline();
    expect(rows(list)).toEqual([
      '17:13Shift started',
      '17:23Trip · 1.0 km · active*17:23 – 17:28 · 5 min',
      '17:331Stop 1 · Pickup*4 min',
      '17:43Trip · 3.0 km · deadhead*17:43 – 17:48 · 5 min',
      '17:532Stop 2 · Dropoff · King St W3 min',
      '18:13Shift ended',
    ]);
    expect(screen.getByText('2 trips · 2 stops')).toBeTruthy();
  });

  it('a manual trip and a personal trip carry no estimate marker', async () => {
    open(settingsFixture(), [
      trip(1, { source: 'manual', purpose: 'Bank run' }),
      trip(2, { kind: 'personal' }),
    ]);
    const list = await timeline();
    expect(rows(list).slice(1, 3)).toEqual([
      '17:23Trip · 1.0 km · active17:23 – 17:28 · 5 min · Bank run · edited',
      '17:33Trip · 2.0 km · personal17:33 – 17:38 · 5 min',
    ]);
  });

  it('picks one entry at a time, and lets go on a second press', async () => {
    open(settingsFixture(), [trip(1)], [stop(2)]);
    const list = await timeline();
    const [tripRow, stopRow] = within(list).getAllByRole('button');
    fireEvent.click(tripRow!);
    expect(tripRow!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(stopRow!);
    expect(tripRow!.getAttribute('aria-pressed')).toBe('false');
    expect(stopRow!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(stopRow!);
    expect(stopRow!.getAttribute('aria-pressed')).toBe('false');
  });

  it('with stops off the kinds read business or personal, never estimated', async () => {
    open(settingsFixture({ modules: { stops: false } }), [
      trip(1),
      trip(2, { kind: 'deadhead' }),
      trip(3, { kind: 'personal' }),
    ]);
    const list = await timeline();
    expect(within(list).getAllByText(/business/).length).toBe(2);
    expect(within(list).getByText(/personal/)).toBeTruthy();
    expect(within(list).queryByText(/\*|deadhead/)).toBeNull();
    expect(screen.getByText('3 trips')).toBeTruthy();
  });

  it('says so when the shift has no trips, and when trips cannot be read', async () => {
    open(settingsFixture(), []);
    expect(await screen.findByText('No trips were recorded.')).toBeTruthy();
    cleanup();
    renderApp({ ...signedIn(), 'GET /shifts/1': () => ({ body: shift() }) }, '/shifts/1');
    expect(await screen.findByText(/Trips could not be loaded/)).toBeTruthy();
  });

  it('says in one line why there is no map when the route module is off', async () => {
    open(settingsFixture({ modules: { replay: false } }));
    await timeline();
    expect(screen.getByText(/route map is off on this server/)).toBeTruthy();
  });
});
