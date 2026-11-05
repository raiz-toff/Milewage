import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { weekdayBit } from '../src/routes/schedule';
import { serverModules } from '../src/index';
import { resolveModuleConfig } from '@milewage/shared';
import { harness, type Harness } from './support';

// 18 section 9: the schedule module. The clock is Friday 2027-01-15.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness({ schedule: true });
  ({ cookie } = await h.signUp());
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const week = '/schedule?from=2027-01-11&to=2027-01-17';
const MON_WED_FRI = 0b0010101;

describe('default and modules', () => {
  test('the module is off by default, and a plain configuration leaves it off', () => {
    const schedule = serverModules.find((m) => m.name === 'schedule')!;
    expect(schedule.defaultEnabled).toBe(false);
    expect(resolveModuleConfig(serverModules, {}, {}).schedule).toBe(false);
    expect(resolveModuleConfig(serverModules, { modules: { schedule: true } }, {}).schedule).toBe(
      true,
    );
    expect(resolveModuleConfig(serverModules, {}, { MILEWAGE_MODULE_SCHEDULE: '1' }).schedule).toBe(
      true,
    );
  });

  test('off: no routes, the flag is false (the matrix covers every operation)', async () => {
    const off = harness({ schedule: false });
    try {
      const { cookie: c } = await off.signUp();
      expect((await off.call('GET', week, undefined, { cookie: c })).statusCode).toBe(404);
      expect(
        (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules.schedule,
      ).toBe(false);
    } finally {
      await off.close();
    }
  });
});

describe('entries', () => {
  test('create, list in the window, change, delete; the same start twice is refused', async () => {
    const made = await send('POST', '/schedule/entries', {
      planned_on: '2027-01-12',
      start_time: '17:00',
      end_time: '22:00',
      platform: 'doordash',
      vehicle_id: 1,
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      planned_on: '2027-01-12',
      remind: true,
      shift_id: null,
      template_id: null,
    });
    const dup = await send('POST', '/schedule/entries', {
      planned_on: '2027-01-12',
      start_time: '17:00',
      end_time: '20:00',
    });
    expect([dup.statusCode, dup.json().errors[0].path]).toEqual([422, '/start_time']);
    expect((await send('GET', week)).json().entries).toHaveLength(1);
    expect((await send('GET', '/schedule?from=2027-02-01&to=2027-02-07')).json().entries).toEqual(
      [],
    );
    const p = await send('PATCH', `/schedule/entries/${made.json().id}`, {
      end_time: '23:30',
      remind: false,
    });
    expect(p.json()).toMatchObject({ end_time: '23:30', remind: false });
    expect((await send('DELETE', `/schedule/entries/${made.json().id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `/schedule/entries/${made.json().id}`)).statusCode).toBe(404);
  });

  test('validation: times, dates, references, windows', async () => {
    const ok = { planned_on: '2027-01-12', start_time: '17:00', end_time: '22:00' };
    for (const bad of [
      { start_time: '25:00' },
      { end_time: '9:00' },
      { planned_on: '2027-02-30' },
      { vehicle_id: 9 },
      { platform: 'nosuch' },
      { x: 1 },
    ]) {
      expect(
        (await send('POST', '/schedule/entries', { ...ok, ...bad })).statusCode,
        JSON.stringify(bad),
      ).toBe(422);
    }
    for (const q of ['?from=2027-01-17&to=2027-01-11', '?from=2026-01-01&to=2027-12-31', '']) {
      expect((await send('GET', `/schedule${q}`)).statusCode, q).toBe(422);
    }
    expect((await h.call('GET', week)).statusCode).toBe(401);
  });

  test('a phone reads the plan but cannot change it', async () => {
    const phone = await h.pair(cookie);
    expect((await h.call('GET', week, undefined, phone.auth)).statusCode).toBe(200);
    expect(
      (
        await h.call(
          'POST',
          '/schedule/entries',
          { planned_on: '2027-01-12', start_time: '17:00', end_time: '22:00' },
          phone.auth,
        )
      ).statusCode,
    ).toBe(403);
  });

  test('a worked day is linked to its shift by date, never required', async () => {
    const e = (
      await send('POST', '/schedule/entries', {
        planned_on: '2027-01-14',
        start_time: '17:00',
        end_time: '22:00',
      })
    ).json();
    expect((await send('GET', week)).json().entries[0].shift_id).toBeNull();
    const id = (
      await send('POST', '/shifts', {
        client_id: '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11',
        vehicle_id: 1,
        started_at: h.clock.t,
      })
    ).json().id;
    h.db
      .prepare(
        "UPDATE shifts SET status = 'ended', ended_at = started_at + 3600000, local_date = '2027-01-14' WHERE id = ?",
      )
      .run(id);
    expect(
      (await send('GET', week)).json().entries.find((x: { id: number }) => x.id === e.id).shift_id,
    ).toBe(id);
  });
});

describe('templates, expansion and off days', () => {
  test('a template expands only when asked, skips off days and entries that exist, and twice makes nothing new', async () => {
    const t = await send('POST', '/schedule/templates', {
      label: 'Evenings',
      weekdays: MON_WED_FRI,
      start_time: '17:00',
      end_time: '22:00',
      platform: 'ubereats',
    });
    expect(t.statusCode).toBe(201);
    expect(t.json()).toMatchObject({ weekdays: MON_WED_FRI, active: true });
    expect((await send('GET', week)).json().entries).toEqual([]); // nothing is generated by itself
    await send('PUT', '/schedule/off-days/2027-01-13', { note: 'family' });
    await send('POST', '/schedule/entries', {
      planned_on: '2027-01-15',
      start_time: '17:00',
      end_time: '21:00',
    }); // Friday, same start
    const ex = await send('POST', '/schedule/expand', { from: '2027-01-11', to: '2027-01-17' });
    expect(ex.json()).toEqual({ created: 1 }); // Monday; Wednesday is off, Friday exists
    expect(
      (await send('POST', '/schedule/expand', { from: '2027-01-11', to: '2027-01-17' })).json(),
    ).toEqual({ created: 0 });
    const list = (await send('GET', week)).json();
    expect(list.entries.map((x: { planned_on: string }) => x.planned_on)).toEqual([
      '2027-01-11',
      '2027-01-15',
    ]);
    expect(list.off_days).toEqual([{ off_on: '2027-01-13', note: 'family' }]);
    await send('PATCH', `/schedule/templates/${t.json().id}`, { active: false });
    await send('DELETE', '/schedule/off-days/2027-01-13');
    expect(
      (await send('POST', '/schedule/expand', { from: '2027-01-11', to: '2027-01-17' })).json(),
    ).toEqual({ created: 0 }); // inactive
  });

  test('deleting a template keeps what it made; weekday bits start on Monday', async () => {
    const t = (
      await send('POST', '/schedule/templates', {
        label: 'Sat',
        weekdays: 0b0100000,
        start_time: '10:00',
        end_time: '14:00',
      })
    ).json();
    await send('POST', '/schedule/expand', { from: '2027-01-16', to: '2027-01-16' });
    expect((await send('DELETE', `/schedule/templates/${t.id}`)).statusCode).toBe(204);
    expect((await send('GET', week)).json().entries).toMatchObject([
      { planned_on: '2027-01-16', template_id: null },
    ]);
    expect([weekdayBit('2027-01-11'), weekdayBit('2027-01-16'), weekdayBit('2027-01-17')]).toEqual([
      1, 32, 64,
    ]);
    for (const bad of [{ weekdays: 0 }, { weekdays: 128 }, { label: '' }]) {
      expect(
        (
          await send('POST', '/schedule/templates', {
            label: 'x',
            weekdays: 1,
            start_time: '10:00',
            end_time: '11:00',
            ...bad,
          })
        ).statusCode,
      ).toBe(422);
    }
    expect((await send('PUT', '/schedule/off-days/2027-02-30', {})).statusCode).toBe(422);
  });
});
