import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Chalk server serves the built UI from dist/web. In dev, Vite proxies to a
// running server (`npm run dev:mock` at the repo root, which listens on 4747).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: '../../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4747', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4747', ws: true, changeOrigin: true },
    },
  },
});
