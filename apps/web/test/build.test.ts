import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pwaOptions } from '../vite.config';
import { handleBlock, servedByCaddy, sitePaths } from './support/caddy';

const out = mkdtempSync(join(tmpdir(), 'mw-web-'));

beforeAll(async () => {
  await build({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true, write: true },
  });
}, 90_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('production build', () => {
  it('ships the MapLibre worker next to the library chunk, where the library looks for it', () => {
    const assets = readdirSync(join(out, 'assets'));
    expect(assets.some((f) => /^maplibre-gl-.*\.js$/.test(f))).toBe(true);
    expect(existsSync(join(out, 'assets', 'maplibre-gl-worker.mjs'))).toBe(true);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    // Plan 27: the manifest and its icons are copied to the root, where the page links them.
    for (const f of ['manifest.webmanifest', 'favicon.ico', 'apple-touch-icon.png'])
      expect(existsSync(join(out, f)), f).toBe(true);
    expect(readdirSync(join(out, 'icons'))).toContain('maskable-512.png');
  });

  it('Caddy has a route for every file outside assets/ (else a 404 in the Docker stack)', () => {
    const files = sitePaths(out).filter((f) => !f.startsWith('/assets/'));
    expect(files).toContain('/sw.js');
    for (const f of files) expect(servedByCaddy(f), f).toBe(true);
  });
});

describe('service worker (plan 27 section 4.2)', () => {
  const sw = () => readFileSync(join(out, 'sw.js'), 'utf8');
  const precached = () => [...sw().matchAll(/\burl:"([^"]+)"/g)].map((m) => m[1]!);

  it('is one file, with the Workbox runtime inside', () => {
    expect(sitePaths(out).filter((f) => /workbox/.test(f) && !f.startsWith('/assets/'))).toEqual(
      [],
    );
    expect(sw()).toContain('workbox:precaching');
  });

  it('precaches the app shell: the page, its scripts, styles, fonts, manifest and icons', () => {
    const list = precached();
    expect(list).toContain('index.html');
    expect(list).toContain('manifest.webmanifest');
    expect(list).toContain('icons/icon-192.png');
    const scripts = readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.js'));
    for (const f of scripts) expect(list, f).toContain(`assets/${f}`);
    expect(list.some((u) => u.endsWith('.woff2'))).toBe(true);
    expect(list).not.toContain('assets/maplibre-gl-worker.mjs');
  });

  it('precaches the Help pages in a lazy chunk, not in the entry chunk (ADR 0001)', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    const entry = /<script[^>]+src="\/(assets\/[^"]+\.js)"/.exec(html)![1]!;
    const text = (f: string) => readFileSync(join(out, f), 'utf8');
    const chunks = readdirSync(join(out, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => `assets/${f}`);
    // A sentence from a page body, and the Markdown renderer.
    const help = chunks.filter((f) => text(f).includes('Raw GPS is noisy.'));
    expect(help).toHaveLength(1);
    expect(help[0]).not.toBe(entry);
    expect(precached()).toContain(help[0]);
    expect(text(entry)).not.toContain('Raw GPS is noisy.');
    expect(text(entry)).not.toContain('remarkjs/react-markdown');
    expect(chunks.some((f) => text(f).includes('remarkjs/react-markdown'))).toBe(true);
  });

  it('caches no API answer: no runtime caching, and navigations under /api reach the server', () => {
    expect(pwaOptions.workbox?.runtimeCaching).toEqual([]);
    expect(precached().some((u) => u.includes('api'))).toBe(false);
    const deny = pwaOptions.workbox?.navigateFallbackDenylist ?? [];
    const fallsBack = (path: string) => !deny.some((r) => r.test(path));
    expect(fallsBack('/shifts/12')).toBe(true);
    expect(fallsBack('/api/v1/app/android.apk')).toBe(false);
    expect(fallsBack('/api/v1/exports/shifts.csv')).toBe(false);
    expect(fallsBack('/healthz')).toBe(false);
    expect(sw()).toContain('denylist:[/^\\/api\\//,/^\\/healthz$/]');
  });

  it('waits for the Reload button: skipWaiting only on the page message', () => {
    expect(sw().match(/skipWaiting\(\)/g)).toHaveLength(1);
    expect(sw()).toContain('"SKIP_WAITING"===t.data.type&&self.skipWaiting()');
  });

  it('Caddy serves sw.js and index.html (precached by name), asked for again on every check', () => {
    for (const f of ['/sw.js', '/index.html'])
      expect(handleBlock(f), f).toContain('header Cache-Control "no-cache"');
  });
});
