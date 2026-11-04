import { describe, expect, test, vi } from 'vitest';
import {
  buildRegistry,
  createEventBus,
  defineModule as def,
  ModuleConfigError,
  moduleMatrix,
  resolveModuleConfig,
  type ModuleDefinition,
  type RouteHost,
} from '../src/index';

const sample = () => [
  def({ name: 'core', dependsOn: [], toggleable: false }),
  def({ name: 'devices', dependsOn: ['core'] }),
  def({ name: 'tracking', dependsOn: ['core', 'devices'] }),
  def({ name: 'replay', dependsOn: ['tracking'] }),
];

/** In-memory router: unregistered paths answer 404. */
function memoryHost() {
  const table = new Map<string, unknown>();
  const host: RouteHost = { route: (m, p, h) => void table.set(`${m} ${p}`, h({})) };
  const status = (m: string, p: string) => (table.has(`${m} ${p}`) ? 200 : 404);
  return { host, status };
}

describe('graph validation', () => {
  test('detects cycles with a readable path', () => {
    const mods = [def({ name: 'a', dependsOn: ['b'] }), def({ name: 'b', dependsOn: ['a'] })];
    expect(() => buildRegistry(mods, {})).toThrow(/cycle: a -> b -> a/);
  });

  test('refuses unknown, duplicate and non-toggleable-off modules', () => {
    const a = def({ name: 'a', dependsOn: [] });
    expect(() => buildRegistry([def({ name: 'a', dependsOn: ['x'] })], {})).toThrow(
      /unknown module "x"/,
    );
    expect(() => buildRegistry([a, a], {})).toThrow(/twice/);
    expect(() => buildRegistry([a], { nope: true })).toThrow(/unknown module "nope"/);
    expect(() => buildRegistry(sample(), { core: false })).toThrow(/cannot be turned off/);
  });

  test('refuses an enabled module whose dependency is disabled, naming both', () => {
    const run = () => buildRegistry(sample(), { tracking: false });
    expect(run).toThrow(ModuleConfigError);
    expect(run).toThrow(/"replay" is enabled but depends on "tracking", which is disabled/);
  });

  test('orders enabled modules dependencies first and reports flags', () => {
    const reg = buildRegistry(sample().reverse(), { replay: false });
    expect(reg.enabled.map((m) => m.name)).toEqual(['core', 'devices', 'tracking']);
    expect(reg.flags()).toMatchObject({ tracking: true, replay: false });
  });
});

describe('routes, jobs, events', () => {
  const start = vi.fn(() => vi.fn());
  const mods = (): ModuleDefinition[] => [
    def({
      name: 'core',
      dependsOn: [],
      toggleable: false,
      routes: (h) => h.route('GET', '/healthz', () => 1),
    }),
    def({
      name: 'replay',
      dependsOn: ['core'],
      routes: (h) => h.route('GET', '/route', () => 2),
      jobs: [{ name: 'j', start }],
    }),
  ];

  test('a disabled module has no routes (404) and runs no jobs', () => {
    const off = memoryHost();
    const reg = buildRegistry(mods(), { replay: false });
    reg.registerRoutes(off.host);
    reg.startJobs();
    expect([off.status('GET', '/healthz'), off.status('GET', '/route')]).toEqual([200, 404]);
    expect(start).not.toHaveBeenCalled();
  });

  test('an enabled module registers routes and starts then stops jobs', () => {
    const on = memoryHost();
    const reg = buildRegistry(mods(), {});
    reg.registerRoutes(on.host);
    reg.startJobs()();
    expect(on.status('GET', '/route')).toBe(200);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.results[0]?.value).toHaveBeenCalledTimes(1);
  });

  test('events reach subscribers; publishers need no knowledge of them', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const off = bus.on('shift.ended', (p) => seen.push(p.shiftId));
    bus.emit('shift.ended', { shiftId: 's1' });
    off();
    bus.emit('shift.ended', { shiftId: 's2' });
    bus.emit('device.seen', { deviceId: 'nobody-listens' });
    expect(seen).toEqual(['s1']);
  });

  test('a throwing handler does not stop others or the publisher', () => {
    const errors: unknown[] = [];
    const bus = createEventBus((_, e) => errors.push(e));
    const ok = vi.fn();
    bus.on('shift.started', () => {
      throw new Error('boom');
    });
    bus.on('shift.started', ok);
    expect(() => bus.emit('shift.started', { shiftId: 's' })).not.toThrow();
    expect(ok).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });

  test('only enabled modules get their subscriptions attached', () => {
    const [a, b] = [vi.fn(), vi.fn()];
    const m = [
      def({ name: 'core', dependsOn: [], subscriptions: { 'shift.ended': a } }),
      def({ name: 'backup', dependsOn: ['core'], subscriptions: { 'shift.ended': b } }),
    ];
    const bus = createEventBus();
    buildRegistry(m, { backup: false }).attachSubscriptions(bus);
    bus.emit('shift.ended', { shiftId: 's' });
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 0]);
  });
});

test('config resolves default, then settings file, then environment', () => {
  const m = sample();
  expect(resolveModuleConfig(m).replay).toBe(true);
  expect(resolveModuleConfig(m, { modules: { replay: false } }).replay).toBe(false);
  const env = { MILEWAGE_MODULE_REPLAY: '1' };
  expect(resolveModuleConfig(m, { modules: { replay: false } }, env).replay).toBe(true);
  expect(() => resolveModuleConfig(m, {}, { MILEWAGE_MODULE_REPLAY: 'yes' })).toThrow(/0 or 1/);
  expect(() => resolveModuleConfig(m, { modules: { replay: 'no' } })).toThrow(/true or false/);
});

describe('module matrix helper', () => {
  test.each(moduleMatrix(sample()))('$label', ({ enabled, expectRefusal }) => {
    const run = () => buildRegistry(sample(), enabled);
    if (expectRefusal) expect(run).toThrow(ModuleConfigError);
    else expect(run().enabled.length).toBeGreaterThan(0);
  });
});
