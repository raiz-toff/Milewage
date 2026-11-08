import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { spaPaths } from '../src/screens';
import { THEME_COLORS } from '../src/theme';

// Plan 27 section 4.1: the web app manifest, its icons and the page's head tags.
const web = fileURLToPath(new URL('..', import.meta.url));
const pub = join(web, 'public');
const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(join(web, 'index.html'), 'utf8');
const caddyfile = readFileSync(join(web, '../../infra/docker/Caddyfile'), 'utf8');

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): string {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString('latin1'), `${path} is a PNG`).toBe('PNG');
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

const file = (src: string) => join(pub, src.replace(/^\//, ''));
const inScope = (url: string) => url.startsWith(manifest.scope);

describe('web app manifest', () => {
  it('meets the install criteria of Chrome, Edge and Safari', () => {
    expect(manifest.name).toBe('MileWage');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12); // fits under a home screen icon
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(inScope(manifest.start_url)).toBe(true);
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
    expect(manifest.prefer_related_applications).not.toBe(true);
    const any = (manifest.icons as Icon[]).filter((i) => (i.purpose ?? 'any') === 'any');
    expect(any.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512']);
    const maskable = (manifest.icons as Icon[]).filter((i) => i.purpose === 'maskable');
    expect(maskable.map((i) => i.sizes)).toContain('512x512');
    expect((manifest.icons as Icon[]).some((i) => i.purpose === 'monochrome')).toBe(true);
  });

  it('every icon is a file of the size it claims', () => {
    const icons: Icon[] = [
      ...manifest.icons,
      ...manifest.shortcuts.flatMap((s: { icons: Icon[] }) => s.icons),
    ];
    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      expect(pngSize(file(icon.src)), icon.src).toBe(icon.sizes);
    }
  });

  it('opens on the light theme, the web default, with its page colour', () => {
    expect(manifest.theme_color).toBe(THEME_COLORS.light);
    expect(manifest.background_color).toBe(THEME_COLORS.light);
  });

  it('shortcuts open screens of the app', () => {
    expect(manifest.shortcuts.length).toBeGreaterThan(0);
    for (const s of manifest.shortcuts as { name: string; url: string }[]) {
      expect(s.name).not.toBe('');
      expect(inScope(s.url)).toBe(true);
      expect(spaPaths()).toContain(s.url);
    }
  });
});

describe('index.html head', () => {
  it('links the manifest, the favicon and the iOS home screen icon', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="48x48" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(pngSize(join(pub, 'apple-touch-icon.png'))).toBe('180x180');
    const ico = readFileSync(join(pub, 'favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1); // an icon file
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2); // more than one size
  });

  it('gives each OS theme its page colour, and names the app for iOS', () => {
    expect(html).toContain(
      `<meta name="theme-color" content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)" />`,
    );
    expect(html).toContain(
      `<meta name="theme-color" content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)" />`,
    );
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="MileWage" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
  });
});

/** Every path a Caddy `path` matcher or `handle <path>` names, outside the API. */
function caddyPaths(): string[] {
  const named = [...caddyfile.matchAll(/^\s*@\w+ path (.+)$/gm)].flatMap((m) =>
    m[1]!.trim().split(/\s+/),
  );
  const direct = [...caddyfile.matchAll(/^\s*handle (\/\S+) \{$/gm)].map((m) => m[1]!);
  return [...named, ...direct];
}

const served = (path: string) =>
  caddyPaths().some((p) => (p.endsWith('/*') ? path.startsWith(p.slice(0, -1)) : p === path));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('Caddy serves the web app files', () => {
  it('every file in apps/web/public has a route (else it is a 404 in the Docker stack)', () => {
    const files = walk(pub).map((f) => `/${relative(pub, f).split('\\').join('/')}`);
    expect(files).toContain('/manifest.webmanifest');
    for (const f of files) expect(served(f), f).toBe(true);
  });

  it('the manifest is revalidated on each visit and has its media type', () => {
    const block = /handle \/manifest\.webmanifest \{([\s\S]*?)\n\t\}/.exec(caddyfile)?.[1] ?? '';
    expect(block).toContain('header Cache-Control "no-cache"');
    expect(block).toContain('header Content-Type "application/manifest+json"');
  });
});
