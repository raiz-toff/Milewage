import { serversFrom } from '../src/connect/discover';
import { ApiError } from '../src/api/client';
import { DEVICE_TOKEN, json, makeServices, problem, SETTINGS } from './support/mock';

const HOME = 'http://192.168.1.20:8080';
const AWAY = 'https://box.tail1234.ts.net';

describe('servers found on the Wi-Fi (plan 28 section 4.5)', () => {
  it('keeps home addresses only, reads the record, and lists each address once', () => {
    const a = (
      host: string,
      txt: Record<string, string> = { v: '1', id: 'inst-1' },
      port = 8080,
    ) => ({ name: 'MileWage (box)', host, port, txt });
    expect(
      serversFrom([
        a('192.168.1.20'),
        a('192.168.1.20'), // announced on two interfaces
        a('fd12::5', { v: '1' }),
        a('8.8.8.8'), // an announcement cannot send the phone to the internet
        a('192.168.1.21', { v: '2' }), // a later record version
        a('192.168.1.22', {}, 0),
      ]),
    ).toEqual([
      { name: 'MileWage (box)', url: HOME, instanceId: 'inst-1' },
      { name: 'MileWage (box)', url: 'http://[fd12::5]:8080', instanceId: null },
    ]);
  });
});

describe('linking with a code, the pairing side (plan 28 section 4.4)', () => {
  const linked = () =>
    json(
      201,
      {
        device_id: 9,
        device_token: DEVICE_TOKEN,
        settings: SETTINGS,
        home_url: HOME,
        away_url: AWAY,
      },
      { 'X-MileWage-Instance': 'inst-1' },
    );

  it('asks, waits while pending, then keeps the connection with both addresses', async () => {
    const answers = [json(202, { status: 'pending' }), linked()];
    const sent: { url: string; body: unknown }[] = [];
    const { services, secure } = makeServices(async (url, init) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith('/link-requests')) {
        return json(201, {
          device_code: 'mwl_x',
          user_code: '482913',
          expires_in: 600,
          interval: 2,
        });
      }
      return answers.shift()!;
    });
    const link = await services.pairing.startLink(HOME);
    expect(link).toMatchObject({ deviceCode: 'mwl_x', userCode: '482913', intervalMs: 2000 });
    expect(sent[0]).toEqual({
      url: `${HOME}/api/v1/link-requests`,
      body: { device_name: 'Android phone', platform: 'android' },
    });
    expect(await services.pairing.pollLink(HOME, link.deviceCode)).toBeNull();
    const state = await services.pairing.pollLink(HOME, link.deviceCode);
    expect(state?.credential).toMatchObject({ baseUrl: HOME, homeUrl: HOME, awayUrl: AWAY });
    expect(sent[2]).toEqual({
      url: `${HOME}/api/v1/link-requests/poll`,
      body: { device_code: 'mwl_x' },
    });
    expect(await services.pairing.status()).toBe('paired');
    expect(JSON.parse(secure.data.get('pairing.credential')!).deviceId).toBe(9);
  });

  it('refusals are errors the screen can name; a strange answer is bad_response', async () => {
    const gone = makeServices(async () => problem(410, 'link_expired')).services;
    await expect(gone.pairing.pollLink(HOME, 'mwl_x')).rejects.toMatchObject({
      code: 'link_expired',
    });
    const odd = makeServices(async () =>
      json(201, { device_code: 'x', user_code: 'abc' }),
    ).services;
    const e = await odd.pairing.startLink(HOME).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: 'bad_response' });
  });
});
