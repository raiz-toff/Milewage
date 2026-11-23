// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { isVeryShort } from '../src/shift/checks';
import { shift, trip } from './support/fixtures';
import { confirmYes, renderApp, settingsFixture, signedIn } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const T0 = 1_700_000_000_000;
const noEarnings = { entries: [], labels: [], effective: [] };

function open(theShift: object, extra: Record<string, Handler> = {}, trips: object[] = []) {
  return renderApp(
    {
      ...signedIn(settingsFixture()),
      'GET /shifts/1': () => ({ body: theShift }),
      'GET /shifts/1/trips': () => ({ body: trips }),
      'GET /shifts/1/stops': () => ({ body: [] }),
      'GET /shifts/1/earnings': () => ({ body: noEarnings }),
      'GET /odometer': () => ({ body: [] }),
      'GET /expenses': () => ({ body: { items: [], next_cursor: null } }),
      ...extra,
    },
    '/shifts/1',
  );
}
const mistake = /Started by mistake\?/;
const short = (over: object = {}) =>
  shift({ ended_at: T0 + 40_000, total_m: 0, active_m: 0, deadhead_m: 0, ...over });

describe('very short shift (spec 001 C1)', () => {
  it('says how long and how far, and Delete goes through the shift delete confirm', async () => {
    const s = open(short(), { 'DELETE /shifts/1': () => ({ status: 204 }) });
    const note = (await screen.findByText(mistake)).closest('[role="note"]') as HTMLElement;
    expect(note.textContent).toContain('This shift is 40 seconds and 0.0 km. Started by mistake?');
    fireEvent.click(within(note).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this shift?' });
    expect(dialog.textContent).toMatch(/cannot be undone/);
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false); // never without the yes
    await confirmYes('Delete shift');
    await waitFor(() =>
      expect(s.calls.find((c) => c.method === 'DELETE')?.query).toBe('?confirm_recent=true'),
    );
  });

  it('boundaries: 119 s and 159 m are very short, 120 s and 160 m are not', () => {
    const none = { earnings: false, costs: false, manualTrips: false };
    const ok = (over: object) => isVeryShort(short(over) as never, none);
    expect(ok({ ended_at: T0 + 119_000 })).toBe(true);
    expect(ok({ ended_at: T0 + 120_000 })).toBe(false);
    expect(ok({ total_m: 159 })).toBe(true);
    expect(ok({ total_m: 160 })).toBe(false);
    expect(ok({ status: 'active', ended_at: null })).toBe(false);
    for (const k of ['earnings', 'costs', 'manualTrips']) {
      expect(isVeryShort(short() as never, { ...none, [k]: true })).toBe(false);
    }
  });

  it('shows nothing for a longer shift, one with a manual trip, or earnings', async () => {
    open(short({ ended_at: T0 + 120_000 }));
    await screen.findByRole('region', { name: 'What happened' });
    expect(screen.queryByText(mistake)).toBeNull();
    cleanup();

    open(short(), {}, [trip(1, { source: 'manual', distance_m: 20 })]);
    await screen.findByRole('list', { name: 'Timeline' });
    await waitFor(() => expect(screen.queryByText(mistake)).toBeNull());
    cleanup();

    open(short(), {
      'GET /shifts/1/earnings': () => ({
        body: {
          ...noEarnings,
          effective: [
            {
              platform: 'doordash',
              total_cents: 500,
              gross_cents: 500,
              tips_cents: 0,
              bonus_cents: 0,
              fees_cents: 0,
              adjustments_cents: 0,
              tax_withheld_cents: 0,
              orders: 1,
              source: 'entered',
            },
          ],
        },
      }),
    });
    await screen.findAllByText('$5.00', { exact: false });
    await waitFor(() => expect(screen.queryByText(mistake)).toBeNull());
  });
});

describe('overlap (spec 001 C2)', () => {
  it('names the other shift in the checks, with a link to it', async () => {
    open(
      shift({
        flags: [{ code: 'shift_overlap', severity: 'review', detail: { at: null, detail: '2' } }],
      }),
      { 'GET /shifts/2': () => ({ body: shift({ id: 2, local_date: '2023-11-13' }) }) },
      [trip(1)],
    );
    const link = await screen.findByRole('link', { name: /the shift on Mon, Nov 13/ });
    expect(link.getAttribute('href')).toBe('/shifts/2');
    expect(link.closest('li')?.textContent).toMatch(/^This shift overlaps the shift on/);
    expect(link.closest('li')?.textContent).toContain('Review');
  });
});

describe('stale active shift (spec 001 C3)', () => {
  it('a notice with End now ends the shift at this moment', async () => {
    const flags = [
      { code: 'stale_active_shift', severity: 'review', detail: { at: null, detail: null } },
    ];
    const s = open(shift({ status: 'active', ended_at: null, total_m: null, flags }), {
      'POST /shifts/1/end': ({ body }) => ({ body: shift({ ...(body as object) }) }),
    });
    const note = (await screen.findByText(/nothing has been recorded since/)).closest(
      '[role="note"]',
    ) as HTMLElement;
    fireEvent.click(within(note).getByRole('button', { name: 'End now' }));
    await waitFor(() =>
      expect(s.calls.some((c) => c.method === 'POST' && c.path === '/shifts/1/end')).toBe(true),
    );
  });

  it('a running shift that is not stale has no notice', async () => {
    open(shift({ status: 'active', ended_at: null, total_m: null }));
    await screen.findByRole('region', { name: 'In progress' });
    expect(screen.queryByText(/nothing has been recorded since/)).toBeNull();
  });
});

describe('midnight (spec 001 C5)', () => {
  it('says which day a shift that ends the next day counts on', async () => {
    // 17:13 on Nov 14 in Toronto, ended 6:13 on Nov 15.
    open(shift({ ended_at: T0 + 13 * 3_600_000 }), {}, [trip(1)]);
    const caption = await screen.findByText(/This shift ended on/);
    expect(caption.textContent).toBe(
      'This shift ended on Wed, Nov 15. It counts on Tue, Nov 14, the day it started.',
    );
  });

  it('has no caption when it ends the same day', async () => {
    open(shift(), {}, [trip(1)]);
    await screen.findByRole('list', { name: 'Timeline' });
    expect(screen.queryByText(/This shift ended on/)).toBeNull();
  });
});
