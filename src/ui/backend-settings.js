/**
 * Coverage backend / propagation-model settings (M18 + E2).
 *
 * One selector for all engines: Auto (P.1812 when terrain is on), the built-in
 * ITU-R P.1812 engine (E2), the FSPL+Deygout fallback, and the optional hosted
 * CloudRF ITM backend. P.1812 exposes its time/location percentiles (p / pL,
 * default 50/50 — the "typical" plot). The CloudRF API key is user-entered at
 * runtime and held in sessionStorage ONLY — never committed, never sent
 * anywhere but CloudRF (see CLAUDE.md OPSEC).
 */

import { testCloudRFKey } from '../backends/cloudrf.js';

const BACKEND_KEY = 'glBackend';
const APIKEY_KEY = 'glCloudRFKey';
const BACKENDS = ['auto', 'p1812', 'builtin', 'cloudrf'];

// sessionStorage is unavailable in sandboxed previews — degrade to in-memory.
function readStore(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeStore(key, val) {
  try { sessionStorage.setItem(key, val); return true; } catch { return false; }
}
function removeStore(key) {
  try { sessionStorage.removeItem(key); } catch { /* sandboxed: no storage */ }
}

/**
 * @param {HTMLElement} container  host element (div#backendSettingsInner)
 * @param {{ onBackendChange?: (backend:string)=>void }} [opts]
 * @returns {{ getBackend():string, getApiKey():string, getPercentiles():{p:number,pL:number} }}
 */
export function createBackendSettings(container, { onBackendChange } = {}) {
  const stored = readStore(BACKEND_KEY);
  let backend = BACKENDS.includes(stored) ? stored : 'builtin';
  let apiKey = readStore(APIKEY_KEY) || '';

  const radio = (value, label) =>
    `<label class="check"><input type="radio" name="glBackend" value="${value}"${backend === value ? ' checked' : ''} /><span>${label}</span></label>`;

  container.innerHTML =
    `<div class="backend-radio-group" role="radiogroup" aria-label="Propagation model">` +
    radio('auto', 'Auto — P.1812 when terrain is on') +
    radio('p1812', 'P.1812 — ITU-R terrain diffraction (built-in)') +
    radio('builtin', 'FSPL+Deygout — instant fallback') +
    radio('cloudrf', 'CloudRF — ITM (API key)') +
    `</div>` +
    `<div class="backend-key-row" id="p1812PctRow">` +
    `<label class="field-label" for="p1812P">Time %&nbsp;<input class="input input--mini" id="p1812P" type="number" value="50" min="1" max="50" step="1" /></label>` +
    `<label class="field-label" for="p1812PL">Location %&nbsp;<input class="input input--mini" id="p1812PL" type="number" value="50" min="1" max="99" step="1" /></label>` +
    `</div>` +
    `<p class="help" id="p1812PctHelp">P.1812 percentiles: signal level met for this share of time / locations. 50/50 is the typical plot; lower time % = stronger short-term signal, higher location % = more conservative.</p>` +
    `<div class="backend-key-row">` +
    `<input class="input" id="cloudrfKey" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="CloudRF API key" aria-label="CloudRF API key" />` +
    `<button class="btn" type="button" id="cloudrfTest">Test key</button>` +
    `</div>` +
    `<div class="backend-key-row">` +
    `<button class="btn" type="button" id="cloudrfSave">Save</button>` +
    `<button class="btn" type="button" id="cloudrfClear">Clear</button>` +
    `<span class="backend-test-status" id="cloudrfStatus" role="status" aria-live="polite"></span>` +
    `</div>` +
    `<p class="help">Your key is held in this browser session only — never uploaded or saved to disk. Note: running CloudRF sends the transmitter position and area to api.cloudrf.com.</p>`;

  const radios = container.querySelectorAll('input[name="glBackend"]');
  const pInput = container.querySelector('#p1812P');
  const pLInput = container.querySelector('#p1812PL');
  const pctRow = container.querySelector('#p1812PctRow');
  const pctHelp = container.querySelector('#p1812PctHelp');
  const keyInput = container.querySelector('#cloudrfKey');
  const testBtn = container.querySelector('#cloudrfTest');
  const saveBtn = container.querySelector('#cloudrfSave');
  const clearBtn = container.querySelector('#cloudrfClear');
  const statusEl = container.querySelector('#cloudrfStatus');

  keyInput.value = apiKey;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.classList.toggle('ok', kind === 'ok');
    statusEl.classList.toggle('fail', kind === 'fail');
  }

  // Percentile inputs only mean something to the P.1812 engine.
  function syncPctVisibility() {
    const showPct = backend === 'p1812' || backend === 'auto';
    pctRow.hidden = !showPct;
    pctHelp.hidden = !showPct;
  }
  syncPctVisibility();

  radios.forEach((r) => {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      backend = BACKENDS.includes(r.value) ? r.value : 'builtin';
      writeStore(BACKEND_KEY, backend);
      syncPctVisibility();
      onBackendChange?.(backend);
    });
  });

  const clampPct = (input, lo, hi, dflt) => {
    const v = Number(input?.value);
    return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : dflt;
  };
  [pInput, pLInput].forEach((el) => el.addEventListener('change', () => onBackendChange?.(backend)));

  testBtn.addEventListener('click', async () => {
    const k = keyInput.value.trim();
    if (!k) { setStatus('Enter a key first', 'fail'); return; }
    setStatus('Testing…', null);
    testBtn.disabled = true;
    const ok = await testCloudRFKey(k);
    testBtn.disabled = false;
    setStatus(ok ? 'Key OK' : 'Key rejected', ok ? 'ok' : 'fail');
  });

  saveBtn.addEventListener('click', () => {
    apiKey = keyInput.value.trim();
    const stored = writeStore(APIKEY_KEY, apiKey);
    setStatus(stored ? 'Saved for this session' : 'Saved (in-memory only)', 'ok');
  });

  clearBtn.addEventListener('click', () => {
    apiKey = '';
    keyInput.value = '';
    removeStore(APIKEY_KEY);
    setStatus('Cleared', null);
  });

  return {
    getBackend: () => backend,
    getApiKey: () => apiKey,
    getPercentiles: () => ({ p: clampPct(pInput, 1, 50, 50), pL: clampPct(pLInput, 1, 99, 50) }),
  };
}
