/**
 * Test-only stub for the `web-worker` package (geotiff's Worker shim).
 *
 * geotiff imports `web-worker` at module scope (dist-module/worker/create.js);
 * that shim throws when ITSELF loaded inside a worker_thread (it inspects
 * threads.workerData), which is exactly where vitest's `threads` pool runs
 * test files. GroundLink never constructs a geotiff decoder Pool in tests —
 * only writeArrayBuffer / fromBlob / readRasters without a pool — so the
 * Worker class is never instantiated. Wired up in vite.config.js `test.alias`
 * (effective because `server.deps.inline` routes geotiff through vite);
 * the browser build never sees this file.
 */
export default class StubWorker {
  constructor() {
    throw new Error('web-worker stub: decoder pools are not available under vitest');
  }
}
