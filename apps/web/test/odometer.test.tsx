// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startOfLocalDay, toMetres } from '../src/pages/Odometer';
import { renderApp, settingsFixture, signedIn, pick, pickDay } from './support/kit';
import type { Handler } from './support/kit';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-15T15:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const vehicle = (id: number, name: string) => ({
  id,
  name,
  kind: 'car',
  created_at: 1,
  archived_at: null,
});
const reading = (
  id: number,
  kind: string,
  reading_m: number,
  recorded_at: number,
  shift = false,
) => ({
  id,
  vehicle_id: 1,
  shift_id: shift ? 7 : null,
  kind,
  reading_m,
  recorded_at,
});
const JAN_1 = Date.parse('2026-01-01T05:00:00Z'); // midnight in Toronto
const DEC_31 = Date.parse('2025-12-31T14:00:00Z');

// What the server sends for a Canadian driver (the CA `logbook` slot).
const CA_LOGBOOK = {
  readings: 'The CRA asks for the odometer reading at the start and end of each fiscal year.',
  notes: [
    'A full 12-month logbook can serve as a base year; a 3-month sample then while within 10%.',
  ],
};

function open(
  rows: ReturnType<typeof reading>[] = [],
  extra: Record<string, Handler> = {},
  settings = settingsFixture({ logbook: CA_LOGBOOK }),
  vehicles = [vehicle(1, 'Corolla')],
) {
  return renderApp(
    {
      ...signedIn(settings),
      'GET /vehicles': () => ({ body: vehicles }),
      'GET /odometer': ({ url }) => ({
        body: rows.filter((r) => r.kind === url.searchParams.get('kind')),
      }),
      ...extra,
    },
    '/odometer',
  );
}

describe('odometer logbook', () => {
  it('lists year and shift readings in the driver unit with a link to the shift', async () => {
    open([
      reading(1, 'year_start', 12_480_000, JAN_1),
      reading(2, 'year_end', 11_900_000, DEC_31),
      reading(3, 'shift_start', 12_500_000, JAN_1 + 3_600_000, true),
    ]);
    const year = within(await screen.findByRole('region', { name: 'Fiscal year' }));
    expect(await year.findByText('12480.0 km')).toBeTruthy();
    expect(year.getByText('11900.0 km')).toBeTruthy();
    const shifts = within(screen.getByRole('region', { name: 'Shifts' }));
    expect(shifts.getByText('12500.0 km')).toBeTruthy();
    expect(shifts.getByRole('link', { name: 'Shift' }).getAttribute('href')).toBe('/shifts/7');
  });

  it('adds a year-start reading: unit converted, date at local midnight', async () => {
    const { calls } = open([], {
      'POST /odometer': () => ({ status: 201, body: reading(9, 'year_start', 1, 1) }),
    });
    await screen.findByLabelText('Odometer (km)');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: '12,480.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reading' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      vehicle_id: 1,
      kind: 'year_start',
      reading_m: 12_480_500,
      recorded_at: JAN_1,
    });
  });

  it('the date is picked on a calendar and recorded at local midnight', async () => {
    const { calls } = open([], {
      'POST /odometer': () => ({ status: 201, body: reading(9, 'year_start', 1, 1) }),
    });
    await screen.findByLabelText('Odometer (km)');
    expect(document.querySelector('input[type="date"]')).toBeNull();
    pickDay('Date', /March 2nd, 2026/);
    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reading' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      recorded_at: startOfLocalDay('2026-03-02', 'America/Toronto'),
    });
  });

  it('miles: the typed value is converted to metres', async () => {
    const { calls } = open(
      [],
      { 'POST /odometer': () => ({ status: 201, body: reading(9, 'year_end', 1, 1) }) },
      settingsFixture({ distance_unit: 'mi' }),
    );
    await screen.findByLabelText('Odometer (mi)');
    pick(screen.getByLabelText('Reading'), 'year_end');
    fireEvent.change(screen.getByLabelText('Odometer (mi)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reading' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const body = calls.find((c) => c.method === 'POST')!.body as {
      reading_m: number;
      kind: string;
    };
    expect(body).toMatchObject({ kind: 'year_end', reading_m: 160_934 });
  });

  it('refuses a non-number and a future date without calling the server', async () => {
    const { calls } = open();
    await screen.findByLabelText('Odometer (km)');
    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reading' }));
    expect(await screen.findByText('Enter the odometer as a number of km.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reading' }));
    expect(await screen.findByText('The date cannot be in the future.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('deletes a fiscal-year reading and reads the list again', async () => {
    const rows = [reading(1, 'year_start', 12_480_000, JAN_1)];
    const { calls } = open(rows, {
      'DELETE /odometer/1': () => {
        rows.length = 0;
        return { status: 204 };
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getAllByText('No readings.').length).toBe(2));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('asks for a vehicle choice only when there are several', async () => {
    open([], {}, settingsFixture(), [vehicle(1, 'Corolla'), vehicle(2, 'Bike')]);
    expect(await screen.findByLabelText('Vehicle')).toBeTruthy();
    cleanup();
    open();
    await screen.findByLabelText('Odometer (km)');
    expect(screen.queryByLabelText('Vehicle')).toBeNull();
  });

  it('Canada: shows the CRA note and prompts for a missing year start', async () => {
    open([reading(2, 'year_end', 11_900_000, DEC_31)]);
    await screen.findByText('11900.0 km');
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('CRA asks for the odometer reading at the start and end');
    expect(note.textContent).toContain('no year-start reading for 2026');
    expect(note.textContent).toContain('base year');
    expect(note.textContent).toContain('10%');
  });

  it('Canada: no prompt once this year has a start reading; other countries get no CRA text', async () => {
    open([reading(1, 'year_start', 12_480_000, JAN_1)]);
    await screen.findByText('12480.0 km');
    expect(screen.getByRole('note').textContent).not.toContain('no year-start reading');
    cleanup();
    open([], {}, settingsFixture({ country: 'US', logbook: null }));
    await screen.findByLabelText('Odometer (km)');
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/CRA/)).toBeNull();
  });

  it('the note comes from the logbook data, never from the country code', async () => {
    const ours = { readings: 'Some office asks for readings.', notes: ['Keep them.'] };
    open([], {}, settingsFixture({ country: 'US', logbook: ours }));
    expect((await screen.findByRole('note')).textContent).toContain(
      'Some office asks for readings.',
    );
    expect(screen.getByText('Keep them.')).toBeTruthy();
    cleanup();
    open([], {}, settingsFixture({ country: 'CA', logbook: null }));
    expect(await screen.findByText(/Readings are optional/)).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('says so when there is no vehicle', async () => {
    open([], {}, settingsFixture(), []);
    expect(await screen.findByText(/no vehicle yet/)).toBeTruthy();
  });

  it('pure helpers', () => {
    expect(toMetres('12,480.5', 'km')).toBe(12_480_500);
    expect(toMetres('1', 'mi')).toBe(1609);
    expect(toMetres('-1', 'km')).toBeNull();
    expect(toMetres('', 'km')).toBeNull();
    expect(startOfLocalDay('2026-01-01', 'America/Toronto')).toBe(JAN_1);
    // Across a daylight-saving change (Toronto 2026-03-08, offset -5 to -4).
    expect(startOfLocalDay('2026-03-09', 'America/Toronto')).toBe(
      Date.parse('2026-03-09T04:00:00Z'),
    );
    expect(startOfLocalDay('2026-03-09', 'Pacific/Auckland')).toBe(
      Date.parse('2026-03-08T11:00:00Z'),
    );
  });
});
