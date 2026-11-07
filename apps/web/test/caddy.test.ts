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
    expect(a).toEqual(['/', '/pair', '/a', '/a/*']);
    expect(spaPaths([{ path: '/b', label: 'B', element: null }])).toEqual(['/', '/pair', '/b']);
  });
});
