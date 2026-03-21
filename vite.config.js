import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: 'src',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': {
        target: 'http://localhost:5174',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:5174',
      },
      '/lib/xterm': {
        target: 'http://localhost:5174',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
