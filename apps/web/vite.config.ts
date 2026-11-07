import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * MapLibre 6 starts its web worker from `maplibre-gl-worker.mjs`, looked up next to the library
 * module at run time, so the bundler never sees it. Without it in `assets/` the map shows no
 * line (the worker fails to load). It is emitted under its own name; the library adds `?v=<version>`
 * to the address, so an upgrade fetches a new copy.
 */
function mapWorker(): Plugin {
  return {
    name: 'maplibre-worker',
    generateBundle() {
      const pkg = createRequire(import.meta.url).resolve('maplibre-gl/package.json');
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-worker.mjs',
        source: readFileSync(join(dirname(pkg), 'dist', 'maplibre-gl-worker.mjs')),
      });
    },
  };
}

// In development the API is the server on :3000. No changeOrigin: the server compares the
// Origin header with Host, so Host must stay the dev server's own.
export default defineConfig({
  plugins: [react(), tailwindcss(), mapWorker()],
  resolve: { alias: { '@': join(import.meta.dirname, 'src') } },
  server: {
    // Lets a phone pair against the dev server through `tailscale serve` (plan 19 §3.6).
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        // Dev only: the session cookie is Secure, which a browser drops on http:// at any address
        // but localhost. Stripping it here lets the dev server be opened by IP over the LAN.
        configure: (proxy) => {
          proxy.on('proxyRes', (res) => {
            const cookies = res.headers['set-cookie'];
            if (cookies)
              res.headers['set-cookie'] = cookies.map((c) => c.replace(/;\s*Secure/i, ''));
          });
        },
      },
      '/healthz': 'http://127.0.0.1:3000',
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
