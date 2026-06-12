import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
// Both PWA plugins must act only on the top-level app build. Nested worker
// builds (each `new Worker(new URL(...))`, and geotiff's own decoder worker)
// run the same plugin hooks but never carry the app's main entry — and their
// closeBundle fires while the app build is still transforming.
// Key on the main entry chunk, NOT bundle['index.html']: Vite 6 emits the
// HTML after plugin generateBundle, so the html key never matched and both
// plugins silently no-opped — deploys shipped an unstamped sw.js (byte-
// identical across builds → clients pinned to their first cached build) and
// no sw-assets.json (404). See docs/fix-sw-update-stamping.md.
const isAppBundle = (bundle) =>
  Object.values(bundle).some(
    (o) => o.type === 'chunk' && o.isEntry && /^assets\/index-/.test(o.fileName),
  );

function swAssetsPlugin() {
  return {
    name: 'gl-sw-assets',
    apply: 'build',
    generateBundle(_, bundle) {
      if (!isAppBundle(bundle)) return; // worker sub-build — not the app shell
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

// Stamps the service worker with the build id (version+sha) after the public
// dir is copied to dist. A deploy thus always changes sw.js bytes — the
// browser's update check is a byte-diff of the SW script, so without this the
// new build never installs and clients keep the old cached shell (M23).
function swStampPlugin() {
  let sawAppBundle = false;
  return {
    name: 'gl-sw-stamp',
    apply: 'build',
    generateBundle(_, bundle) {
      if (isAppBundle(bundle)) sawAppBundle = true;
    },
    closeBundle() {
      if (!sawAppBundle) return; // a worker sub-build finishing early — skip
      sawAppBundle = false;
      const swPath = fileURLToPath(new URL('./dist/sw.js', import.meta.url));
      try {
        const stamped = readFileSync(swPath, 'utf8').replace(
          /__GL_BUILD_ID__/g,
          `${build.version}+${build.sha}`,
        );
        if (!stamped.includes(build.sha)) throw new Error('BUILD_ID placeholder not found in sw.js');
        writeFileSync(swPath, stamped);
      } catch (err) {
        // A deploy with an unstamped SW would silently strand clients on the
        // old build — fail the build loudly instead.
        throw new Error(`gl-sw-stamp: could not stamp dist/sw.js — ${err.message}`);
      }
    },
  };
}

// Relative base so the public-safe build works under a GitHub Pages subpath.
export default defineConfig({
  base: './',
  plugins: [swAssetsPlugin(), swStampPlugin()],
  define: {
    __GL_BUILD__: JSON.stringify(build),
  },
  server: {
    host: true,
    port: 5173,
  },
  // App workers are created with { type: 'module' } already; ES output is
  // required because geotiff (E1) carries a nested decoder worker, which
  // makes the worker bundles multi-chunk — unsupported by the iife default.
  worker: {
    format: 'es',
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
    // geotiff imports the `web-worker` shim, which crashes when loaded inside
    // vitest's threads pool. Inline geotiff so vite resolves its imports, then
    // alias the shim to a stub — tests never build a geotiff decoder pool.
    server: {
      deps: {
        inline: ['geotiff'],
      },
    },
    alias: {
      'web-worker': fileURLToPath(new URL('./src/test/web-worker-stub.js', import.meta.url)),
    },
  },
});
