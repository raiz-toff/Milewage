import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
    expect(a).toEqual(['/', '/pair', '/app', '/onboarding', '/onboarding/*', '/a', '/a/*']);
    expect(spaPaths([{ path: '/b', label: 'B', element: null }])).toEqual([
      '/',
      '/pair',
      '/app',
      '/onboarding',
      '/onboarding/*',
      '/b',
    ]);
  });
});

const compose = readFileSync(
  new URL('../../../infra/docker/docker-compose.yml', import.meta.url),
  'utf8',
);

describe('Caddy keeps the forwarded headers of the host proxy (plan 19 section 3.1)', () => {
  it('trusts exactly the Docker gateway, not every private address', () => {
    const block = /^\{\n([\s\S]*?)^\}/m.exec(caddyfile)![1]!;
    const trusted = /^\s*trusted_proxies (.+)$/m.exec(block);
    expect(trusted, 'trusted_proxies in the global block').not.toBeNull();
    expect(trusted![1]!.trim()).toBe('static {$MILEWAGE_PROXY_GATEWAY:172.29.88.1}/32');
  });

  it('the gateway Caddy trusts is the one the network is given, with the same default', () => {
    expect(compose).toContain('- MILEWAGE_PROXY_GATEWAY=${MILEWAGE_PROXY_GATEWAY:-172.29.88.1}');
    expect(compose).toContain('gateway: ${MILEWAGE_PROXY_GATEWAY:-172.29.88.1}');
    expect(compose).toContain('subnet: ${MILEWAGE_PROXY_SUBNET:-172.29.88.0/24}');
  });
});
