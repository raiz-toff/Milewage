import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API is the server on :3000. No changeOrigin: the server compares the
// Origin header with Host, so Host must stay the dev server's own.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/healthz': 'http://127.0.0.1:3000' } },
  build: { outDir: 'dist', sourcemap: false },
});
