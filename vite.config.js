import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Build stamp injected at build time → shown in the ALPHA badge (bottom-right).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
let sha = 'dev';
try {
  sha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout — keep 'dev' */
}
const build = {
  channel: 'alpha',
  version: pkg.version,
  sha,
  date: new Date().toISOString().slice(0, 10),
};

// Relative base so the public-safe build works under a GitHub Pages subpath.
export default defineConfig({
  base: './',
  define: {
    __GL_BUILD__: JSON.stringify(build),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
