import { afterEach, expect, test } from 'vitest';
import { connect, mcpHarness, resultOf } from './mcp-support';
import { harness, type Harness } from './support';

let h: Harness;
afterEach(() => h.close());

const post = (body: object, headers: Record<string, string> = {}) =>
  h.app.inject({
    method: 'POST',
    url: '/api/v1/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    payload: body,
  });
const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

test('the endpoint is absent while the module is off', async () => {
  h = harness({ mcp: false });
  await h.signUp();
  expect((await post(list)).statusCode).toBe(404);
});

test('only a live assistant token gets in; a token opens nothing else', async () => {
  const m = await mcpHarness();
  h = m.h;
  const phone = await h.pair(m.cookie);
  const tries: Record<string, string>[] = [
    {},
    phone.auth,
    { cookie: m.cookie },
    { authorization: 'Bearer mwa_x' },
  ];
  for (const headers of tries) {
    const res = await post(list, headers);
    expect(res.statusCode, JSON.stringify(headers)).toBe(401);
    // Where to sign in (RFC 9728), for this server's own address.
    expect(res.headers['www-authenticate']).toMatch(
      /^Bearer realm="MileWage", resource_metadata="http:\/\/[^/"]+\/\.well-known\/oauth-protected-resource\/api\/v1\/mcp"$/,
    );
  }
  const bearer = { authorization: `Bearer ${m.read.token}` };
  expect((await post(list, bearer)).statusCode).toBe(200);
  // The token is not a REST credential.
  expect((await h.call('GET', '/settings', undefined, bearer)).statusCode).toBe(401);
  // last_used_at is kept, at most once a minute.
  const used = () => h.db.prepare('SELECT last_used_at FROM mcp_tokens WHERE id = ?').pluck();
  expect(used().get(m.read.id)).toBe(h.clock.t);

  await m.web('DELETE', `/mcp/tokens/${m.read.id}`);
  expect((await post(list, bearer)).statusCode).toBe(401);
  h.clock.t += 91 * 86_400_000; // past the default 90 days
  expect((await post(list, { authorization: `Bearer ${m.write.token}` })).statusCode).toBe(401);
});

test('a foreign Origin is refused; GET is 405; a 2025 client is served', async () => {
  const m = await mcpHarness();
  h = m.h;
  const bearer = { authorization: `Bearer ${m.read.token}` };
  const foreign = await post(list, { ...bearer, origin: 'https://evil.example' });
  expect(foreign.statusCode).toBe(403);
  expect(
    (await post(list, { ...bearer, host: 'mw.test', origin: 'http://mw.test' })).statusCode,
  ).toBe(200);
  const get = await h.app.inject({ method: 'GET', url: '/api/v1/mcp', headers: bearer });
  expect(get.statusCode).toBe(405);
  const init = await post(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'x', version: '1' },
      },
    },
    bearer,
  );
  expect(init.statusCode).toBe(200);
  expect(init.body).toContain('"name":"milewage"');
});

test('read tools answer what the REST API answers, with the units', async () => {
  const m = await mcpHarness();
  h = m.h;
  const client = await connect(h, m.read.token);
  const tools = (await client.listTools()).tools;
  expect(tools.map((t) => t.name).slice(0, 2)).toEqual(['get_profile', 'get_summary']);
  expect(
    tools.every((t) => t.annotations?.readOnlyHint && t.annotations.openWorldHint === false),
  ).toBe(true);

  const profile = await client.callTool({ name: 'get_profile', arguments: {} });
  expect(resultOf(profile)).toMatchObject({
    currency: 'USD',
    distance_unit: 'mi',
    timezone: 'America/Chicago',
    today: '2027-01-15',
    vehicles: [{ id: 1, name: 'Civic' }],
  });
  expect(profile.structuredContent).toMatchObject({
    units: { money: 'integer cents of USD (12.50 is 1250)' },
  });

  const summary = await client.callTool({
    name: 'get_summary',
    arguments: { from: '2027-01-01', to: '2027-01-31' },
  });
  const rest = await m.web('GET', '/summary?from=2027-01-01&to=2027-01-31');
  expect(resultOf(summary)).toEqual(rest.json());
});

test('a REST problem is a tool error the model can act on; read-only mode still reads', async () => {
  const m = await mcpHarness();
  h = m.h;
  const client = await connect(h, m.read.token);
  const bad = await client.callTool({
    name: 'get_summary',
    arguments: { from: '2027-02-30', to: '2027-01-01' },
  });
  expect(bad.isError).toBe(true);
  expect(JSON.stringify(bad.content)).toContain('/from is not a calendar date');

  h.state.set('read_only', 'test');
  const ok = await client.callTool({ name: 'get_summary', arguments: {} });
  expect(ok.isError).toBeFalsy();
});
