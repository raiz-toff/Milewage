// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateToIso, formatDay, isoToDate, parseDay } from '../src/dateText';
import { renderApp, settingsFixture, signedIn } from './support/kit';

describe('typed days (dateText)', () => {
  it('reads ISO, the locale order and month names, and refuses what is not a day', () => {
    expect(parseDay('2026-11-07', 'en-CA')).toBe('2026-11-07');
    expect(parseDay('Nov 7, 2026', 'en-CA')).toBe('2026-11-07');
    expect(parseDay('7 November 2026', 'en-GB')).toBe('2026-11-07');
    expect(parseDay('sept 3rd 2026', 'en-US')).toBe('2026-09-03');
    expect(parseDay('11/7/2026', 'en-US')).toBe('2026-11-07');
    expect(parseDay('7/11/2026', 'en-GB')).toBe('2026-11-07');
    for (const bad of ['2026-02-30', '11/7/26', 'Nov 2026', 'Foo 7 2026', '', 'tomorrow']) {
      expect(parseDay(bad, 'en-CA')).toBeNull();
    }
  });

  it('formats for the locale and keeps the day across daylight-saving changes', () => {
    expect(formatDay('2026-11-07', 'en-CA')).toBe('Nov 7, 2026');
    expect(formatDay('2026-11-07', 'en-GB')).toBe('7 Nov 2026');
    for (const d of ['2026-03-08', '2026-03-29', '2026-11-01', '2026-01-01', '2026-12-31']) {
      expect(dateToIso(isoToDate(d)!)).toBe(d);
    }
  });
});

describe('date field (shadcn Calendar in a Popover)', () => {
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
  const field = () => screen.getByLabelText<HTMLInputElement>('Service date');
  const button = () => screen.getByRole('button', { name: 'Open calendar: Service date' });
  async function add(s: Awaited<ReturnType<typeof open>>) {
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    return (s.calls.find((c) => c.method === 'POST')?.body as { serviced_on: string }).serviced_on;
  }

  it('is a text field showing today for the driver, with a calendar button instead of a native date input', async () => {
    await open();
    expect(field().type).toBe('text');
    expect(field().value).toBe('Nov 7, 2026');
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('opens on click, picks a day, closes and sends YYYY-MM-DD', async () => {
    const s = await open();
    fireEvent.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Service date' });
    fireEvent.click(within(dialog).getByRole('button', { name: /November 3rd, 2026/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(field().value).toBe('Nov 3, 2026');
    expect(await add(s)).toBe('2026-11-03');
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

  it('takes a typed day, in ISO or the way it is shown', async () => {
    const s = await open();
    fireEvent.change(field(), { target: { value: 'Oct 15, 2026' } });
    fireEvent.blur(field());
    expect(field().value).toBe('Oct 15, 2026');
    expect(await add(s)).toBe('2026-10-15');
  });

  it('says so when the typed text is not a day', async () => {
    await open();
    fireEvent.change(field(), { target: { value: '2026-02-30' } });
    act(() => {
      fireEvent.blur(field());
    });
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Not a date. Type it like Nov 7, 2026 or 2026-11-07.')).toBeTruthy();
  });
});
