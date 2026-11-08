import { afterEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { createMcpTokenRepository } from '../src/mcp/tokens';
import { harness, type Harness } from './support';

let h: Harness;
afterEach(() => h.close());
const DAY = 86_400_000;

async function start(enabled: Record<string, boolean> = { mcp: true }) {
  h = harness(enabled);
  const { cookie } = await h.signUp();
  const web = (method: string, url: string, payload?: object) =>
    h.call(method, url, payload, { cookie });
  return { cookie, web };
}

test('the module is off by default: no token routes, and the flag says so', async () => {
  const { web } = await start({});
  expect((await web('GET', '/mcp/tokens')).statusCode).toBe(404);
  expect((await web('POST', '/mcp/tokens', { name: 'x', scope: 'read' })).statusCode).toBe(404);
  expect((await web('GET', '/settings')).json().modules.mcp).toBe(false);
});

test('a token is shown once, only its hash is kept, and the list never has it', async () => {
  const { web } = await start();
  expect((await web('GET', '/settings')).json().modules.mcp).toBe(true);
  const made = await web('POST', '/mcp/tokens', { name: ' Claude on my laptop ', scope: 'write' });
  expect(made.statusCode).toBe(201);
  const body = made.json();
  expect(body.token).toMatch(/^mwa_[A-Za-z0-9_-]{43}$/);
  expect(body).toMatchObject({
    name: 'Claude on my laptop',
    scope: 'write',
    created_at: h.clock.t,
    expires_at: h.clock.t + 90 * DAY, // the default
    last_used_at: null,
    revoked_at: null,
  });
  const stored = h.db.prepare('SELECT token_hash FROM mcp_tokens').pluck().get();
  expect(stored).toBe(createHash('sha256').update(body.token).digest('hex'));
  expect(JSON.stringify(h.db.prepare('SELECT * FROM mcp_tokens').all())).not.toContain(body.token);

  const list = (await web('GET', '/mcp/tokens')).json();
  expect(list).toHaveLength(1);
  expect(list[0]).not.toHaveProperty('token');
  expect(list[0].id).toBe(body.id);

  const never = await web('POST', '/mcp/tokens', {
    name: 'r',
    scope: 'read',
    expires_in_days: null,
  });
  expect(never.json().expires_at).toBeNull();
  expect((await web('GET', '/mcp/tokens')).json().map((t: { id: number }) => t.id)).toEqual([
    never.json().id,
    body.id,
  ]);
});

test('bad bodies are refused; at most 20 live tokens', async () => {
  const { web } = await start();
  for (const bad of [
    { name: 'x', scope: 'admin' },
    { name: '', scope: 'read' },
    { name: 'x', scope: 'read', expires_in_days: 7 },
    { name: 'x', scope: 'read', extra: 1 },
  ]) {
    expect((await web('POST', '/mcp/tokens', bad)).statusCode, JSON.stringify(bad)).toBe(422);
  }
  const ids: number[] = [];
  for (let i = 0; i < 20; i++) {
    ids.push((await web('POST', '/mcp/tokens', { name: `t${i}`, scope: 'read' })).json().id);
  }
  const over = await web('POST', '/mcp/tokens', { name: 'one more', scope: 'read' });
  expect(over.statusCode).toBe(422);
  expect(over.json().errors[0].message).toMatch(/revoke one first/);
  // A revoked or expired token no longer counts.
  await web('DELETE', `/mcp/tokens/${ids[0]}`);
  expect((await web('POST', '/mcp/tokens', { name: 'again', scope: 'read' })).statusCode).toBe(201);
});

test('revoking is instant and idempotent; the repository refuses a wrong token', async () => {
  const { web } = await start();
  const { id, token } = (await web('POST', '/mcp/tokens', { name: 'x', scope: 'read' })).json();
  const repo = createMcpTokenRepository(h.db);
  expect(repo.byToken(token)?.id).toBe(id);
  const other = token.endsWith('A') ? 'B' : 'A';
  expect(repo.byToken(`${token.slice(0, -1)}${other}`)).toBeUndefined();

  expect((await web('DELETE', `/mcp/tokens/${id}`)).statusCode).toBe(204);
  expect(repo.byToken(token)?.revokedAt).toBe(h.clock.t);
  h.clock.t += 1000;
  expect((await web('DELETE', `/mcp/tokens/${id}`)).statusCode).toBe(204);
  expect(repo.byToken(token)?.revokedAt).toBe(h.clock.t - 1000);
  expect((await web('DELETE', '/mcp/tokens/999')).statusCode).toBe(404);
});

test('tokens are managed from a web session only, never by a phone', async () => {
  const { cookie } = await start({ mcp: true });
  const phone = await h.pair(cookie);
  const res = await h.call('GET', '/mcp/tokens', undefined, phone.auth);
  expect(res.statusCode).toBe(403);
  expect((await h.call('GET', '/mcp/tokens')).statusCode).toBe(401);
});
