// A tiny client for the product API: first-run setup, sign-in, one vehicle, one long-running shift
// and phone pairing, so the load generator talks to the real routes with real credentials.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

export const OWNER = {
  username: 'vmtest',
  password: 'vm-tests-password',
  country: 'us',
  distance_unit: 'km',
  currency: 'usd',
  timezone: 'UTC',
};

const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

/** One request. Session routes need the cookie and, for writes, an Origin that matches the Host. */
export async function call(
  base,
  path,
  { method = 'GET', body, cookie, bearer, headers = {} } = {},
) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  if (cookie && method !== 'GET') h.origin = new URL(base).origin;
  const res = await fetch(base + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const must = (res, what) => {
  if (res.status >= 300) throw new Error(`${what}: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  return res;
};

/**
 * Makes sure an owner, a vehicle and an active shift exist and returns `{cookie, recoveryKey,
 * vehicleId, shift}`. The recovery key is kept in `stateFile` (a test rig only; the product never
 * stores it). Safe to call again: it signs in with the saved password when setup is already done.
 */
export async function ensureSession(base, stateFile) {
  const saved =
    stateFile && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const status = (await call(base, '/api/v1/setup/status')).json?.state;
  let { cookie, recoveryKey } = saved;
  if (status === 'needs_setup') {
    const res = must(await call(base, '/api/v1/setup', { method: 'POST', body: OWNER }), 'setup');
    cookie = cookieOf(res);
    recoveryKey = res.json.recovery_key;
    must(
      await call(base, '/api/v1/setup/confirm', {
        method: 'POST',
        cookie,
        body: { last6: recoveryKey.slice(-6) },
      }),
      'confirm',
    );
  } else {
    const probe = cookie ? await call(base, '/api/v1/settings', { cookie }) : { status: 401 };
    if (probe.status !== 200) {
      const login = must(
        await call(base, '/api/v1/auth/login', {
          method: 'POST',
          body: { username: OWNER.username, password: OWNER.password },
        }),
        'login',
      );
      cookie = cookieOf(login);
    }
  }
  let vehicles = must(await call(base, '/api/v1/vehicles', { cookie }), 'vehicles').json;
  if (!vehicles.length) {
    vehicles = [
      must(
        await call(base, '/api/v1/vehicles', {
          method: 'POST',
          cookie,
          body: { name: 'VM test car', kind: 'car' },
        }),
        'vehicle',
      ).json,
    ];
  }
  const list = must(await call(base, '/api/v1/shifts?status=active', { cookie }), 'shifts').json
    .items;
  const shift =
    list[0] ??
    must(
      await call(base, '/api/v1/shifts', {
        method: 'POST',
        cookie,
        body: {
          client_id: randomUUID(),
          vehicle_id: vehicles[0].id,
          started_at: Date.now() - 3600_000,
        },
      }),
      'start shift',
    ).json;
  const state = {
    cookie,
    recoveryKey,
    vehicleId: vehicles[0].id,
    shift: { id: shift.id, client_id: shift.client_id },
  };
  if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  return state;
}

/** Pairs `n` phones through the real QR flow. Each gets its own telemetry rate limit (08 section 7.4). */
export async function pairDevices(base, cookie, n, prefix = 'load') {
  const devices = [];
  for (let i = 0; i < n; i++) {
    const token = must(
      await call(base, '/api/v1/pairing-tokens', { method: 'POST', cookie }),
      'pairing token',
    ).json.token;
    const res = must(
      await call(base, '/api/v1/pairing/redeem', {
        method: 'POST',
        body: { token, device_name: `${prefix}-${i}`, platform: 'android' },
      }),
      'redeem',
    ).json;
    devices.push({ id: res.device_id, token: res.device_token, nextSeq: 1 });
  }
  return devices;
}
