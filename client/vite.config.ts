import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  build: { outDir: resolve(__dirname, '../dist'), emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4242', changeOrigin: true },
      '/hook': { target: 'http://127.0.0.1:4242', changeOrigin: true },
    },
  },
});
