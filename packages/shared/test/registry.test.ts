import { describe, expect, test, vi } from 'vitest';
import {
  buildRegistry,
  createEventBus,
  defineModule as def,
  ModuleConfigError,
  moduleMatrix,
  resolveModuleConfig,
} from '../src/index';

const sample = () => [
  def({ name: 'core', dependsOn: [], toggleable: false }),
  def({ name: 'devices', dependsOn: ['core'] }),
  def({ name: 'tracking', dependsOn: ['core', 'devices'] }),
  def({ name: 'replay', dependsOn: ['tracking'] }),
];

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

// Routes, jobs and subscriptions of modules that are on or off are the server's (apps/server/test/assembly.test.ts).
describe('event bus', () => {
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
