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
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
