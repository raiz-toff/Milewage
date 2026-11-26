// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { startOfDay } from '../src/days';
import { shift, trip } from './support/fixtures';
import {
  confirmNo,
  confirmYes,
  menu,
  pick,
  renderApp,
  settingsFixture,
  signedIn,
} from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const vehicle = (id: number, name: string) => ({
  id,
  name,
  kind: 'car',
  created_at: 1,
  archived_at: null,
});

function open(theShift: object = shift(), extra: Record<string, Handler> = {}) {
  return renderApp(
    {
      ...signedIn(settingsFixture()),
      'GET /shifts': () => ({ body: { items: [], next_cursor: null } }),
      'GET /summary': () => ({ body: {} }),
      'GET /vehicles': () => ({ body: [vehicle(1, 'Corolla'), vehicle(2, 'Bike')] }),
      'GET /shifts/1': () => ({ body: theShift }),
      'GET /shifts/1/trips': () => ({ body: [trip(1)] }),
      'GET /shifts/1/stops': () => ({ body: [] }),
      'GET /odometer': () => ({ body: [] }),
      ...extra,
    },
    '/shifts/1',
  );
}

describe('delete a shift (spec 001 A2)', () => {
  it('asks first, says what goes, then deletes with the deliberate yes and goes to the list', async () => {
    const s = open(shift(), { 'DELETE /shifts/1': () => ({ status: 204 }) });
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    menu('this shift', 'Delete shift');
    const dialog = await screen.findByRole('dialog', { name: 'Delete this shift?' });
    expect(dialog.textContent).toMatch(/5\.0 km/);
    expect(dialog.textContent).toMatch(/trips/);
    expect(dialog.textContent).toMatch(/cannot be undone/);
    await confirmNo();
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false);

    menu('this shift', 'Delete shift');
    await confirmYes('Delete shift');
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
    const sent = s.calls.find((c) => c.method === 'DELETE')!;
    expect([sent.path, sent.query]).toEqual(['/shifts/1', '?confirm_recent=true']);
    // After deleting, the shifts list.
    expect(await screen.findByRole('heading', { name: 'Shifts' })).toBeTruthy();
  });

  it("keeps the dialog open with the server's reason when it refuses", async () => {
    open(shift(), {
      'DELETE /shifts/1': () => ({
        status: 409,
        body: { code: 'shift_not_ended', detail: 'End the shift before deleting it.' },
      }),
    });
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    menu('this shift', 'Delete shift');
    await confirmYes('Delete shift');
    const dialog = await screen.findByRole('dialog', { name: 'Delete this shift?' });
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'End the shift before deleting it.',
    );
  });

  it('a reviewed shift can be deleted but not edited; a running one is ended first', async () => {
    open(shift({ status: 'finalized' }));
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    expect(screen.getByRole('button', { name: 'Delete shift' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit times and vehicle' })).toBeNull();
    cleanup();

    open(shift({ status: 'active', ended_at: null }));
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    expect(screen.queryByRole('menuitem', { name: 'Delete shift' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for this shift' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change vehicle' })).toBeTruthy();
  });
});

describe('a shift stuck active (spec 001 A3)', () => {
  it('End now ends it at this moment, then the shift is an ended one', async () => {
    let ended = false;
    const s = open(undefined, {
      'GET /shifts/1': () => ({
        body: ended ? shift() : shift({ status: 'active', ended_at: null }),
      }),
      'POST /shifts/1/end': () => {
        ended = true;
        return { body: shift() };
      },
    });
    const card = await screen.findByRole('region', { name: 'In progress' });
    fireEvent.click(within(card).getByRole('button', { name: 'End now' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST')).toBe(true));
    const body = s.calls.find((c) => c.path === '/shifts/1/end')!.body as { ended_at: number };
    expect(Math.abs(body.ended_at - Date.now())).toBeLessThan(60_000);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'In progress' })).toBeNull());
  });

  it('shows why when the server refuses', async () => {
    open(shift({ status: 'active', ended_at: null }), {
      'POST /shifts/1/end': () => ({
        status: 422,
        body: { code: 'validation_failed', detail: 'The request is not valid.' },
      }),
    });
    const card = await screen.findByRole('region', { name: 'In progress' });
    fireEvent.click(within(card).getByRole('button', { name: 'End now' }));
    expect((await within(card).findByRole('alert')).textContent).toMatch(/not valid/);
  });
});

describe('correct a shift (spec 001 A4, A5)', () => {
  it('sends only the end time that changed, in the driver time zone, and shows the new answer', async () => {
    let current = shift();
    const s = open(undefined, {
      'GET /shifts/1': () => ({ body: current }),
      'PATCH /shifts/1': ({ body }) => {
        current = shift(body as object);
        return { body: current };
      },
    });
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    menu('this shift', 'Edit times and vehicle');
    const form = screen.getByRole('form', { name: 'Edit shift' });
    expect((within(form).getByLabelText('Start time') as HTMLInputElement).value).toBe('17:13');
    expect((within(form).getByLabelText('End time') as HTMLInputElement).value).toBe('18:13');
    fireEvent.change(within(form).getByLabelText('End time'), { target: { value: '19:30' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit shift' })).toBeNull());
    expect(s.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      ended_at: startOfDay('2023-11-14', 'America/Toronto') + (19 * 60 + 30) * 60_000,
    });
  });

  it('refuses an end before the start without calling the server', async () => {
    const s = open();
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    menu('this shift', 'Edit times and vehicle');
    const form = screen.getByRole('form', { name: 'Edit shift' });
    fireEvent.change(within(form).getByLabelText('End time'), { target: { value: '16:00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'The shift must end after it starts.',
    );
    expect(s.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it("shows the server's refusal and keeps the form", async () => {
    open(undefined, {
      'PATCH /shifts/1': () => ({
        status: 409,
        body: { code: 'not_recomputable', detail: 'The raw points of this shift were archived.' },
      }),
    });
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    menu('this shift', 'Edit times and vehicle');
    const form = screen.getByRole('form', { name: 'Edit shift' });
    fireEvent.change(within(form).getByLabelText('End time'), { target: { value: '19:30' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect((await within(form).findByRole('alert')).textContent).toMatch(/archived/);
  });

  it('changes the vehicle alone, and Cancel sends nothing', async () => {
    const s = open(undefined, {
      'PATCH /shifts/1': ({ body }) => ({ body: shift(body as object) }),
    });
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    menu('this shift', 'Edit times and vehicle');
    fireEvent.click(
      within(screen.getByRole('form', { name: 'Edit shift' })).getByRole('button', {
        name: 'Cancel',
      }),
    );
    expect(screen.queryByRole('form', { name: 'Edit shift' })).toBeNull();
    expect(s.calls.some((c) => c.method === 'PATCH')).toBe(false);

    menu('this shift', 'Edit times and vehicle');
    const form = screen.getByRole('form', { name: 'Edit shift' });
    pick(await within(form).findByLabelText('Vehicle'), '2');
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ vehicle_id: 2 });
  });

  it('a running shift offers only the vehicle', async () => {
    open(shift({ status: 'active', ended_at: null }));
    await screen.findByRole('heading', { name: 'Tuesday, Nov 14, 2023' });
    fireEvent.click(screen.getByRole('button', { name: 'Change vehicle' }));
    const form = screen.getByRole('form', { name: 'Edit shift' });
    expect(within(form).queryByLabelText('Start time')).toBeNull();
    expect(await within(form).findByLabelText('Vehicle')).toBeTruthy();
  });
});
