import { defineConfig } from 'vite';

// Relative base so the public-safe build works under a GitHub Pages subpath.
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
