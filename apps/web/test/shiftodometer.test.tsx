// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { shift } from './support/fixtures';
import { renderApp, settingsFixture, signedIn } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const reading = (kind: string, reading_m: number, shift_id: number | null = 1) => ({
  id: kind === 'shift_start' ? 1 : 2,
  vehicle_id: 1,
  shift_id,
  kind,
  reading_m,
  recorded_at: 1,
});

const queries: string[] = [];
function open(rows: ReturnType<typeof reading>[], extra: Record<string, Handler> = {}, over = {}) {
  return renderApp(
    {
      ...signedIn(settingsFixture()),
      'GET /shifts/1': () => ({ body: shift(over) }),
      'GET /odometer': ({ url }) => {
        queries.push(url.search);
        return { body: rows.filter((r) => r.kind === url.searchParams.get('kind')) };
      },
      ...extra,
    },
    '/shifts/1',
  );
}

describe('odometer in shift detail', () => {
  it("asks for this shift's day and vehicle, and fills in only this shift's readings", async () => {
    const { calls } = open([
      reading('shift_start', 12_480_000),
      reading('shift_end', 99_000_000, 5), // another shift the same day
    ]);
    const start = (await screen.findByLabelText('Start (km)')) as HTMLInputElement;
    await waitFor(() => expect(start.value).toBe('12480'));
    expect((screen.getByLabelText('End (km)') as HTMLInputElement).value).toBe('');
    expect(calls.filter((c) => c.path === '/odometer').length).toBe(2);
    expect(queries.length).toBeGreaterThanOrEqual(2);
    for (const q of queries) {
      expect(q).toContain('vehicle_id=1');
      expect(q).toContain('from=2023-11-14');
      expect(q).toContain('to=2023-11-14');
    }
  });

  it('saves a reading through the shift route, in metres', async () => {
    const { calls } = open([], {
      'PUT /shifts/1/odometer/shift_end': () => ({ body: reading('shift_end', 1) }),
    });
    fireEvent.change(await screen.findByLabelText('End (km)'), { target: { value: '12,500.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save end reading' }));
    await screen.findByText('Saved.');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({ reading_m: 12_500_400 });
    expect(typeof (put.body as { recorded_at: number }).recorded_at).toBe('number');
  });

  it('refuses a non-number without a call and shows a server refusal', async () => {
    const { calls } = open([], {
      'PUT /shifts/1/odometer/shift_start': () => ({
        status: 409,
        body: { code: 'shift_finalized' },
      }),
    });
    const input = await screen.findByLabelText('Start (km)');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save start reading' }));
    expect(await screen.findByText('Enter the odometer as a number of km.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save start reading' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('a finalized shift is read-only', async () => {
    open([reading('shift_start', 1_000_000)], {}, { status: 'finalized' });
    const input = (await screen.findByLabelText('Start (km)')) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText('A finalized shift cannot be changed.')).toBeTruthy();
  });
});
