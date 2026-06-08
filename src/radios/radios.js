import LIBRARY from './library.json';
import {
  normalizeRadio,
  activeSetToCoverage,
  loadRadioSet,
  saveRadioSet,
} from './model.js';

/**
 * Radios controller (M5, main thread) — owns the radio set, the searchable
 * picker, the active infrastructure-tx + field-unit selection, the FCC/manual
 * add flow, and applying the active set to the coverage controls.
 *
 * Working list = curated library overlaid by the user's added/edited radios
 * (persisted on the hosted origin; in-memory elsewhere). Every spec is editable;
 * editing flips a radio's source to 'manual'.
 *
 * The "Radio mix" card lives in main.js (it needs mission + terrain stats); this
 * controller exposes getActive() so callers can fold the radios into that.
 */

// EAS Web API (KDB 953436) — tried best-effort; CORS on apps.fcc.gov is expected
// to block it from the browser, so failure is the normal path (see
// docs/decisions/0002-fcc-id-lookup.md). No scraping / no third-party fetch.
const FCC_EAS_TRY = (id) =>
  `https://apps.fcc.gov/oetcf/eas/reports/GenericSearchResult.cfm?calledFromFrame=N&fcc_id=${encodeURIComponent(id)}`;
const FCC_OFFICIAL_RECORD = (id) => `https://www.fcc.gov/oet/ea/fccid?fcc_id=${encodeURIComponent(id)}`;
const FCCIO_RECORD = (id) => `https://fccid.io/${encodeURIComponent(id)}`;

const ROLES = ['handheld', 'manpack', 'manet', 'mobile', 'base', 'repeater', 'lora', 'satcom', 'hf'];

