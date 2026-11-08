import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

describe('production build', () => {
  it('ships the MapLibre worker next to the library chunk, where the library looks for it', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mw-web-'));
    try {
      await build({
        root: fileURLToPath(new URL('..', import.meta.url)),
        logLevel: 'silent',
        build: { outDir: out, emptyOutDir: true, write: true },
      });
      const assets = readdirSync(join(out, 'assets'));
      expect(assets.some((f) => /^maplibre-gl-.*\.js$/.test(f))).toBe(true);
      expect(existsSync(join(out, 'assets', 'maplibre-gl-worker.mjs'))).toBe(true);
      expect(existsSync(join(out, 'index.html'))).toBe(true);
      // Plan 27: the manifest and its icons are copied to the root, where the page links them.
      for (const f of ['manifest.webmanifest', 'favicon.ico', 'apple-touch-icon.png'])
        expect(existsSync(join(out, f)), f).toBe(true);
      expect(readdirSync(join(out, 'icons'))).toContain('maskable-512.png');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
