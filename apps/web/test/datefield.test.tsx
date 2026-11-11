// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startOfDay } from '../src/days';
import { dateButton, pickDate, renderApp, settingsFixture, signedIn } from './support/kit';

describe('date field (shadcn Date Picker: a button and a Calendar in a Popover)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T15:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  async function open(weekStart: 0 | 1 = 1) {
    const s = renderApp(
      {
        ...signedIn(settingsFixture({ week_start: weekStart })),
        'GET /vehicles': () => ({
          body: [{ id: 1, name: 'Corolla', kind: 'car', created_at: 1, archived_at: null }],
        }),
        'GET /odometer': () => ({ body: [] }),
        'POST /odometer': ({ body }) => ({ status: 201, body }),
      },
      '/odometer',
    );
    await screen.findByLabelText('Odometer (km)');
    return s;
  }
  const button = () => dateButton('Date');
  /** Adds a reading and gives back the day it was recorded on (local midnight). */
  async function add(s: Awaited<ReturnType<typeof open>>) {
    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reading' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    return (s.calls.find((c) => c.method === 'POST')?.body as { recorded_at: number }).recorded_at;
  }
  const midnight = (day: string) => startOfDay(day, 'America/Toronto');

  it('is a button named by its label and the day, today for the driver; no date input', async () => {
    await open();
    expect(button().getAttribute('aria-label')).toBeNull();
    expect(screen.getByRole('button', { name: 'Date Nov 7, 2026' })).toBe(button());
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Date' })).toBeNull();
  });

  it('opens on click, picks a day, closes and sends that day', async () => {
    const s = await open();
    fireEvent.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Date' });
    fireEvent.click(within(dialog).getByRole('button', { name: /November 3rd, 2026/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button().textContent).toBe('Nov 3, 2026');
    expect(await add(s)).toBe(midnight('2026-11-03'));
  });

  it('has month and year dropdowns (shadcn captionLayout="dropdown") to reach a far day', async () => {
    const s = await open();
    fireEvent.click(button());
    const dialog = await screen.findByRole('dialog');
    const [month, year] = [...dialog.querySelectorAll('select')];
    expect(month?.getAttribute('aria-label')).toMatch(/month/i);
    expect(year?.getAttribute('aria-label')).toMatch(/year/i);
    const years = [...year!.querySelectorAll('option')].map((o) => Number(o.value));
    expect([years[0], years.at(-1)]).toEqual([2016, 2031]);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    pickDate('Date', '2024-02-29');
    expect(button().textContent).toBe('Feb 29, 2024');
    expect(await add(s)).toBe(midnight('2024-02-29'));
  });

  it('starts the week on the driver’s week start', async () => {
    await open(1);
    fireEvent.click(button());
    const first = async () =>
      (await screen.findByRole('dialog')).querySelector('th')?.getAttribute('aria-label');
    expect(await first()).toBe('Monday');
    cleanup();
    await open(0);
    fireEvent.click(button());
    expect(await first()).toBe('Sunday');
  });

  it('Escape closes the calendar and returns focus to its button', async () => {
    await open();
    fireEvent.click(button());
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button()));
  });
});
