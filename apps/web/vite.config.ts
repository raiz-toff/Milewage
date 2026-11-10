import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * MapLibre 6 starts its web worker from `maplibre-gl-worker.mjs`, looked up next to the library
 * module at run time, so the bundler never sees it. Without it in `assets/` the map shows no
 * line (the worker fails to load). It is emitted under its own name; the library adds `?v=<version>`
 * to the address, so an upgrade fetches a new copy.
 */
function mapWorker(): Plugin {
  const workerFile = () =>
    join(
      dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json')),
      'dist',
      'maplibre-gl-worker.mjs',
    );
  return {
    name: 'maplibre-worker',
    // The dev server pre-bundles the library into node_modules/.vite/deps, where the worker is
    // missing, so the map would draw nothing in development. Serve it there too.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0]?.endsWith('/maplibre-gl-worker.mjs')) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(workerFile()));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-worker.mjs',
        source: readFileSync(workerFile()),
      });
    },
  };
}

/**
 * The service worker (plan 27 section 4.2). It precaches the app shell and nothing else: no
 * runtime caching, so `/api` answers (private, `no-store`) never enter a cache. Navigations to
 * the app's screens get the precached index.html, but never `/api` (downloads) or `/healthz`.
 * After an update it waits until the driver presses Reload (`src/pwa/update.ts`). The MapLibre
 * worker (.mjs, fetched with `?v=`) stays out; the map needs the network for tiles anyway.
 */
export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  injectRegister: false,
  manifest: false, // public/manifest.webmanifest
  devOptions: { enabled: false },
  workbox: {
    globPatterns: ['**/*.{js,css,html,woff2,png,ico,svg,webmanifest}'],
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//, /^\/healthz$/],
    cleanupOutdatedCaches: true,
    inlineWorkboxRuntime: true,
    mode: 'production', // minified, without Workbox's dev logging, whatever NODE_ENV says
    runtimeCaching: [],
  },
};

// In development the API is the server on :3000. No changeOrigin: the server compares the
// Origin header with Host, so Host must stay the dev server's own.
/** The API the dev server proxies to; `npm run dev` sets it from MILEWAGE_DEV_PORT. */
const api = process.env.MILEWAGE_DEV_API ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss(), mapWorker(), VitePWA(pwaOptions)],
  resolve: { alias: { '@': join(import.meta.dirname, 'src') } },
  server: {
    // Lets a phone pair against the dev server through `tailscale serve` (plan 19 §3.6).
    allowedHosts: ['.ts.net'],
    proxy: {
      // The server leaves `Secure` off the session cookie on an http page itself (plan 28 H2), so
      // the dev server opened by IP over the LAN signs in without a workaround here.
      // Object form on purpose: a string target makes Vite rewrite Host to the API's address
      // (changeOrigin), and the server refuses every write whose Origin does not match Host.
      '/api': { target: api },
      '/healthz': { target: api },
      '/.well-known/oauth-': { target: api },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
