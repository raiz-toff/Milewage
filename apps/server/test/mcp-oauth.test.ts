import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ACCESS_MS, REFRESH_MS, redirectAllowed } from '../src/mcp/oauth';
import { connect } from './mcp-support';
import { harness, type Harness } from './support';

// Connecting an assistant by signing in: discovery, registration, the driver's approval, the code
// exchange with PKCE, rotating refresh codes, and revoke from Settings.
let h: Harness;
let cookie: string;
const REDIRECT = 'http://localhost:5555/callback';
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

const root = (url: string) => h.app.inject({ method: 'GET', url, headers: { host: 'mw.test' } });
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const token = (form: Record<string, string>) =>
  h.app.inject({
    method: 'POST',
    url: '/api/v1/oauth/token',
    headers: { host: 'mw.test', 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(form).toString(),
  });
const register = (body: object) =>
  h.app.inject({ method: 'POST', url: '/api/v1/oauth/register', payload: body });

async function clientId() {
  const res = await register({ client_name: 'Claude Code', redirect_uris: [REDIRECT] });
  expect(res.statusCode).toBe(201);
  return res.json().client_id as string;
}
const ask = (client: string, extra: Record<string, string> = {}) => ({
  client_id: client,
  redirect_uri: REDIRECT,
  response_type: 'code',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'st8',
  resource: 'http://mw.test/api/v1/mcp',
  ...extra,
});
/** Approves on the web page's API and returns the code from the redirect. */
async function approve(client: string, access: 'read' | 'write' = 'read') {
  const res = await web('POST', '/oauth/authorize', { ...ask(client), decision: 'allow', access });
  expect(res.statusCode).toBe(200);
  const back = new URL(res.json().redirect_to);
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  expect(back.searchParams.get('state')).toBe('st8');
  expect(back.searchParams.get('iss')).toBe('http://mw.test');
  return back.searchParams.get('code')!;
}
const exchange = (client: string, code: string, extra: Record<string, string> = {}) =>
  token({
    grant_type: 'authorization_code',
    code,
    client_id: client,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
    ...extra,
  });

beforeEach(async () => {
  h = harness({ mcp: true });
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

describe('discovery', () => {
  test('the MCP endpoint answers 401 with where to sign in', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { host: 'mw.test' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain(
      'resource_metadata="http://mw.test/.well-known/oauth-protected-resource/api/v1/mcp"',
    );
  });

  test('both documents name this server and its endpoints', async () => {
    const pr = await root('/.well-known/oauth-protected-resource/api/v1/mcp');
    expect(pr.statusCode, pr.body).toBe(200);
    expect(pr.json()).toMatchObject({
      resource: 'http://mw.test/api/v1/mcp',
      authorization_servers: ['http://mw.test'],
      scopes_supported: ['read', 'write'],
    });
    const as = (await root('/.well-known/oauth-authorization-server')).json();
    expect(as).toMatchObject({
      issuer: 'http://mw.test',
      authorization_endpoint: 'http://mw.test/oauth/authorize',
      token_endpoint: 'http://mw.test/api/v1/oauth/token',
      registration_endpoint: 'http://mw.test/api/v1/oauth/register',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  test('with the module off there is nothing to discover', async () => {
    await h.close();
    h = harness({ mcp: false });
    expect((await root('/.well-known/oauth-authorization-server')).statusCode).toBe(404);
    expect((await register({ redirect_uris: [REDIRECT] })).statusCode).toBe(404);
  });
});

describe('registration', () => {
  test.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://127.0.0.1:33418/callback', true],
    ['http://[::1]:8080/cb', true],
    ['cursor://anysphere.cursor-retrieval/oauth/callback', true],
    ['http://evil.example/cb', false],
    ['https://x.example/cb#frag', false],
    ['https://user@x.example/cb', false],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
  ])('%s allowed: %s', (uri, ok) => expect(redirectAllowed(uri)).toBe(ok));

  test('refuses a bad redirect or a confidential client', async () => {
    expect((await register({ redirect_uris: ['http://evil.example/cb'] })).json().error).toBe(
      'invalid_redirect_uri',
    );
    expect((await register({})).statusCode).toBe(400);
    const secret = { redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post' };
    expect((await register(secret)).json().error).toBe('invalid_client_metadata');
  });
});

describe('approval', () => {
  test('the page needs a session and shows who is asking', async () => {
    const client = await clientId();
    const q = new URLSearchParams(ask(client)).toString();
    const anon = await h.call('GET', `/oauth/authorize?${q}`);
    expect(anon.statusCode).toBe(401);
    const res = await web('GET', `/oauth/authorize?${q}`);
    expect(res.json()).toEqual({
      client_name: 'Claude Code',
      redirect_uri: REDIRECT,
      scope: 'read',
    });
    const write = new URLSearchParams(ask(client, { scope: 'read write' })).toString();
    expect((await web('GET', `/oauth/authorize?${write}`)).json().scope).toBe('write');
  });

  test.each([
    ['an unknown client', { client_id: 'nope' }],
    ['an unregistered return address', { redirect_uri: 'http://localhost:1/other' }],
    ['no PKCE', { code_challenge: '' }],
    ['plain PKCE', { code_challenge_method: 'plain' }],
    ['another resource', { resource: 'http://mw.test/api/v1/shifts' }],
  ])('refuses %s on the page, without redirecting', async (_n, bad) => {
    const client = await clientId();
    const res = await web('POST', '/oauth/authorize', { ...ask(client, bad), decision: 'allow' });
    expect(res.statusCode).toBe(422);
    expect(res.json().redirect_to).toBeUndefined();
  });

  test('saying no sends the assistant access_denied and makes nothing', async () => {
    const client = await clientId();
    const res = await web('POST', '/oauth/authorize', { ...ask(client), decision: 'deny' });
    const back = new URL(res.json().redirect_to);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
    expect((await web('GET', '/mcp/tokens')).json()).toEqual([]);
  });
});

describe('codes', () => {
  test('a read connection reads, renews, is listed and can be revoked', async () => {
    const client = await clientId();
    const res = await exchange(client, await approve(client));
    expect(res.statusCode).toBe(200);
    const t = res.json();
    expect(t).toMatchObject({ token_type: 'Bearer', expires_in: ACCESS_MS / 1000, scope: 'read' });
    expect(t.access_token).toMatch(/^mwa_/);
    expect(t.refresh_token).toMatch(/^mwr_/);
    expect(res.headers['cache-control']).toBe('no-store');

    const mcp = await connect(h, t.access_token);
    const names = (await mcp.listTools()).tools.map((x) => x.name);
    expect(names).toContain('get_summary');
    expect(names).not.toContain('add_expense');
    await mcp.close();

    const [row] = (await web('GET', '/mcp/tokens')).json();
    expect(row).toMatchObject({
      name: 'Claude Code',
      kind: 'sign_in',
      scope: 'read',
      expires_at: h.clock.t + REFRESH_MS,
    });

    // After an hour the access code is out of date; the refresh code gives new ones once.
    h.clock.t += ACCESS_MS + 1;
    await expect(connect(h, t.access_token)).rejects.toThrow();
    const renewed = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    expect(renewed.statusCode).toBe(200);
    const again = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    expect(again.json().error).toBe('invalid_grant');
    await (await connect(h, renewed.json().access_token)).close();
    expect((await web('GET', '/mcp/tokens')).json()).toHaveLength(1);

    await web('DELETE', `/mcp/tokens/${row.id}`);
    const after = { grant_type: 'refresh_token', refresh_token: renewed.json().refresh_token };
    expect((await token(after)).json().error).toBe('invalid_grant');
    await expect(connect(h, renewed.json().access_token)).rejects.toThrow();
  });

  test('a write connection gets the write tools', async () => {
    const client = await clientId();
    const t = (await exchange(client, await approve(client, 'write'))).json();
    expect(t.scope).toBe('read write');
    const mcp = await connect(h, t.access_token);
    expect((await mcp.listTools()).tools.map((x) => x.name)).toContain('add_expense');
    await mcp.close();
  });

  test('a code is used once, by its own client, with the right verifier, within a minute', async () => {
    const client = await clientId();
    const other = await clientId();
    let code = await approve(client);
    expect((await exchange(client, code, { code_verifier: 'x'.repeat(43) })).json().error).toBe(
      'invalid_grant',
    );
    expect((await exchange(client, code)).json().error).toBe('invalid_grant'); // already spent
    code = await approve(client);
    expect((await exchange(other, code)).json().error).toBe('invalid_grant');
    code = await approve(client);
    h.clock.t += 61_000;
    expect((await exchange(client, code)).json().error).toBe('invalid_grant');
    expect((await token({ grant_type: 'password' })).json().error).toBe('unsupported_grant_type');
  });
});
