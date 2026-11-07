import { ApiError } from '../src/api/client';
import { deriveFlags, parsePairingPayload } from '../src/pairing/pairing';
import {
  DEVICE_TOKEN,
  json,
  makeServices,
  mockServer,
  problem,
  QR,
  SETTINGS,
  TOKEN,
} from './support/mock';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const okServer = () =>
  mockServer({
    'POST /pairing/redeem': () =>
      json(
        201,
        { device_id: 7, device_token: DEVICE_TOKEN, settings: SETTINGS },
        { 'X-MileWage-Instance': 'inst-1' },
      ),
    'GET /settings': () => json(200, { ...SETTINGS, distance_unit: 'km' }),
  });

describe('QR payload', () => {
  it('parses the 08 format and trims a trailing slash', () => {
    const p = parsePairingPayload(
      `milewage://pair?v=1&u=${encodeURIComponent('https://a.b:8443/mw/')}&t=${TOKEN}`,
    );
    expect(p).toEqual({ baseUrl: 'https://a.b:8443/mw', token: TOKEN });
  });

  it('parses the https page link the QR shows; the base is the page, not a smuggled u', () => {
    const base = { baseUrl: 'https://box.tail1.ts.net', token: TOKEN };
    expect(parsePairingPayload(`https://box.tail1.ts.net/pair#v=1&t=${TOKEN}`)).toEqual(base);
    const evil = `https://box.tail1.ts.net/pair#v=1&t=${TOKEN}&u=https%3A%2F%2Fevil.example`;
    expect(parsePairingPayload(evil)).toEqual(base);
    expect(parsePairingPayload(`https://a.b/mw/pair#v=1&t=${TOKEN}`)?.baseUrl).toBe(
      'https://a.b/mw',
    );
  });

  it.each([
    'https://example.com',
    `https://a.b/pair?v=1&t=${TOKEN}`,
    `https://a.b/pair#v=2&t=${TOKEN}`,
    `milewage://pair?v=2&u=https%3A%2F%2Fa.b&t=${TOKEN}`,
    `milewage://pair?v=1&u=ftp%3A%2F%2Fa.b&t=${TOKEN}`,
    'milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwd_short',
    'milewage://pair?v=1&u=https%3A%2F%2Fa.b',
    'milewage://pair?v=1&u=%E0%A4%A&t=x',
  ])('rejects %s', (text) => {
    expect(parsePairingPayload(text)).toBeNull();
  });
});

describe('redeem against the mock server', () => {
  it('stores the credential securely and the settings in the cache, sends no auth', async () => {
    const server = okServer();
    const { services, secure, plain } = makeServices(server.fetch);
    const state = await services.pairing.redeem(parsePairingPayload(QR)!);
    expect(state.credential).toMatchObject({
      deviceId: 7,
      deviceToken: DEVICE_TOKEN,
      instanceId: 'inst-1',
      baseUrl: 'https://mw.example.net',
    });
    expect(server.calls[0]!.headers.Authorization).toBeUndefined();
    expect(server.calls[0]!.body).toMatchObject({ token: TOKEN, platform: 'android' });
    expect(JSON.parse(secure.data.get('pairing.credential')!).deviceToken).toBe(DEVICE_TOKEN);
    expect(plain.data.get('pairing.credential')).toBeUndefined();
    expect(JSON.parse(plain.data.get('pairing.settings')!).distance_unit).toBe('mi');
    expect((await services.pairing.load())?.credential.deviceId).toBe(7);
  });

  it('401 invalid_pairing_token stores nothing', async () => {
    const server = mockServer({
      'POST /pairing/redeem': () => problem(401, 'invalid_pairing_token'),
    });
    const { services, secure } = makeServices(server.fetch);
    await expect(services.pairing.redeem(parsePairingPayload(QR)!)).rejects.toMatchObject({
      status: 401,
      code: 'invalid_pairing_token',
    });
    expect(secure.data.size).toBe(0);
  });

  it('network failure is a retryable ApiError', async () => {
    const { services } = makeServices(async () => {
      throw new Error('offline');
    });
    const err = await services.pairing.redeem(parsePairingPayload(QR)!).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'network', retryable: true });
  });

  it('refreshSettings sends the bearer and replaces the cache; failure keeps the cache', async () => {
    const server = okServer();
    const { services } = makeServices(server.fetch);
    const paired = await services.pairing.redeem(parsePairingPayload(QR)!);
    const r = await services.pairing.refreshSettings(paired);
    expect(r.state.settings?.distance_unit).toBe('km');
    const get = server.calls.find((c) => c.method === 'GET')!;
    expect(get.headers.Authorization).toBe(`Bearer ${DEVICE_TOKEN}`);
    expect(Number(get.headers['X-Client-Time'])).toBeGreaterThan(0);

    const down = makeServices(async () => problem(401, 'device_revoked'));
    const bad = await down.services.pairing.refreshSettings(paired);
    expect(bad.error?.code).toBe('device_revoked');
    expect(bad.state.settings?.distance_unit).toBe('mi');
  });

  it('status: paired, revoked when the server refuses the phone, cleared by a new pairing', async () => {
    let revoked = false;
    const server = mockServer({
      ...okServer().routes,
      'GET /settings': () => (revoked ? problem(401, 'device_revoked') : json(200, SETTINGS)),
    });
    const { services } = makeServices(server.fetch);
    const changes = jest.fn();
    services.pairing.subscribe(changes);
    expect(await services.pairing.status()).toBe('unpaired');
    const paired = await services.pairing.redeem(parsePairingPayload(QR)!);
    expect(await services.pairing.status()).toBe('paired');
    await services.pairing.refreshSettings(paired);
    expect(await services.pairing.status()).toBe('paired'); // a good answer changes nothing
    revoked = true;
    await services.pairing.refreshSettings(paired);
    expect(await services.pairing.status()).toBe('revoked');
    expect(await services.pairing.load()).not.toBeNull(); // nothing deleted
    revoked = false;
    await services.pairing.redeem(parsePairingPayload(QR)!);
    expect(await services.pairing.status()).toBe('paired');
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it('unpair forgets the credential', async () => {
    const { services } = makeServices(okServer().fetch);
    await services.pairing.redeem(parsePairingPayload(QR)!);
    await services.pairing.unpair();
    expect(await services.pairing.load()).toBeNull();
  });
});

describe('flags', () => {
  it('derive from modules and stops_enabled', () => {
    expect(deriveFlags(SETTINGS)).toMatchObject({
      tracking: true,
      stops: true,
      segmenter: 'stops',
    });
    expect(deriveFlags({ ...SETTINGS, stops_enabled: false })).toMatchObject({
      stops: false,
      segmenter: 'whole_shift',
    });
    expect(deriveFlags({ ...SETTINGS, modules: { tracking: false, stops: true } })).toMatchObject({
      tracking: false,
      stops: false,
    });
    expect(deriveFlags(null).diagnostics).toBe(false);
  });
});
