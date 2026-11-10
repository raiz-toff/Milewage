import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveModuleConfig } from '@milewage/shared';
import { upgradeDefaults } from '../src/assembly';
import { serverModules } from '../src/modules';
import { loadMigrations, MIGRATIONS_DIR, migrate, openDatabase } from '../src/index';
import { harness, type Harness } from './support';

// Issue 6: assistants behind the owner's own reverse proxy. The sign-in documents use the
// configured address for its host, Settings tests the connection, and a server from before 0.2.0
// keeps the endpoint off.
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const PR = '/.well-known/oauth-protected-resource/api/v1/mcp';
const get = (url: string, headers: Record<string, string>) =>
  h!.app.inject({ method: 'GET', url, headers });

describe('the address assistants are told', () => {
  test('MILEWAGE_PUBLIC_URL wins for its own host, even when a proxy lost the https', async () => {
    h = harness({ mcp: true }, { publicUrl: 'https://milewage.lan' });
    // Caddy did not trust the owner's proxy, so the API sees plain http.
    const pr = (await get(PR, { host: 'milewage.lan', 'x-forwarded-proto': 'https' })).json();
    expect(pr).toMatchObject({
      resource: 'https://milewage.lan/api/v1/mcp',
      authorization_servers: ['https://milewage.lan'],
    });
    const as = (
      await get('/.well-known/oauth-authorization-server', { host: 'milewage.lan' })
    ).json();
    expect(as).toMatchObject({
      issuer: 'https://milewage.lan',
      authorization_endpoint: 'https://milewage.lan/oauth/authorize',
      token_endpoint: 'https://milewage.lan/api/v1/oauth/token',
    });
    const unauth = await h.app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { host: 'MileWage.lan:443' },
      payload: {},
    });
    expect(unauth.headers['www-authenticate']).toContain(
      'resource_metadata="https://milewage.lan/.well-known/oauth-protected-resource/api/v1/mcp"',
    );
  });

  test('another way in keeps its own address; the home address is used for its host', async () => {
    h = harness(
      { mcp: true },
      { publicUrl: 'https://milewage.lan', homeUrl: 'http://192.168.1.20:8080' },
    );
    const lan = (await get(PR, { host: '192.168.1.20:8080' })).json();
    expect(lan.resource).toBe('http://192.168.1.20:8080/api/v1/mcp');
    const other = (await get(PR, { host: 'box.local:8080' })).json();
    expect(other.resource).toBe('http://box.local:8080/api/v1/mcp');
  });
});

describe('Test connection', () => {
  async function check(
    address: string,
    headers: Record<string, string>,
    extra: Parameters<typeof harness>[1] = {},
  ) {
    h = harness({ mcp: true }, extra);
    const { cookie } = await h.signUp();
    const res = await h.call(
      'GET',
      `/mcp/connection?address=${encodeURIComponent(address)}`,
      undefined,
      { cookie, ...headers },
    );
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as {
      ok: boolean;
      mcp_url: string;
      seen: { protocol: string; host: string; via: string | null };
      findings: { code: string; message: string }[];
    };
  }
  const codes = (r: { findings: { code: string }[] }) => r.findings.map((f) => f.code);

  test('an untrusted proxy: wrong address, and the address to trust', async () => {
    const r = await check('https://milewage.lan', {
      host: 'milewage.lan',
      'x-forwarded-for': '192.168.1.10',
    });
    expect(r.ok).toBe(false);
    expect(r.mcp_url).toBe('http://milewage.lan/api/v1/mcp');
    expect(r.seen).toEqual({ protocol: 'http', host: 'milewage.lan', via: '192.168.1.10' });
    expect(codes(r)).toEqual(['wrong_address', 'proxy_not_trusted', 'own_certificate']);
    const trust = r.findings.find((f) => f.code === 'proxy_not_trusted')!.message;
    expect(trust).toContain('192.168.1.10');
    expect(trust).toContain('MILEWAGE_TRUSTED_PROXIES');
    const cert = r.findings.find((f) => f.code === 'own_certificate')!.message;
    expect(cert).toContain('NODE_EXTRA_CA_CERTS');
    expect(cert).toContain('*.lan');
  });

  test('the same proxy with MILEWAGE_PUBLIC_URL set: assistants connect', async () => {
    const r = await check(
      'https://milewage.lan',
      { host: 'milewage.lan', 'x-forwarded-for': '192.168.1.10' },
      { publicUrl: 'https://milewage.lan' },
    );
    expect(r.ok).toBe(true);
    expect(r.mcp_url).toBe('https://milewage.lan/api/v1/mcp');
    // The proxy is still untrusted; that is said, but it no longer stops assistants.
    expect(codes(r)).toEqual(['proxy_not_trusted', 'own_certificate']);
  });

  test('a trusted proxy that sends no X-Forwarded-Proto', async () => {
    const r = await check('https://mw.home.lan', {
      host: 'mw.home.lan',
      'x-forwarded-for': '203.0.113.7, 192.168.1.10',
    });
    expect(codes(r)).toEqual(['wrong_address', 'forwarded_proto_missing', 'own_certificate']);
    // Three labels: a wildcard such as *.home.lan is fine, so no wildcard warning.
    expect(r.findings.at(-1)!.message).not.toContain('wildcard');
  });

  test('a proxy that changes the host name', async () => {
    const r = await check('http://milewage.lan', { host: '172.29.88.2:8080' });
    expect(codes(r)).toEqual(['wrong_address', 'host_changed']);
    expect(r.findings[1]!.message).toContain('proxy_set_header Host $host');
  });

  test('all well: Tailscale through a trusted proxy', async () => {
    const r = await check(
      'https://box.tail1234.ts.net',
      {
        host: 'box.tail1234.ts.net',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '100.64.0.5, 172.29.88.1',
      },
      { trustProxy: ['127.0.0.1'] },
    );
    expect(r).toMatchObject({ ok: true, findings: [] });
    expect(r.seen.protocol).toBe('https');
  });

  test('needs a session and an address', async () => {
    h = harness({ mcp: true });
    const { cookie } = await h.signUp();
    expect((await h.call('GET', '/mcp/connection?address=x')).statusCode).toBe(401);
    for (const bad of ['', 'not an address', 'ftp://milewage.lan']) {
      const res = await h.call(
        'GET',
        `/mcp/connection?address=${encodeURIComponent(bad)}`,
        undefined,
        { cookie },
      );
      expect(res.statusCode, bad).toBe(422);
    }
  });
});

