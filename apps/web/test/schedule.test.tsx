// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { monthGrid } from '../src/pages/Schedule';
import { formatClock, formatTime } from '../src/format';
import { pick, renderApp, settingsFixture, signedIn, DASHBOARD } from './support/kit';

afterEach(cleanup);

const today = new Date().toISOString().slice(0, 10);
const entry = (over: object = {}) => ({
  id: 1,
  planned_on: today,
  start_time: '17:00',
  end_time: '22:00',
  platform: null,
  vehicle_id: null,
  template_id: null,
  shift_id: null,
  remind: true,
  ...over,
});

function open(enabled = true, time_format: '12h' | '24h' = '24h') {
  let data = { entries: [entry()], off_days: [] as object[], templates: [] as object[] };
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { schedule: enabled }, time_format })),
      'GET /schedule': () => ({ body: data }),
      'POST /schedule/entries': () => ({ status: 201, body: entry({ id: 2 }) }),
      'DELETE /schedule/entries/1': () => {
        data = { ...data, entries: [] };
        return { status: 204 };
      },
      ['PUT /schedule/off-days/' + today]: () => ({ body: { off_on: today, note: null } }),
      'POST /schedule/templates': () => ({ status: 201, body: { id: 3 } }),
      'POST /schedule/expand': () => ({ body: { created: 4 } }),
    },
    '/schedule',
  );
}

describe('schedule screen (module schedule)', () => {
  it('shows planned shifts on the calendar, adds one, marks an off day, removes one', async () => {
    const s = open();
    expect(await screen.findByText('17:00-22:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Plan ${today}` }));
    pick('From hour', '9');
    fireEvent.click(screen.getByRole('button', { name: 'Plan a shift' }));
    await waitFor(() =>
      expect(
        s.calls.find((c) => c.method === 'POST' && c.path === '/schedule/entries')?.body,
      ).toEqual({ planned_on: today, start_time: '09:00', end_time: '22:00' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark as off day' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: `Remove ${today} 17:00` }));
    await waitFor(() => expect(screen.queryByText('17:00-22:00')).toBeNull());
  });

  it('builds a repeating shift from the weekday boxes (bit 0 is Monday) and fills the month on request', async () => {
    const s = open();
    await screen.findByText('17:00-22:00');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Evenings' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Wed'));
    fireEvent.click(screen.getByRole('button', { name: 'Add repeating shift' }));
    await waitFor(() =>
      expect(s.calls.find((c) => c.path === '/schedule/templates')?.body).toEqual({
        label: 'Evenings',
        weekdays: 0b101,
        start_time: '17:00',
        end_time: '22:00',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fill this month from templates' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/schedule/expand')).toBe(true));
    expect(s.calls.find((c) => c.path === '/schedule/expand')?.body).toMatchObject({
      from: expect.stringMatching(/-01$/),
    });
  });

  it('with the 12h setting, shows times with AM and PM and sends 24h values', async () => {
    const s = open(true, '12h');
    expect(await screen.findByText('5:00 PM-10:00 PM')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Plan ${today}` }));
    expect(screen.getByLabelText('From hour').textContent).toBe('5');
    expect(screen.getByLabelText('From AM or PM').textContent).toBe('PM');
    pick('From hour', '9');
    pick('From AM or PM', 'am');
    pick('To minute', '30');
    fireEvent.click(screen.getByRole('button', { name: 'Plan a shift' }));
    await waitFor(() =>
      expect(
        s.calls.find((c) => c.method === 'POST' && c.path === '/schedule/entries')?.body,
      ).toEqual({ planned_on: today, start_time: '09:00', end_time: '22:30' }),
    );
  });

  it('with the 24h setting, shows 24h times and no AM or PM choice', async () => {
    open(true, '24h');
    expect(await screen.findByText('17:00-22:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Plan ${today}` }));
    expect(screen.getByLabelText('From hour').textContent).toBe('17');
    expect(screen.queryByLabelText('From AM or PM')).toBeNull();
  });

  it('formats clock strings and instants by the setting, not the browser', () => {
    expect(formatClock('00:05', '12h')).toBe('12:05 AM');
    expect(formatClock('12:00', '12h')).toBe('12:00 PM');
    expect(formatClock('17:30', '12h')).toBe('5:30 PM');
    expect(formatClock('17:30', '24h')).toBe('17:30');
    const at = Date.UTC(2026, 0, 5, 22, 30);
    expect(formatTime(at, 'UTC', '24h')).toBe('22:30');
    expect(formatTime(at, 'UTC', '12h').replace(/\s/g, ' ')).toMatch(/^10:30 [ap]\.?m\.?$/i);
  });

  it('is absent when the module is off (the default)', async () => {
    const s = open(false);
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Schedule' })).toBeNull();
    expect(s.calls.some((c) => c.path.startsWith('/schedule'))).toBe(false);
  });

  it('monthGrid pads to whole weeks and starts on the chosen day', () => {
    const mon = monthGrid(2027, 2, 1); // 1 Feb 2027 is a Monday
    expect(mon[0]![0]).toBe('2027-02-01');
    expect(mon).toHaveLength(4); // 28 days from a Monday: exactly four weeks
    expect(mon.at(-1)!.at(-1)).toBe('2027-02-28');
    const sun = monthGrid(2027, 2, 0);
    expect(sun[0]!.slice(0, 2)).toEqual([null, '2027-02-01']);
    expect(sun.at(-1)!.at(-1)).toBeNull();
    expect(sun.flat().filter(Boolean)).toHaveLength(28);
  });
});
