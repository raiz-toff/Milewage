import { ApiError } from '../src/api/client';
import { DeviceSession, haltFor } from '../src/pairing/deviceSession';
import { MemoryStore } from '../src/pairing/pairing';
import { json, problem, SETTINGS } from './support/mock';
import { ID, server, setup } from './support/shiftKit';

describe('device session: the one holder of a halt', () => {
  it('reads 401 and 403 once: a revoke means re-pair, anything else a sign-in problem', () => {
    const e = (status: number, code: string) => new ApiError(status, code, false);
    expect(haltFor(e(401, 'device_revoked'))).toBe('repair');
    expect(haltFor(e(401, 'invalid_token'))).toBe('auth_problem');
    expect(haltFor(e(403, 'scope_forbidden'))).toBe('auth_problem');
    expect(haltFor(e(404, 'shift_not_found'))).toBeNull();
    expect(haltFor(e(0, 'network'))).toBeNull();
  });

  it('halts, says why (most serious first), and resume lifts every halt', async () => {
    const plain = new MemoryStore();
    const d = new DeviceSession(plain);
    expect(await d.halted()).toBeNull();
    await d.halt('auth_problem');
    expect(await d.halted()).toBe('auth_problem');
    await d.halt('wrong_server');
    expect(await d.halted()).toBe('wrong_server');
    expect(d.blocked()).toBe(true);
    await d.halt('repair');
    expect(await d.halted()).toBe('repair');
    await d.resume();
    expect(await d.halted()).toBeNull();
    expect(d.blocked()).toBe(false);
    expect(plain.data.size).toBe(0);
  });

  it('only another server at the address blocks every request outright', async () => {
    const d = new DeviceSession(new MemoryStore());
    await d.halt('repair');
    await d.halt('auth_problem');
    expect(d.blocked()).toBe(false);
  });

  it('a revoke is kept across a restart; the other halts are not', async () => {
    const plain = new MemoryStore();
    const first = new DeviceSession(plain);
    await first.halt('repair');
    await first.halt('wrong_server');
    expect(await new DeviceSession(plain).halted()).toBe('repair');
    const other = new MemoryStore();
    await new DeviceSession(other).halt('auth_problem');
    expect(await new DeviceSession(other).halted()).toBeNull();
  });

  it('tells its listeners about each halt, repeated ones too, and each resume', async () => {
    const d = new DeviceSession(new MemoryStore());
    const heard: (string | null)[] = [];
    const off = d.subscribe(() => void d.halted().then((h) => heard.push(h)));
    await d.halt('repair');
    await d.halt('repair');
    await d.resume();
    await new Promise((r) => setTimeout(r, 0));
    expect(heard).toEqual(['repair', 'repair', null]);
    off();
    await d.halt('auth_problem');
    await new Promise((r) => setTimeout(r, 0));
    expect(heard).toHaveLength(3);
  });
});

describe('device session: every sender obeys it', () => {
  it('a 403 from one request stops the runner, the upload worker and the change feed', async () => {
    const routes = server({
      [`POST /shifts/${ID}/end`]: () => problem(403, 'scope_forbidden'),
      'GET /sync/changes': () => json(200, { changes: [], next_cursor: 0, has_more: false }),
      'GET /settings': () => json(200, SETTINGS),
    });
    const { services, tracker } = setup(routes);
    await services.shift.start({ vehicleId: 3 });
    tracker.emit({ recordedAt: 2_000, latE7: 1, lonE7: 1 });
    await services.uploader.drain();
    await services.shift.end();
    expect(await services.device.halted()).toBe('auth_problem');
    expect((await services.status()).message).toBe('Sign-in problem. Re-pair this phone.');

    tracker.start('22222222-2222-4222-8222-222222222222');
    tracker.emit({ recordedAt: 3_000, latE7: 2, lonE7: 2 });
    const from = routes.calls.length;
    expect((await services.runner.run()).state).toBe('halted');
    expect((await services.uploader.drain()).state).toBe('halted');
    expect((await services.puller.pull({ force: true })).state).toBe('halted');
    expect(routes.calls.length).toBe(from); // nothing went out

    await services.device.resume(); // "Sync now"
    expect((await services.puller.pull({ force: true })).state).toBe('ok');
  });

  it('a revoke reaches the app start gate through pairing, and pairing again lifts it', async () => {
    const routes = server({ 'GET /settings': () => problem(401, 'device_revoked') });
    const { services } = setup(routes);
    const changes = jest.fn();
    services.pairing.subscribe(changes);
    const state = (await services.pairing.load())!;
    await services.pairing.refreshSettings(state);
    expect(await services.pairing.status()).toBe('revoked');
    expect(await services.device.halted()).toBe('repair');
    expect(changes).toHaveBeenCalled();
    await services.pairing.unpair();
    expect(await services.device.halted()).toBeNull();
  });
});