describe('a server from before 0.2.0 keeps the endpoint off', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  /**
   * A database without the mcp migrations from `upTo` on (`0003`: as 0.1.0 left it; `0004`: as
   * 0.2.0 did), then the owner, then everything since.
   */
  function upgraded(o: { ownerAt: 'before' | 'after'; token?: boolean; upTo?: '0003' | '0004' }) {
    const dir = mkdtempSync(join(tmpdir(), 'mw-kept-'));
    dirs.push(dir);
    const db = openDatabase(join(dir, 'milewage.db'));
    const all = loadMigrations(MIGRATIONS_DIR);
    const upTo = o.upTo ?? '0003';
    migrate(
      db,
      all.filter((m) => !(m.module === 'mcp' && m.id >= upTo)),
    );
    {
      db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(
        'owner',
        'x',
        o.ownerAt === 'before' ? 1 : Date.now() + 60_000,
      );
      if (o.token) {
        db.prepare(
          "INSERT INTO mcp_tokens (user_id, name, scope, token_hash, created_at) VALUES (1, 'a', 'read', 'h', 1)",
        ).run();
      }
    }
    migrate(db, all);
    const settings = upgradeDefaults(db, {});
    db.close();
    return settings;
  }
  const mcpOn = (settings: object, env: Record<string, string> = {}) =>
    resolveModuleConfig(serverModules, settings, env).mcp;

  test('an owner from 0.1.0 with no assistant: off, unless the owner turns it on', () => {
    const settings = upgraded({ ownerAt: 'before' });
    expect(settings).toEqual({ modules: { mcp: false } });
    expect(mcpOn(settings)).toBe(false);
    expect(mcpOn(settings, { MILEWAGE_MODULE_MCP: '1' })).toBe(true);
    expect(mcpOn(settings, { MILEWAGE_MODULE_MCP: '' })).toBe(false);
  });

  test('an owner from 0.1.0 who made a code: stays on', () => {
    expect(mcpOn(upgraded({ ownerAt: 'before', token: true }))).toBe(true);
  });

  test('a server set up on 0.2.0 (owner after the sign-in tables): stays on', () => {
    // Only 0004 is new; 0003 ran before the owner existed.
    expect(mcpOn(upgraded({ ownerAt: 'after', upTo: '0004' }))).toBe(true);
  });

  test('a new server: on; settings.json still decides when it says something', () => {
    h = harness();
    expect(h.db.prepare('SELECT count(*) FROM mcp_kept_off').pluck().get()).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), 'mw-kept-'));
    dirs.push(dir);
    const db = openDatabase(join(dir, 'milewage.db'));
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    db.prepare('INSERT INTO mcp_kept_off (id, since) VALUES (1, 1)').run();
    expect(upgradeDefaults(db, { modules: { mcp: true } })).toEqual({ modules: { mcp: true } });
    db.close();
  });
});