export function createRadios(els, { onApply, onStatus, onArsenalChange } = {}) {
  let userRadios = []; // added / edited radios (persisted)
  let arsenal = []; // the radios you carry — drives node-role assignment (M7)
  let activeInfraId = null;
  let activeFieldId = null;

  // ── Persistence ────────────────────────────────────────────────────────
  const persisted = loadRadioSet();
  if (persisted) {
    userRadios = (persisted.userRadios || []).map(normalizeRadio);
    arsenal = (persisted.arsenal || []).map(normalizeRadio);
    activeInfraId = persisted.activeInfraId || null;
    activeFieldId = persisted.activeFieldId || null;
  }
  const persist = () => saveRadioSet({ userRadios, arsenal, activeInfraId, activeFieldId });

  // ── Working list (library overlaid by user radios) ─────────────────────
  function workingList() {
    const byId = new Map(LIBRARY.map((r) => [r.id, normalizeRadio(r)]));
    for (const r of userRadios) byId.set(r.id, r); // user override/add wins
    return [...byId.values()];
  }
  const findRadio = (id) => workingList().find((r) => r.id === id) || null;

  // ── Active set ─────────────────────────────────────────────────────────
  function getActive() {
    return { infra: findRadio(activeInfraId), field: findRadio(activeFieldId) };
  }

  function assign(slot, id) {
    if (slot === 'infra') activeInfraId = id;
    else activeFieldId = id;
    persist();
    reflectActive();
  }

  function reflectActive() {
    const { infra, field } = getActive();
    els.infraLabel.innerHTML = radioChip(infra);
    els.fieldLabel.innerHTML = radioChip(field);
    els.applyBtn.disabled = !infra && !field;
  }

  function radioChip(r) {
    if (!r) return '<span class="radio-slot__empty">— none —</span>';
    const band = `${trimNum(r.freqRangeMHz[0])}–${trimNum(r.freqRangeMHz[1])} MHz`;
    const ind = r.indicative ? ' <span class="badge badge--warn">indicative</span>' : '';
    const src = r.source === 'fcc' ? ' <span class="badge badge--ref">FCC</span>' : r.source === 'manual' ? ' <span class="badge badge--ref">edited</span>' : '';
    return `<span class="radio-slot__name">${esc(r.label)}</span> <span class="radio-slot__band" data-numeric>${band} · ${r.powerW} W</span>${ind}${src}`;
  }

  // ── Apply active set to coverage controls ──────────────────────────────
  function apply() {
    const { infra, field } = getActive();
    const vals = activeSetToCoverage(infra, field);
    if (!vals) return;
    onApply?.(vals, { infra, field });
    onStatus?.('Coverage controls set from the active radio set');
  }

  // ── Library search + results ───────────────────────────────────────────
  function renderResults(q = '') {
    const needle = q.trim().toLowerCase();
    const list = workingList()
      .filter((r) =>
        !needle ||
        r.label.toLowerCase().includes(needle) ||
        r.role.includes(needle) ||
        bandWord(r).includes(needle),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    els.results.innerHTML = '';
    if (!list.length) {
      els.results.innerHTML = '<li class="radio-result radio-result--empty">No matching radios</li>';
      return;
    }
    for (const r of list) {
      const li = document.createElement('li');
      li.className = 'radio-result';
      li.innerHTML =
        `<label class="radio-result__pick" title="Select for the arsenal"><input type="checkbox" class="radio-result__check" data-id="${esc(r.id)}" /></label>` +
        `<div class="radio-result__main">` +
        `<span class="radio-result__name">${esc(r.label)}</span>` +
        `<span class="radio-result__meta" data-numeric>${r.role} · ${trimNum(r.freqRangeMHz[0])}–${trimNum(r.freqRangeMHz[1])} MHz · ${r.powerW} W · ${Math.round(r.rxSensDbm)} dBm</span>` +
        `</div>` +
        `<div class="radio-result__btns">` +
        `<button type="button" class="btn btn--sm" data-act="infra">Infra</button>` +
        `<button type="button" class="btn btn--sm" data-act="field">Field</button>` +
        `<button type="button" class="btn btn--sm" data-act="edit">Edit</button>` +
        `</div>`;
      li.querySelector('[data-act="infra"]').addEventListener('click', () => assign('infra', r.id));
      li.querySelector('[data-act="field"]').addEventListener('click', () => assign('field', r.id));
      li.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(r));
      els.results.appendChild(li);
    }
  }

  // ── Editor / manual form ───────────────────────────────────────────────
  function openEditor(seed) {
    const form = els.editor;
    form.hidden = false;
    form.dataset.editId = seed?.id || '';
    form.querySelector('[name="label"]').value = seed?.label || '';
    const roleSel = form.querySelector('[name="role"]');
    roleSel.value = seed?.role || 'handheld';
    form.querySelector('[name="lo"]').value = seed?.freqRangeMHz?.[0] ?? '';
    form.querySelector('[name="hi"]').value = seed?.freqRangeMHz?.[1] ?? '';
    form.querySelector('[name="power"]').value = seed?.powerW ?? '';
    form.querySelector('[name="sens"]').value = seed?.rxSensDbm ?? '';
    form.querySelector('[name="label"]').focus();
  }

  function saveEditor() {
    const form = els.editor;
    const editId = form.dataset.editId;
    const get = (n) => form.querySelector(`[name="${n}"]`).value;
    const radio = normalizeRadio({
      id: editId || undefined,
      label: get('label') || 'Untitled radio',
      role: get('role'),
      freqRangeMHz: [Number(get('lo')), Number(get('hi'))],
      powerW: Number(get('power')),
      rxSensDbm: get('sens') === '' ? undefined : Number(get('sens')),
      source: 'manual', // any edit / manual add flips the source
    });
    upsertUserRadio(radio);
    form.hidden = true;
    renderResults(els.searchInput.value);
    onStatus?.(`Saved ${radio.label}`);
  }

  function upsertUserRadio(radio) {
    const i = userRadios.findIndex((r) => r.id === radio.id);
    if (i >= 0) userRadios[i] = radio;
    else userRadios.push(radio);
    persist();
  }

  // ── Arsenal (M7) — the radios you carry; drives node-role assignment ───
  const getArsenal = () => arsenal.map((r) => ({ ...r }));

  function addCheckedToArsenal() {
    let added = 0;
    els.results.querySelectorAll('.radio-result__check:checked').forEach((c) => {
      const r = findRadio(c.dataset.id);
      if (r && !arsenal.some((a) => a.id === r.id)) { arsenal.push(r); added += 1; }
      c.checked = false;
    });
    if (added) {
      persist();
      renderArsenal();
      onArsenalChange?.(getArsenal());
      onStatus?.(`Added ${added} radio${added > 1 ? 's' : ''} to the arsenal`);
    } else {
      onStatus?.('Tick radios in the list, then add them to the arsenal');
    }
  }

  function removeFromArsenal(id) {
    arsenal = arsenal.filter((a) => a.id !== id);
    persist();
    renderArsenal();
    onArsenalChange?.(getArsenal());
  }

  function renderArsenal() {
    if (!els.arsenalList) return;
    els.arsenalList.innerHTML = '';
    if (!arsenal.length) {
      els.arsenalList.innerHTML =
        '<li class="arsenal__empty">No radios yet — tick radios above, then “Add to arsenal”.</li>';
      return;
    }
    for (const r of arsenal) {
      const li = document.createElement('li');
      li.className = 'arsenal__row';
      li.innerHTML =
        `<span class="arsenal__name">${esc(r.label)}</span>` +
        `<span class="arsenal__meta" data-numeric>${r.role} · ${trimNum(r.freqRangeMHz[0])}–${trimNum(r.freqRangeMHz[1])} MHz · ${r.powerW} W</span>` +
        `<button type="button" class="arsenal__del" aria-label="Remove from arsenal" data-id="${esc(r.id)}">×</button>`;
      li.querySelector('.arsenal__del').addEventListener('click', () => removeFromArsenal(r.id));
      els.arsenalList.appendChild(li);
    }
  }

  // ── FCC ID lookup (best-effort) ────────────────────────────────────────
  async function fccLookup(rawId) {
    const id = (rawId || '').trim();
    if (!id) return;
    onStatus?.(`Looking up FCC ID ${id}…`);
    els.fccFallback.hidden = true;
    try {
      // Expected to throw on CORS in the browser — that is the normal path.
      const res = await fetch(FCC_EAS_TRY(id), { headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`FCC ${res.status}`);
      await res.text(); // we don't parse HTML here; reaching this is rare
      onStatus?.(`FCC responded for ${id} — confirm details in the manual form`);
    } catch {
      onStatus?.(`FCC lookup blocked (CORS) — open the record or enter specs manually`);
    }
    // Either way, offer the external record + a prefilled manual form.
    els.fccOfficial.href = FCC_OFFICIAL_RECORD(id);
    els.fccIo.href = FCCIO_RECORD(id);
    els.fccFallback.hidden = false;
    openEditor(normalizeRadio({ label: id, source: 'fcc' }));
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  els.applyBtn.addEventListener('click', apply);
  els.searchInput.addEventListener('input', () => renderResults(els.searchInput.value));
  els.editorSave.addEventListener('click', saveEditor);
  els.editorCancel.addEventListener('click', () => { els.editor.hidden = true; });
  els.fccBtn.addEventListener('click', () => fccLookup(els.fccInput.value));
  els.fccInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fccLookup(els.fccInput.value); } });
  els.addArsenalBtn?.addEventListener('click', addCheckedToArsenal);

  // Populate the role <select> once.
  els.editor.querySelector('[name="role"]').innerHTML = ROLES.map((r) => `<option value="${r}">${r}</option>`).join('');

  // Initial render + restore.
  renderResults('');
  renderArsenal();
  reflectActive();
  if (activeInfraId || activeFieldId) apply(); // restore the persisted set into coverage

  return {
    getActive,
    apply,
    getArsenal,
    hasActive: () => !!(activeInfraId || activeFieldId),
    hasArsenal: () => arsenal.length > 0,
    destroy() {},
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trimNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
function bandWord(r) {
  const f = r.defaultFreqMHz;
  if (r.role === 'hf' || f < 30) return 'hf';
  if (f < 300) return 'vhf';
  if (f < 1000) return 'uhf';
  if (r.role === 'lora') return 'lora';
  return 'shf';
}
