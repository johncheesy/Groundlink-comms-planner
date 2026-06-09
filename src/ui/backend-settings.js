/**
 * Coverage backend settings (M18).
 *
 * Lets the user switch the coverage engine between the built-in FSPL+Deygout
 * model and the optional hosted CloudRF ITM backend. The CloudRF API key is
 * user-entered at runtime and held in sessionStorage ONLY — never committed,
 * never sent anywhere but CloudRF (see CLAUDE.md OPSEC).
 */

import { testCloudRFKey } from '../backends/cloudrf.js';

const BACKEND_KEY = 'glBackend';
const APIKEY_KEY = 'glCloudRFKey';

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
 * @returns {{ getBackend():string, getApiKey():string }}
 */
export function createBackendSettings(container, { onBackendChange } = {}) {
  let backend = readStore(BACKEND_KEY) === 'cloudrf' ? 'cloudrf' : 'builtin';
  let apiKey = readStore(APIKEY_KEY) || '';

  container.innerHTML =
    `<div class="backend-radio-group" role="radiogroup" aria-label="Coverage backend">` +
    `<label class="check"><input type="radio" name="glBackend" value="builtin"${backend === 'builtin' ? ' checked' : ''} /><span>Built-in — FSPL+Deygout</span></label>` +
    `<label class="check"><input type="radio" name="glBackend" value="cloudrf"${backend === 'cloudrf' ? ' checked' : ''} /><span>CloudRF — ITM (API key)</span></label>` +
    `</div>` +
    `<div class="backend-key-row">` +
    `<input class="input" id="cloudrfKey" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="CloudRF API key" aria-label="CloudRF API key" />` +
    `<button class="btn" type="button" id="cloudrfTest">Test key</button>` +
    `</div>` +
    `<div class="backend-key-row">` +
    `<button class="btn" type="button" id="cloudrfSave">Save</button>` +
    `<button class="btn" type="button" id="cloudrfClear">Clear</button>` +
    `<span class="backend-test-status" id="cloudrfStatus" role="status" aria-live="polite"></span>` +
    `</div>` +
    `<p class="help">Your key is held in this browser session only — never uploaded or saved to disk.</p>`;

  const radios = container.querySelectorAll('input[name="glBackend"]');
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

  radios.forEach((r) => {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      backend = r.value === 'cloudrf' ? 'cloudrf' : 'builtin';
      writeStore(BACKEND_KEY, backend);
      onBackendChange?.(backend);
    });
  });

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
  };
}
