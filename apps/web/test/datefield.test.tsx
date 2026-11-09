// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        ...signedIn(
          settingsFixture({ modules: { maintenance: true, tax: false }, week_start: weekStart }),
        ),
        'GET /vehicles': () => ({
          body: [{ id: 1, name: 'Corolla', kind: 'car', created_at: 1, archived_at: null }],
        }),
        'GET /vehicles/1/maintenance': () => ({ body: [] }),
        'POST /vehicles/1/maintenance': ({ body }) => ({ status: 201, body }),
      },
      '/vehicles',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Service log' }));
    await screen.findByText('No service entries yet.');
    return s;
  }
  const button = () => dateButton('Service date');
  async function add(s: Awaited<ReturnType<typeof open>>) {
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    return (s.calls.find((c) => c.method === 'POST')?.body as { serviced_on: string }).serviced_on;
  }

  it('is a button named by its label and the day, today for the driver; no date input', async () => {
    await open();
    expect(button().getAttribute('aria-label')).toBeNull();
    expect(screen.getByRole('button', { name: 'Service date Nov 7, 2026' })).toBe(button());
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Service date' })).toBeNull();
  });

  it('opens on click, picks a day, closes and sends YYYY-MM-DD', async () => {
    const s = await open();
    fireEvent.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Service date' });
    fireEvent.click(within(dialog).getByRole('button', { name: /November 3rd, 2026/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button().textContent).toBe('Nov 3, 2026');
    expect(await add(s)).toBe('2026-11-03');
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
    pickDate('Service date', '2024-02-29');
    expect(button().textContent).toBe('Feb 29, 2024');
    expect(await add(s)).toBe('2024-02-29');
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
