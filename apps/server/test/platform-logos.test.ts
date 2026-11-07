import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildBackupService, createRestoreService, fileSecrets } from '../src/index';
import { harness, type Harness } from './support';

// Plan 25 section 7: the driver's own logo per platform, stored in the database.
let h: Harness;
let cookie: string;
let key: string;
beforeEach(async () => {
  h = harness();
  ({ cookie, recoveryKey: key } = await h.signUp());
  await h.call('PATCH', '/settings', { country: 'CA' }, { cookie });
});
afterEach(() => h.close());

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(20, 7),
]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
/** A JPEG whose Exif block holds recognisable bytes: they must not survive (location data). */
const JPEG = (() => {
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.alloc(16, 0x44)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), exif]);
  app1.writeUInt16BE(app1.length - 2, 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]),
  ]);
})();

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const put = (slug: string, body: Buffer, type: string, x: Harness = h, c = cookie) =>
  x.app.inject({
    method: 'PUT',
    url: `/api/v1/platforms/${slug}/logo`,
    payload: body,
    headers: { 'content-type': type, cookie: c, origin: 'http://mw.test', host: 'mw.test' },
  });
const version = async (slug: string, x: Harness = h, c = cookie) =>
  (
    (await x.call('GET', '/platforms?include_inactive=true', undefined, { cookie: c })).json() as {
      slug: string;
      logo_version: string | null;
    }[]
  ).find((p) => p.slug === slug)?.logo_version;

describe('upload, read, replace, remove', () => {
  test('a PNG for a built-in platform: listed with a version, served with safe headers', async () => {
    expect(await version('doordash')).toBeNull();
    const res = await put('doordash', PNG, 'image/png');
    expect(res.statusCode).toBe(201);
    const v = await version('doordash');
    expect(res.json()).toEqual({
      slug: 'doordash',
      mime: 'image/png',
      bytes: PNG.length,
      logo_version: v,
    });
    const got = await send('GET', `/platforms/doordash/logo?v=${v}`);
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect(got.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'no-store', // as every API answer (hooks.ts)
    });
  });

  test('replacing changes the version; a JPEG loses its Exif; remove brings back none', async () => {
    await put('doordash', PNG, 'image/png');
    const before = await version('doordash');
    const res = await put('doordash', JPEG, 'image/jpeg');
    expect([res.statusCode, res.json().mime]).toEqual([200, 'image/jpeg']);
    expect(await version('doordash')).not.toBe(before);
    const stored = (await send('GET', '/platforms/doordash/logo')).rawPayload;
    expect(stored.includes(Buffer.alloc(16, 0x44))).toBe(false);
    expect((await put('ubereats', WEBP, 'image/webp')).statusCode).toBe(201);
    expect((await send('DELETE', '/platforms/doordash/logo')).statusCode).toBe(204);
    expect(await version('doordash')).toBeNull();
    expect((await send('GET', '/platforms/doordash/logo')).statusCode).toBe(404);
    expect((await send('DELETE', '/platforms/doordash/logo')).statusCode).toBe(204); // idempotent
  });

  test("a custom platform's logo goes with the platform", async () => {
    await send('PUT', '/platforms/mylocal', { label: 'My Local' });
    expect((await put('mylocal', PNG, 'image/png')).statusCode).toBe(201);
    expect(await version('mylocal')).not.toBeNull();
    expect((await send('DELETE', '/platforms/mylocal')).statusCode).toBe(204);
    await send('PUT', '/platforms/mylocal', { label: 'My Local' });
    expect(await version('mylocal')).toBeNull();
  });

  test('refusals: not an allowed type, SVG, bytes that lie, too large, unknown platform', async () => {
    expect((await put('doordash', PNG, 'text/plain')).statusCode).toBe(415);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>');
    expect((await put('doordash', svg, 'image/svg+xml')).statusCode).toBe(415);
    const lie = await put('doordash', svg, 'image/png');
    expect([lie.statusCode, lie.json().code]).toEqual([422, 'validation_failed']);
    const big = Buffer.concat([PNG, Buffer.alloc(256 * 1024)]);
    expect((await put('doordash', big, 'image/png')).statusCode).toBe(413);
    expect((await put('nosuch', PNG, 'image/png')).statusCode).toBe(404);
    expect((await send('GET', '/platforms/nosuch/logo')).statusCode).toBe(404);
    expect(await version('doordash')).toBeNull();
  });

  test('sign-in needed; a phone may read a logo but not change it', async () => {
    await put('doordash', PNG, 'image/png');
    expect((await h.call('GET', '/platforms/doordash/logo')).statusCode).toBe(401);
    const phone = await h.pair(cookie);
    expect(
      (await h.call('GET', '/platforms/doordash/logo', undefined, phone.auth)).statusCode,
    ).toBe(200);
    expect(
      (await h.call('DELETE', '/platforms/doordash/logo', undefined, phone.auth)).statusCode,
    ).toBe(403);
  });

  test("receipts keep their own 10 MB limit next to the logos' 256 KB", async () => {
    const id = (
      await send('POST', '/expenses', { spent_on: '2027-01-10', category: 'fuel', amount_cents: 5 })
    ).json().id as number;
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/expenses/${id}/receipt`,
      payload: Buffer.concat([PNG, Buffer.alloc(300 * 1024)]),
      headers: { 'content-type': 'image/png', cookie, origin: 'http://mw.test', host: 'mw.test' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('backups', () => {
  test('a backup carries the logo: restored on a fresh host, byte for byte', async () => {
    await put('doordash', PNG, 'image/png');
    const svc = (x: Harness) =>
      buildBackupService({
        db: x.db,
        now: () => x.clock.t,
        backupDir: join(x.dir, 'backups'),
        configDir: join(x.dir, 'config'),
      });
    const run = (await svc(h).run('manual'))!;
    const fresh = harness();
    try {
      await createRestoreService({
        db: fresh.db,
        backup: svc(fresh),
        secrets: fileSecrets(join(fresh.dir, 'config')),
        state: fresh.state,
        receiptsDir: join(fresh.dir, 'receipts'),
      }).restore(join(h.dir, 'backups', run.fileName), key, false);
      const row = fresh.db
        .prepare("SELECT mime, bytes FROM platform_logos WHERE slug = 'doordash'")
        .get() as { mime: string; bytes: Buffer };
      expect(row.mime).toBe('image/png');
      expect(row.bytes.equals(PNG)).toBe(true);
    } finally {
      await fresh.close();
    }
  });
});

describe('module off', () => {
  test('platforms off: the logo routes 404', async () => {
    const off = harness({ platforms: false });
    try {
      const { cookie: c } = await off.signUp();
      expect((await put('doordash', PNG, 'image/png', off, c)).statusCode).toBe(404);
      expect(
        (await off.call('GET', '/platforms/doordash/logo', undefined, { cookie: c })).statusCode,
      ).toBe(404);
    } finally {
      await off.close();
    }
  });
});
