import { fireEvent, render, screen } from '@testing-library/react-native';
import { parsePairingLink } from '@milewage/shared';
import { App } from '../src/App';
import {
  DEVICE_TOKEN,
  json,
  makeServices,
  mockServer,
  problem,
  QR,
  SETTINGS,
} from './support/mock';
import { ID, server, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

/**
 * Pairing again after the server stopped this phone (revoked, or another server at its address)
 * lets everything queued go out: the shift create and end in the outbox as well as the points.
 */
const redeemed = (instance: string) =>
  json(
    201,
    { device_id: 8, device_token: DEVICE_TOKEN, settings: SETTINGS },
    { 'X-MileWage-Instance': instance },
  );
const sentAfter = (calls: { method: string; path: string }[], from: number) =>
  calls.slice(from).map((c) => `${c.method} ${c.path}`);

/** A shift whose create could not be sent (server down), then the server revoked the phone. */
async function revokedWithQueuedShift(more: Parameters<typeof server>[0] = {}) {
  let mode: 'down' | 'revoked' | 'ok' = 'down';
  const answer = (ok: () => Response) => () =>
    mode === 'down'
      ? problem(503, 'unavailable', true)
      : mode === 'revoked'
        ? problem(401, 'device_revoked')
        : ok();
  const routes = server({
    'POST /shifts': answer(() => json(201, { client_id: ID, vehicle_id: 3, started_at: 1_000 })),
    [`POST /shifts/${ID}/end`]: answer(() => json(200, {})),
    'POST /pairing/redeem': () => redeemed('inst-1'),
    'GET /settings': () => json(200, SETTINGS),
    ...more,
  });
  const made = setup(routes);
  await made.services.shift.start({ vehicleId: 3 }); // the create waits: server down
  mode = 'revoked';
  await made.services.shift.end(); // create and end queued
  await made.services.sender.sendNow(); // and the server meets them with the revoke
  expect(await made.services.pairing.status()).toBe('revoked');
  expect((await made.services.sender.status()).unsyncedShifts).toBe(1);
  return { ...made, routes, ok: () => void (mode = 'ok') };
}

describe('re-pairing lifts every halt', () => {
  it('after pairing again from a code on the Connect screen, the queued create and end are sent', async () => {
    const { services, routes, ok } = await revokedWithQueuedShift();
    render(<App services={services} />);
    expect(await screen.findByText(/disconnected from your server. Connect again/)).toBeTruthy();
    ok(); // the owner made a new code; the server takes this phone again
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    fireEvent.changeText(await screen.findByLabelText('Pairing code'), QR);
    fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Phone connected.')).toBeTruthy();
    const from = routes.calls.length;
    await services.sender.sendNow();
    expect(sentAfter(routes.calls, from)).toEqual(
      expect.arrayContaining(['POST /shifts', `POST /shifts/${ID}/end`]),
    );
    expect((await services.sender.status()).unsyncedShifts).toBe(0);
  });

  it('after pairing again with a link code, the queued create and end are sent', async () => {
    const { services, routes, ok } = await revokedWithQueuedShift({
      'POST /link-requests/poll': () => redeemed('inst-1'),
    });
    ok();
    expect(await services.pairing.pollLink('https://mw.example.net', 'dc')).not.toBeNull();
    const from = routes.calls.length;
    await services.sender.sendNow();
    expect(sentAfter(routes.calls, from)).toEqual(
      expect.arrayContaining(['POST /shifts', `POST /shifts/${ID}/end`]),
    );
    expect((await services.sender.status()).unsyncedShifts).toBe(0);
    expect(await services.pairing.status()).toBe('paired');
  });

  it('after re-pairing to the new server at the same address, requests go out again', async () => {
    let inst = 'inst-A';
    const srv = mockServer({
      'GET /settings': () => json(200, SETTINGS, { 'X-MileWage-Instance': inst }),
      'GET /sync/changes': () =>
        json(
          200,
          { changes: [], next_cursor: 0, has_more: false },
          { 'X-MileWage-Instance': inst },
        ),
      'POST /pairing/redeem': () => redeemed('inst-B'),
    });
    const { services, secure } = makeServices(srv.fetch, { paired: true });
    secure.data.set(
      'pairing.credential',
      JSON.stringify({
        baseUrl: 'https://mw.example.net',
        deviceId: 7,
        deviceToken: 'mwd_b',
        instanceId: 'inst-A',
      }),
    );
    inst = 'inst-B'; // the address now answers as another server
    await services.sender.sendNow();
    expect((await services.sender.status()).message).toMatch(/different MileWage server/);
    const blocked = srv.calls.length;
    await services.sender.sendNow();
    expect(srv.calls.length).toBe(blocked); // nothing goes out

    // "Re-pair to the new server": Settings disconnects, then the phone pairs with a new code.
    await services.pairing.unpair();
    await services.pairing.redeem(parsePairingLink(QR)!);
    const from = srv.calls.length;
    await services.sender.sendNow();
    expect(sentAfter(srv.calls, from)).toContain('GET /settings');
    expect((await services.sender.status()).message ?? '').not.toMatch(/different MileWage server/);
  });
});
