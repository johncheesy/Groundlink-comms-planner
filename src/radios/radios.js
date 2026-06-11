import LIBRARY from './library.json';
import {
  normalizeRadio,
  activeSetToCoverage,
  loadRadioSet,
  saveRadioSet,
} from './model.js';
import { renderRadarChart, radarSvg } from '../ui/radar-chart.js';

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
  let inactive = new Set(); // arsenal radio ids toggled off (carried but not in play)
  let activeInfraId = null;
  let activeFieldId = null;
  let structures = []; // [{id, name, infraId, fieldId}] — named radio pairs for PACE

  // ── Persistence ────────────────────────────────────────────────────────
  const persisted = loadRadioSet();
  if (persisted) {
    userRadios = (persisted.userRadios || []).map(normalizeRadio);
    arsenal = (persisted.arsenal || []).map(normalizeRadio);
    inactive = new Set(persisted.inactiveArsenal || []);
    activeInfraId = persisted.activeInfraId || null;
    activeFieldId = persisted.activeFieldId || null;
    structures = (persisted.structures || []);
  }
  const persist = () => saveRadioSet({ userRadios, arsenal, inactiveArsenal: [...inactive], activeInfraId, activeFieldId, structures });

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
    if (els.clearInfraBtn) els.clearInfraBtn.hidden = !infra;
    if (els.clearFieldBtn) els.clearFieldBtn.hidden = !field;
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
  let lastResults = []; // the radios shown by the most recent search (for the overlay)

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
    lastResults = list;

    els.results.innerHTML = '';
    if (!list.length) {
      els.results.innerHTML = '<li class="radio-result radio-result--empty">No matching radios</li>';
      return;
    }
    for (const r of list) {
      const li = document.createElement('li');
      li.className = 'radio-result';
      li.innerHTML =
        `<label class="radio-result__pick" title="Select for available equipment"><input type="checkbox" class="radio-result__check" data-id="${esc(r.id)}" /></label>` +
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
      // Click the row body (name/meta) to inspect — specs + capability radar.
      li.querySelector('.radio-result__main').addEventListener('click', () => inspectRadio(r));
      els.results.appendChild(li);
    }
    updateSelCount();
  }

  // ── Inspect (detail panel + full-screen radar grid) ────────────────────
  function inspectRadio(r) {
    if (!els.detailPanel) return;
    renderRadarChart(r, els.detailPanel);
    els.detailPanel.hidden = false;
  }

  function openEquipmentOverlay() {
    if (!els.overlay || !els.overlayGrid) return;
    const list = lastResults.length ? lastResults : workingList();
    els.overlayGrid.innerHTML = list
      .map((r) => {
        const band = `${trimNum(r.freqRangeMHz[0])}–${trimNum(r.freqRangeMHz[1])} MHz`;
        return (
          `<div class="equipment-card">` +
          `<div class="equipment-card__name">${esc(r.label)}</div>` +
          `<div class="equipment-card__meta" data-numeric>${esc(r.role)} · ${band} · ${r.powerW} W</div>` +
          `<div class="equipment-card__chart">${radarSvg(r, 160)}</div>` +
          `</div>`
        );
      })
      .join('');
    els.overlay.hidden = false;
  }

  function closeEquipmentOverlay() {
    if (els.overlay) els.overlay.hidden = true;
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
  // getArsenal() returns only the *active* radios — inactive ones are carried
  // in the list but excluded from role assignment / coverage params.
  const getArsenal = () => arsenal.filter((r) => !inactive.has(r.id)).map((r) => ({ ...r }));

  function addCheckedToArsenal() {
    const checked = [...els.results.querySelectorAll('.radio-result__check:checked')];
    let added = 0;
    checked.forEach((c) => {
      const r = findRadio(c.dataset.id);
      if (r && !arsenal.some((a) => a.id === r.id)) { arsenal.push(r); added += 1; }
      // Leave the box ticked — a second "Add ticked" is idempotent; ticks clear
      // only when the user searches again or toggles them off.
    });
    if (added) {
      persist();
      renderArsenal();
      onArsenalChange?.(getArsenal());
      onStatus?.(`Added ${added} radio${added > 1 ? 's' : ''} to available equipment`);
    } else if (checked.length) {
      onStatus?.('Those radios are already in available equipment');
    } else {
      onStatus?.('Tick radios in the list, then add them to available equipment');
    }
  }

  function removeFromArsenal(id) {
    arsenal = arsenal.filter((a) => a.id !== id);
    inactive.delete(id);
    persist();
    renderArsenal();
    onArsenalChange?.(getArsenal());
  }

  function toggleArsenalActive(id) {
    if (inactive.has(id)) inactive.delete(id);
    else inactive.add(id);
    persist();
    renderArsenal();
    onArsenalChange?.(getArsenal());
  }

  function renderArsenal() {
    if (!els.arsenalList) return;
    els.arsenalList.innerHTML = '';
    if (!arsenal.length) {
      els.arsenalList.innerHTML =
        '<li class="arsenal__empty">No radios yet — tick radios above, then “Add ticked”.</li>';
      return;
    }
    for (const r of arsenal) {
      const off = inactive.has(r.id);
      const li = document.createElement('li');
      li.className = `arsenal__row${off ? ' is-inactive' : ''}`;
      li.innerHTML =
        `<button type="button" class="arsenal__toggle" aria-pressed="${off ? 'false' : 'true'}" ` +
          `title="${off ? 'Inactive — click to activate' : 'Active — click to deactivate'}" ` +
          `aria-label="${off ? 'Activate' : 'Deactivate'} ${esc(r.label)}">${off ? '○' : '◉'}</button>` +
        `<span class="arsenal__name">${esc(r.label)}</span>` +
        `<span class="arsenal__meta" data-numeric>${r.role} · ${trimNum(r.freqRangeMHz[0])}–${trimNum(r.freqRangeMHz[1])} MHz · ${r.powerW} W</span>` +
        `<button type="button" class="arsenal__del" aria-label="Remove from arsenal" data-id="${esc(r.id)}">×</button>`;
      // Click the toggle, or the card body (name/meta), to flip active state.
      li.querySelector('.arsenal__toggle').addEventListener('click', () => toggleArsenalActive(r.id));
      li.querySelector('.arsenal__name').addEventListener('click', () => toggleArsenalActive(r.id));
      li.querySelector('.arsenal__meta').addEventListener('click', () => toggleArsenalActive(r.id));
      li.querySelector('.arsenal__del').addEventListener('click', () => removeFromArsenal(r.id));
      els.arsenalList.appendChild(li);
    }
  }

  // ── Search-results multi-select (Fix 4): select-all + live count ────────
  function updateSelCount() {
    if (!els.selCount) return;
    const n = els.results.querySelectorAll('.radio-result__check:checked').length;
    els.selCount.textContent = `${n} selected`;
  }

  function toggleSelectAll() {
    const boxes = [...els.results.querySelectorAll('.radio-result__check')];
    const allChecked = boxes.length > 0 && boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allChecked; });
    updateSelCount();
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

  // ── Coverage structures (named radio pairs → multi-tier PACE) ──────────

  function getStructures() {
    return structures.map((s) => ({
      ...s,
      infra: findRadio(s.infraId) || null,
      field: findRadio(s.fieldId) || null,
    }));
  }

  function renderStructures() {
    if (!els.structuresList) return;
    if (!structures.length) { els.structuresList.hidden = true; return; }
    els.structuresList.hidden = false;
    els.structuresList.innerHTML = structures.map((s) => {
      const infra = findRadio(s.infraId);
      const field = findRadio(s.fieldId);
      const infraName = infra?.label || '— none —';
      const fieldName = field?.label || '— none —';
      return (
        `<li class="structure-item" data-sid="${esc(s.id)}">` +
        `<span class="structure-item__name">${esc(s.name)}</span>` +
        `<span class="structure-item__radios">${esc(infraName)} / ${esc(fieldName)}</span>` +
        `<button class="structure-item__remove" type="button" title="Remove structure">×</button>` +
        `</li>`
      );
    }).join('');
    els.structuresList.querySelectorAll('.structure-item__remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sid = btn.closest('.structure-item')?.dataset.sid;
        if (sid) { structures = structures.filter((s) => s.id !== sid); persist(); renderStructures(); }
      });
    });
  }

  els.saveStructureBtn?.addEventListener('click', () => {
    const { infra, field } = getActive();
    if (!infra && !field) {
      onStatus?.('Assign an infrastructure tx or field unit first, then save as structure.');
      return;
    }
    const defaultName = `Structure ${structures.length + 1}`;
    // eslint-disable-next-line no-alert
    const name = window.prompt('Name this coverage structure (e.g. "Primary VHF", "Alternate HF"):', defaultName);
    if (name === null) return; // cancelled
    const id = `struct_${Date.now()}`;
    structures.push({ id, name: name.trim() || defaultName, infraId: infra?.id || null, fieldId: field?.id || null });
    persist();
    renderStructures();
  });

  // ── Wiring ─────────────────────────────────────────────────────────────
  els.applyBtn.addEventListener('click', apply);
  els.searchInput.addEventListener('input', () => renderResults(els.searchInput.value));
  els.editorSave.addEventListener('click', saveEditor);
  els.editorCancel.addEventListener('click', () => { els.editor.hidden = true; });
  els.fccBtn.addEventListener('click', () => fccLookup(els.fccInput.value));
  els.fccInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fccLookup(els.fccInput.value); } });
  els.addArsenalBtn?.addEventListener('click', addCheckedToArsenal);
  els.selectAll?.addEventListener('click', toggleSelectAll);
  els.expandEquipment?.addEventListener('click', openEquipmentOverlay);
  els.overlayClose?.addEventListener('click', closeEquipmentOverlay);
  els.overlay?.addEventListener('click', (e) => { if (e.target === els.overlay) closeEquipmentOverlay(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && els.overlay && !els.overlay.hidden) closeEquipmentOverlay(); });
  els.clearInfraBtn?.addEventListener('click', () => assign('infra', null));
  els.clearFieldBtn?.addEventListener('click', () => assign('field', null));
  // Keep the "N selected" counter live as the user ticks results.
  els.results.addEventListener('change', (e) => {
    if (e.target.classList?.contains('radio-result__check')) updateSelCount();
  });

  // Populate the role <select> once.
  els.editor.querySelector('[name="role"]').innerHTML = ROLES.map((r) => `<option value="${r}">${r}</option>`).join('');

  // Initial render + restore.
  renderResults('');
  renderArsenal();
  reflectActive();
  renderStructures();
  if (activeInfraId || activeFieldId) apply(); // restore the persisted set into coverage

  return {
    getActive,
    apply,
    getArsenal,
    getStructures,
    hasActive: () => !!(activeInfraId || activeFieldId),
    hasArsenal: () => arsenal.length > 0,
    /**
     * Replace the arsenal + structures wholesale (mission load, M21). Persists
     * via the module's own gl.radioset.v1 contract, like any arsenal edit.
     */
    restore({ arsenal: nextArsenal = [], structures: nextStructures = [] } = {}) {
      arsenal = nextArsenal.map(normalizeRadio);
      inactive = new Set();
      structures = nextStructures.map(({ id, name, infraId, fieldId }) => ({ id, name, infraId, fieldId }));
      persist();
      renderArsenal();
      renderStructures();
      onArsenalChange?.(getArsenal());
    },
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
