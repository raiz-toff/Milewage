import { describe, expect, test } from 'vitest';
import {
  defineModule,
  moduleMatrix,
  ModuleConfigError,
  type ModuleDefinition,
} from '@milewage/shared';
import {
  buildApp,
  ConfigError,
  coreModule,
  loadConfig,
  serverModules,
  type ServerRouteHost,
} from '../src/index';

const silent = { logLevel: 'silent' };
const only = { modules: serverModules, enabled: { core: true }, ...silent };

function stub(name: string, dependsOn: string[] = ['core']) {
  return defineModule({
    name,
    dependsOn,
    routes: (host) => host.route('GET', `/${name}/ping`, () => ({ module: name })),
  });
}

describe('health', () => {
  test('GET /healthz returns only {"ok":true}, outside /api/v1', async () => {
    const { fastify } = buildApp(only);
    const res = await fastify.inject('/healthz');
    expect(res.json()).toEqual({ ok: true });
    expect((await fastify.inject('/api/v1/healthz')).statusCode).toBe(404);
  });

  test('503 when the probe fails', async () => {
    const res = await buildApp({ ...only, isHealthy: () => false }).fastify.inject('/healthz');
    expect([res.statusCode, res.json()]).toEqual([503, { ok: false }]);
  });
});

describe('error model (08 section 7.1)', () => {
  const mod = defineModule({
    name: 'core',
    dependsOn: [],
    toggleable: false,
    routes: (host) => {
      const { app } = host as ServerRouteHost;
      app.get('/boom', () => {
        throw new Error('secret SELECT * FROM users at /app/data');
      });
      const body = { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } };
      app.post('/typed', { schema: { body } }, () => ({}));
    },
  });
  const build = () => buildApp({ modules: [mod], enabled: { core: true }, ...silent }).fastify;
  const post = (payload: string, type = 'application/json') =>
    build().inject({
      method: 'POST',
      url: '/api/v1/typed',
      headers: { 'content-type': type },
      payload,
    });

  test('unknown route is a 404 problem+json with a request id', async () => {
    const res = await build().inject('/api/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      type: 'https://milewage.dev/errors/not_found',
      status: 404,
      code: 'not_found',
      retryable: false,
    });
    expect(res.json().request_id).toMatch(/^[0-9A-Z]{26}$/);
  });

  test('unexpected errors are 500 internal_error without internals', async () => {
    const res = await build().inject('/api/v1/boom');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal_error', retryable: true });
    expect(res.body).not.toMatch(/SELECT|\/app\/data|stack/);
  });

  test('422 with errors list, 400 for bad JSON, 413 over 64 KiB', async () => {
    const bad = await post('{"n":"x"}');
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('validation_failed');
    expect(bad.json().errors[0]).toHaveProperty('path');
    expect((await post('{nope')).json().code).toBe('malformed_request');
    const big = await post(JSON.stringify({ n: 1, pad: 'x'.repeat(70 * 1024) }));
    expect([big.statusCode, big.json().code]).toEqual([413, 'payload_too_large']);
  });
});

describe('logging', () => {
  test('secrets are redacted in JSON log lines', () => {
    const lines: string[] = [];
    const { fastify } = buildApp({
      ...only,
      logLevel: 'info',
      logStream: { write: (l) => void lines.push(l) },
    });
    fastify.log.info(
      {
        req: { headers: { authorization: 'Bearer SECRET-A', cookie: 'mw_session=SECRET-B' } },
        body: { password: 'SECRET-C', recovery_key: 'SECRET-D', username: 'sam' },
      },
      'probe',
    );
    const out = lines.join('');
    expect(JSON.parse(lines[0] as string).msg).toBe('probe');
    expect(out).toContain('[redacted]');
    expect(out).not.toMatch(/SECRET-[ABCD]/);
  });
});

describe('module matrix', () => {
  const set: ModuleDefinition[] = [
    coreModule,
    stub('devices'),
    stub('tracking'),
    stub('stops', ['core', 'tracking']),
  ];

  test.each(moduleMatrix(set).map((c) => [c.label, c] as const))('%s', async (_label, c) => {
    if (c.expectRefusal) {
      expect(() => buildApp({ modules: set, enabled: c.enabled, ...silent })).toThrow(
        ModuleConfigError,
      );
      return;
    }
    const { fastify } = buildApp({ modules: set, enabled: c.enabled, ...silent });
    for (const m of set.filter((x) => x.name !== 'core')) {
      const res = await fastify.inject(`/api/v1/${m.name}/ping`);
      expect(res.statusCode).toBe(c.enabled[m.name] ? 200 : 404);
    }
  });
});

describe('config', () => {
  test('defaults and validation', () => {
    expect(loadConfig({ MILEWAGE_CONFIG_DIR: '/nonexistent' })).toMatchObject({ port: 8080 });
    expect(() => loadConfig({ MILEWAGE_PORT: 'abc' })).toThrow(ConfigError);
  });
});
