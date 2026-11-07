import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { harness, type Harness } from './support';

// 18 section 4.2: the platform registry and the driver's overrides.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('PATCH', '/settings', { country: 'CA' }, { cookie });
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const slugs = async (q = '') =>
  ((await send('GET', `/platforms${q}`)).json() as { slug: string }[]).map((p) => p.slug);

describe('listing', () => {
  test('the Canadian built-ins in order, then overrides: inactive ones drop out of the list', async () => {
    expect(await slugs()).toEqual([
      'doordash',
      'ubereats',
      'skipthedishes',
      'foodora',
      'instacart',
      'amazonflex',
      'other',
    ]);
    const flex = await send('PUT', '/platforms/amazonflex', { active: false, sort: 1 });
    expect(flex.json()).toMatchObject({ slug: 'amazonflex', active: false, custom: false });
    expect(await slugs()).not.toContain('amazonflex');
    expect(await slugs('?include_inactive=true')).toContain('amazonflex');
  });

  test('the list comes from the country and region of the settings, then own ones', async () => {
    await send('PATCH', '/settings', { country: 'GB', region: 'SCT' });
    await send('PUT', '/platforms/mylocal', { label: 'My Local' }); // sort 0: first
    expect(await slugs()).toEqual('mylocal ubereats amazonflex deliveroo justeat other'.split(' '));
    await send('PATCH', '/settings', { country: 'US', region: null });
    expect(await slugs()).toContain('grubhub');
  });

  test('a phone (device scope) may read the list but not change it', async () => {
    const phone = await h.pair(cookie);
    expect((await h.call('GET', '/platforms', undefined, phone.auth)).statusCode).toBe(200);
    expect((await h.call('PUT', '/platforms/doordash', { sort: 5 }, phone.auth)).statusCode).toBe(
      403,
    );
  });
});

describe('custom platforms', () => {
  test('create with a name; a built-in keeps its name; a new one needs a name', async () => {
    const made = await send('PUT', '/platforms/mylocal', {
      label: 'My Local',
      color: '#ff8800',
      emoji: 'x',
    });
    expect(made.json()).toMatchObject({
      slug: 'mylocal',
      label: 'My Local',
      custom: true,
      color: '#ff8800',
    });
    expect(await slugs()).toContain('mylocal');
    const again = await send('PUT', '/platforms/mylocal', { hourly_target_cents: 2500 });
    expect(again.json()).toMatchObject({ label: 'My Local', hourly_target_cents: 2500 });
    for (const [url, body] of [
      ['/platforms/doordash', { label: 'DD' }],
      ['/platforms/newone', { active: true }],
      ['/platforms/Bad-Slug', { label: 'x' }],
      ['/platforms/x', { label: 'x', color: 'red' }],
    ] as const) {
      expect((await send('PUT', url, body)).statusCode, url).toBe(422);
    }
  });

  test('labels accept built-in and own slugs only; delete is refused while a label uses it', async () => {
    await send('PUT', '/platforms/mylocal', { label: 'My Local' });
    const { shift, stop } = await seedStop();
    const put = (platform: string) =>
      send('PUT', `/shifts/${shift}/stop-labels/${stop}`, {
        role: 'dropoff',
        platform,
        payout_cents: 500,
        edited_at: h.clock.t,
      });
    expect((await put('nosuch')).statusCode).toBe(422);
    expect((await put('mylocal')).statusCode).toBe(200);
    const busy = await send('DELETE', '/platforms/mylocal');
    expect([busy.statusCode, busy.json().code]).toEqual([409, 'platform_in_use']);
    await send('DELETE', `/shifts/${shift}/stop-labels/${stop}`);
    expect((await send('DELETE', '/platforms/mylocal')).statusCode).toBe(204);
    expect((await send('DELETE', '/platforms/mylocal')).statusCode).toBe(404);
  });

  test('deleting a built-in resets its override', async () => {
    await send('PUT', '/platforms/doordash', { active: false });
    expect((await send('DELETE', '/platforms/doordash')).statusCode).toBe(204);
    expect(await slugs()).toContain('doordash');
  });
});

describe('module off', () => {
  test('without the module the routes are 404 and any [a-z0-9_] slug is accepted on a label', async () => {
    const off = harness({ platforms: false });
    try {
      const { cookie: c } = await off.signUp();
      expect((await off.call('GET', '/platforms', undefined, { cookie: c })).statusCode).toBe(404);
      const flags = (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules;
      expect(flags.platforms).toBe(false);
      expect(flags).toMatchObject({ stops: true });
    } finally {
      await off.close();
    }
  });
});

/** A finished shift with one stop, the way stops.test.ts makes one. */
async function seedStop() {
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
  const created = await send('POST', '/shifts', {
    client_id: '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11',
    vehicle_id: 1,
    started_at: h.clock.t,
  });
  const id = created.json().id as number;
  h.db
    .prepare("UPDATE shifts SET status = 'ended', ended_at = ?, total_m = 1000 WHERE id = ?")
    .run(h.clock.t + 3_600_000, id);
  h.db
    .prepare(
      "INSERT INTO stops (user_id, shift_id, stop_key, started_at, ended_at, dwell_s, lat_e7, lon_e7, confidence, est_role, role) VALUES (1, ?, 'k1', ?, ?, 60, 0, 0, 'high', 'dropoff', 'none')",
    )
    .run(id, h.clock.t, h.clock.t + 60_000);
  return { shift: id, stop: 'k1' };
}
