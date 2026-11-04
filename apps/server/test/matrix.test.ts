import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { moduleMatrix, ModuleConfigError } from '@milewage/shared';
import { serverModules } from '../src/index';
import { harness } from './support';

// 08 section 16.6: the whole API suite configuration runs once with every module on and once per
// module with only that module and its dependencies on. Each configuration must start, serve its
// own routes and answer 404 for the others. The OpenAPI `x-modules` map drives the 404 side.
const spec = parse(
  readFileSync(
    fileURLToPath(new URL('../../../packages/shared/openapi/openapi.yaml', import.meta.url)),
    'utf8',
  ),
) as {
  'x-modules': Record<string, { operations: string[] }>;
  paths: Record<string, Record<string, { operationId?: string }>>;
};
const moduleOf = new Map(
  Object.entries(spec['x-modules']).flatMap(([m, d]) => d.operations.map((op) => [op, m] as const)),
);
const operations = Object.entries(spec.paths)
  .filter(([path]) => path !== '/healthz')
  .flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, op]) => op.operationId)
      .map(([method, op]) => ({
        method: method.toUpperCase(),
        path: path.replace(/\{[^}]+\}/g, '1'),
        module: moduleOf.get(op.operationId!)!,
      })),
  );

const webCrash = {
  kind: 'crash',
  at: 1_800_000_000_000,
  level: 'basic',
  src: 'web',
  v: '0.1.0',
  data: { runtime: 'web', class: 'TypeError', frames: ['a.js:1'], fatal: false },
};
const telemetry = {
  shift_client_id: '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11',
  points: [{ seq: 1, recorded_at: 1, lat_e7: 0, lon_e7: 0, accuracy_m: 5 }],
};
/** One route per implemented module, answered by the module itself when it is on. */
const probes: Record<string, { method: string; path: string; body?: object; status: number }> = {
  devices: { method: 'GET', path: '/devices', status: 200 },
  tracking: { method: 'POST', path: '/telemetry/batch', body: telemetry, status: 403 },
  diagnostics: {
    method: 'POST',
    path: '/diagnostics/events',
    body: { events: [webCrash] },
    status: 200,
  },
};

describe('module matrix (08 section 16.6)', () => {
  test('the OpenAPI map covers every operation and every server module is in it', () => {
    expect(operations.every((o) => o.module)).toBe(true);
    for (const m of serverModules) expect(spec['x-modules'][m.name], m.name).toBeDefined();
  });

  test.each(moduleMatrix(serverModules).map((c) => [c.label, c] as const))('%s', async (_l, c) => {
    if (c.expectRefusal) {
      expect(() => harness(c.enabled)).toThrow(ModuleConfigError);
      return;
    }
    const h = harness(c.enabled);
    try {
      const { cookie } = await h.signUp();
      const on = (name: string) => c.enabled[name] === true;

      // The flags in GET /settings are the registry, not a copy.
      const flags = (await h.call('GET', '/settings', undefined, { cookie })).json().modules;
      for (const name of ['devices', 'tracking', 'diagnostics']) {
        expect(flags[name], `modules.${name}`).toBe(on(name));
      }

      // Own routes are served; routes of disabled modules are a plain 404.
      for (const [name, p] of Object.entries(probes)) {
        const res = await h.call(p.method, p.path, p.body, { cookie });
        expect(res.statusCode, `${p.method} ${p.path}`).toBe(on(name) ? p.status : 404);
      }
      for (const op of operations.filter((o) => o.module && !on(o.module))) {
        const res = await h.call(op.method, op.path, op.method === 'GET' ? undefined : {}, {
          cookie,
        });
        expect(res.statusCode, `${op.method} ${op.path} (${op.module} is off)`).toBe(404);
        expect(res.json().code).toBe('not_found');
      }
    } finally {
      await h.close();
    }
  });

  test('a disabled module leaves no state behind: no diagnostics.db without the module', async () => {
    const h = harness({ diagnostics: false });
    try {
      await h.signUp();
      const tables = h.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'diag%'")
        .all();
      expect(tables).toEqual([]);
    } finally {
      await h.close();
    }
  });
});
