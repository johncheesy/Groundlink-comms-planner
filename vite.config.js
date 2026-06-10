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

// Emits dist/sw-assets.json — the list of hashed build assets the service
// worker pre-caches for the offline app shell (M17). Paths are relative
// (no leading slash) so the SW resolves them against its own scope under the
// GitHub Pages subpath; .map files are excluded.
function swAssetsPlugin() {
  return {
    name: 'gl-sw-assets',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle)
        .filter((k) => !k.endsWith('.map'))
        .map((k) => k.split('\\').join('/'));
      this.emitFile({
        type: 'asset',
        fileName: 'sw-assets.json',
        source: JSON.stringify(assets, null, 2),
      });
    },
  };
}

// Relative base so the public-safe build works under a GitHub Pages subpath.
export default defineConfig({
  base: './',
  plugins: [swAssetsPlugin()],
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
    rollupOptions: {
      output: {
        // Split MapLibre GL (the bulk of the bundle) into its own chunk: it
        // changes rarely, so it caches across app deploys and downloads in
        // parallel with the app code instead of inflating one ~1.3 MB file.
        // (jszip is already split via its dynamic import in src/io/import.js.)
        manualChunks: {
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
  // vitest 4's default `forks` pool times out spawning a worker per test file
  // here — the repo path has spaces ("THE GROUNDLINK/…") and each worker re-
  // imports maplibre-gl (~6 s), so under load the per-file spawn races the
  // pool timeout and files fail to start. Run the whole suite in one persistent
  // threads worker: heavy modules import once, nothing is repeatedly spawned,
  // and the actual test bodies take ~40 ms. Reliable and faster.
  // Vitest 4 removed `poolOptions` — the equivalent single persistent worker
  // is now expressed top-level: one threads worker, no per-file parallelism.
  test: {
    pool: 'threads',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
});
