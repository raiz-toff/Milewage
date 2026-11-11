import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENFREEMAP } from '../src/map/style';
import { publicPages } from '../src/publicPages';
import { spaPaths } from '../src/screens';

const caddyfile = readFileSync(new URL('../../../infra/docker/Caddyfile', import.meta.url), 'utf8');

describe('Caddyfile screen list', () => {
  it('serves index.html for exactly the paths in screens.tsx', () => {
    const line = /^\s*@spa path (.+)$/m.exec(caddyfile);
    expect(line, 'an @spa matcher exists').not.toBeNull();
    expect(line![1]!.trim().split(/\s+/).sort()).toEqual(spaPaths().sort());
  });

  it('turns a pattern into its bare path and its wildcard', () => {
    const a = spaPaths([{ path: '/a/*', label: 'A', element: null }]);
    expect(a).toEqual([
      '/',
      '/pair',
      '/app',
      '/privacy',
      '/onboarding',
      '/onboarding/*',
      '/a',
      '/a/*',
    ]);
    expect(spaPaths([{ path: '/b', label: 'B', element: null }])).toEqual([
      '/',
      '/pair',
      '/app',
      '/privacy',
      '/onboarding',
      '/onboarding/*',
      '/b',
    ]);
  });

  it('serves every public page (no sign-in) as a web page', () => {
    const served = /^\s*@spa path (.+)$/m.exec(caddyfile)![1]!.trim().split(/\s+/);
    expect(Object.keys(publicPages).sort()).toEqual(['/app', '/pair', '/privacy']);
    for (const path of Object.keys(publicPages)) expect(served).toContain(path);
  });
});

/** The site-wide response headers (08 response headers, decision 1.11). */
const csp = (() => {
  const line = /^\s*\?Content-Security-Policy "([^"]+)"$/m.exec(caddyfile);
  if (!line) return null;
  return new Map(
    line[1]!
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .map(([name, ...values]) => [name!, values] as const),
  );
})();

describe('Content-Security-Policy', () => {
  it('is set for every answer, keeping a policy the API sets itself', () => {
    expect(csp, 'a ?Content-Security-Policy line in the site header block').not.toBeNull();
    const block = /^\theader \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)![1]!;
    expect(block).toContain('?Content-Security-Policy ');
  });

  it('allows scripts from this server only: no inline script, no eval', () => {
    expect(csp!.get('default-src')).toEqual(["'self'"]);
    expect(csp!.get('script-src')).toEqual(["'self'"]);
    expect(caddyfile).not.toContain('unsafe-eval');
    expect(csp!.get('object-src')).toEqual(["'none'"]);
    expect(csp!.get('base-uri')).toEqual(["'self'"]);
  });

  it('cannot be framed', () => {
    expect(csp!.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('lets the map reach every outside host style.ts names, for data and for pictures', () => {
    const source = readFileSync(new URL('../src/map/style.ts', import.meta.url), 'utf8');
    const hosts = new Set([
      ...Object.values(OPENFREEMAP).map((u) => new URL(u).origin),
      ...[...source.matchAll(/https:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]),
    ]);
    expect(hosts.size).toBeGreaterThan(0);
    for (const origin of hosts) {
      expect(csp!.get('connect-src')).toContain(origin);
      expect(csp!.get('img-src')).toContain(origin);
    }
    expect(csp!.get('connect-src')![0]).toBe("'self'");
  });

  it('lets MapLibre start its worker and the app load its manifest and fonts from here', () => {
    expect(csp!.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(csp!.get('manifest-src')).toEqual(["'self'"]);
    expect(csp!.get('font-src')).toEqual(["'self'"]);
    expect(csp!.get('img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']));
  });
});

describe('Strict-Transport-Security', () => {
  it('is sent only when the request came over https through the host proxy', () => {
    const matcher = /^\s*@(\w+) header X-Forwarded-Proto https$/m.exec(caddyfile);
    expect(matcher, 'a matcher on X-Forwarded-Proto: https').not.toBeNull();
    const name = matcher![1]!;
    expect(caddyfile).toMatch(
      new RegExp(`^\\s*header @${name} Strict-Transport-Security "max-age=31536000"$`, 'm'),
    );
    // Not in the unconditional header block.
    const block = /^\theader \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)![1]!;
    expect(block).not.toContain('Strict-Transport-Security');
    expect(caddyfile.match(/Strict-Transport-Security "/g)).toHaveLength(1);
  });
});

const compose = readFileSync(
  new URL('../../../infra/docker/docker-compose.yml', import.meta.url),
  'utf8',
);

describe('Caddy keeps the forwarded headers of the host proxy (plan 19 section 3.1)', () => {
  it('trusts exactly the Docker gateway and the proxies the owner names, not every private address', () => {
    const block = /^\{\n([\s\S]*?)^\}/m.exec(caddyfile)![1]!;
    const trusted = /^\s*trusted_proxies (.+)$/m.exec(block);
    expect(trusted, 'trusted_proxies in the global block').not.toBeNull();
    expect(trusted![1]!.trim()).toBe(
      'static {$MILEWAGE_PROXY_GATEWAY:172.29.88.1}/32 {$MILEWAGE_TRUSTED_PROXIES}',
    );
    // Empty unless the owner names a proxy in .env (install.md section 7); no edit of this file.
    expect(compose).toContain('- MILEWAGE_TRUSTED_PROXIES=${MILEWAGE_TRUSTED_PROXIES:-}');
    expect(compose).toContain(
      '- MILEWAGE_TRUST_PROXY=${MILEWAGE_PROXY_SUBNET:-172.29.88.0/24},${MILEWAGE_TRUSTED_PROXIES:-}',
    );
  });

  it('the gateway Caddy trusts is the one the network is given, with the same default', () => {
    expect(compose).toContain('- MILEWAGE_PROXY_GATEWAY=${MILEWAGE_PROXY_GATEWAY:-172.29.88.1}');
    expect(compose).toContain('gateway: ${MILEWAGE_PROXY_GATEWAY:-172.29.88.1}');
    expect(compose).toContain('subnet: ${MILEWAGE_PROXY_SUBNET:-172.29.88.0/24}');
  });
});
