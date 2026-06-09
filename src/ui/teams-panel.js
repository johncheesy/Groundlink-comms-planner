/**
 * Teams & operators panel (M13) — presentation for the teams model.
 *
 * Renders an add-team form (name · colour swatch · members · radio · power Wh),
 * a compact teams table (colour/name/members/radio/band/coverage/battery and
 * per-row actions), and a DMR capacity panel driven by erlang.dmrCapacity().
 *
 * Construction wires the model; the panel re-renders on every model change via
 * teamsManager.subscribe(). All colour comes from design tokens.
 */

import { TEAM_COLORS } from '../mission/teams.js';
import { dmrCapacity } from '../mission/erlang.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Coarse band label from a radio's default / range frequency. */
function bandWord(radio) {
  if (!radio) return '—';
  if (radio.role === 'hf') return 'HF';
  if (radio.role === 'lora') return 'LoRa';
  const f = Number(radio.defaultFreqMHz) || (radio.freqRangeMHz ? radio.freqRangeMHz[0] : 0);
  if (!f) return '—';
  if (f < 30) return 'HF';
  if (f < 300) return 'VHF';
  if (f < 1000) return 'UHF';
  return 'SHF';
}

/**
 * @param {HTMLElement} container
 * @param {{ teamsManager: object, getRadios: () => Array, onRunCoverage?: (team) => void }} deps
 * @returns {{ render: () => void, updateTeamCoverage: (id:string, stats:object) => void }}
 */
export function createTeamsPanel(container, { teamsManager, getRadios, onRunCoverage } = {}) {
  let selectedColor = TEAM_COLORS[0];
  let dmrUsersEdited = false; // once the user edits the DMR user count, stop auto-seeding it

  container.innerHTML = `
    <div class="teams">
      <div class="teams-form">
        <div class="input-row">
          <label class="field-label" style="flex:2">Team name
            <input class="input input--sm" type="text" id="teamName" placeholder="Alpha" />
          </label>
          <label class="field-label" style="flex:1">Members
            <input class="input input--sm" type="number" id="teamMembers" min="1" max="999" step="1" value="4" />
          </label>
        </div>
        <div class="field-label">Colour
          <div class="team-swatches" id="teamSwatches" role="group" aria-label="Team colour"></div>
        </div>
        <div class="input-row">
          <label class="field-label" style="flex:2">Radio
            <select class="input input--sm" id="teamRadio"></select>
          </label>
          <label class="field-label" style="flex:1">Power
            <div class="input-row">
              <input class="input input--sm" type="number" id="teamPower" min="0" max="9999" step="10" value="0" />
              <span class="input-suffix">Wh</span>
            </div>
          </label>
        </div>
        <button class="btn btn--block" type="button" id="teamAddBtn">Add team</button>
        <p class="help" id="teamsRadioHint" hidden></p>
      </div>

      <div class="teams-table-wrap">
        <table class="teams-table" id="teamsTable">
          <thead>
            <tr>
              <th aria-label="Colour"></th>
              <th>Team</th>
              <th class="teams-num">Mem</th>
              <th>Radio</th>
              <th>Band</th>
              <th class="teams-num">Coverage</th>
              <th class="teams-num">Battery</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody id="teamsBody"></tbody>
        </table>
        <p class="help" id="teamsEmpty">No teams yet. Name a team, pick a colour and radio, then add it.</p>
      </div>

      <details class="disclosure">
        <summary>DMR talkgroup capacity</summary>
        <p class="help">Erlang-B sizing for a 2-slot DMR talkgroup. Offered load = users × calls/hr × call length.</p>
        <div class="input-row">
          <label class="field-label" style="flex:1">Timeslots
            <input class="input input--sm" type="number" id="dmrSlots" min="1" max="32" step="1" value="2" />
          </label>
          <label class="field-label" style="flex:1">Users
            <input class="input input--sm" type="number" id="dmrUsers" min="1" max="9999" step="1" value="10" />
          </label>
        </div>
        <div class="input-row">
          <label class="field-label" style="flex:1">Calls / user / hr
            <input class="input input--sm" type="number" id="dmrCalls" min="0" max="240" step="1" value="4" />
          </label>
          <label class="field-label" style="flex:1">Call length
            <div class="input-row">
              <input class="input input--sm" type="number" id="dmrDur" min="1" max="600" step="1" value="20" />
              <span class="input-suffix">s</span>
            </div>
          </label>
          <label class="field-label" style="flex:1">Target GoS
            <div class="input-row">
              <input class="input input--sm" type="number" id="dmrGos" min="0.1" max="50" step="0.1" value="2" />
              <span class="input-suffix">%</span>
            </div>
          </label>
        </div>
        <div class="dmr-result" id="dmrResult" aria-live="polite"></div>
      </details>
    </div>
  `;

  const nameInput = container.querySelector('#teamName');
  const membersInput = container.querySelector('#teamMembers');
  const radioSelect = container.querySelector('#teamRadio');
  const powerInput = container.querySelector('#teamPower');
  const swatches = container.querySelector('#teamSwatches');
  const addBtn = container.querySelector('#teamAddBtn');
  const radioHint = container.querySelector('#teamsRadioHint');
  const body = container.querySelector('#teamsBody');
  const table = container.querySelector('#teamsTable');
  const emptyMsg = container.querySelector('#teamsEmpty');

  // DMR controls
  const dmrSlots = container.querySelector('#dmrSlots');
  const dmrUsers = container.querySelector('#dmrUsers');
  const dmrCalls = container.querySelector('#dmrCalls');
  const dmrDur = container.querySelector('#dmrDur');
  const dmrGos = container.querySelector('#dmrGos');
  const dmrResult = container.querySelector('#dmrResult');

  // ── Colour swatch picker ──────────────────────────────────────────────
  TEAM_COLORS.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'team-swatch' + (i === 0 ? ' is-active' : '');
    btn.style.setProperty('--swatch', color);
    btn.dataset.color = color;
    btn.setAttribute('aria-label', `Colour ${i + 1}`);
    btn.addEventListener('click', () => {
      selectedColor = color;
      swatches.querySelectorAll('.team-swatch').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
    swatches.appendChild(btn);
  });

  // ── Add-team form ─────────────────────────────────────────────────────
  addBtn.addEventListener('click', () => {
    teamsManager.addTeam({
      name: nameInput.value,
      color: selectedColor,
      members: membersInput.value,
      radioId: radioSelect.value,
      powerWh: powerInput.value,
    });
    nameInput.value = '';
    powerInput.value = '0';
    nameInput.focus();
  });

  // ── Per-row actions (event-delegated) ─────────────────────────────────
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('tr')?.dataset.id;
    if (!id) return;
    if (btn.dataset.action === 'remove') {
      teamsManager.removeTeam(id);
    } else if (btn.dataset.action === 'coverage') {
      const team = teamsManager.getTeams().find((t) => t.id === id);
      if (team) onRunCoverage?.(team);
    }
  });

  // ── DMR capacity ──────────────────────────────────────────────────────
  function totalMembers() {
    return teamsManager.getTeams().reduce((sum, t) => sum + (Number(t.members) || 0), 0);
  }

  function renderDmr() {
    const num = (el, fallback) => {
      const n = Number.parseFloat(el.value);
      return Number.isFinite(n) ? n : fallback;
    };
    const res = dmrCapacity({
      timeslots: num(dmrSlots, 2),
      users: num(dmrUsers, 10),
      callsPerUserPerHour: num(dmrCalls, 4),
      avgCallDurationSec: num(dmrDur, 20),
      targetGoS: num(dmrGos, 2) / 100,
    });
    const cls = res.meetsTarget ? 'badge--ok' : 'badge--bad';
    const label = res.meetsTarget ? 'OK' : 'Over';
    dmrResult.innerHTML =
      `<div class="dmr-result__head">` +
      `<span class="badge ${cls}">${label}</span>` +
      `<span class="dmr-result__metric"><b>${res.load.toFixed(2)}</b> Erlang load</span>` +
      `<span class="dmr-result__metric"><b>${(res.blocking * 100).toFixed(res.blocking < 0.1 ? 2 : 1)}%</b> blocking</span>` +
      `</div>` +
      `<p class="help">${esc(res.recommendation)}</p>`;
  }

  dmrUsers.addEventListener('input', () => { dmrUsersEdited = true; renderDmr(); });
  [dmrSlots, dmrCalls, dmrDur, dmrGos].forEach((el) => el.addEventListener('input', renderDmr));

  // ── Render ────────────────────────────────────────────────────────────
  function refreshRadioOptions() {
    const radios = getRadios?.() ?? [];
    const prev = radioSelect.value;
    radioSelect.innerHTML =
      `<option value="">— none —</option>` +
      radios
        .map((r) => `<option value="${esc(r.id)}">${esc(r.label)} · ${bandWord(r)}</option>`)
        .join('');
    if (radios.some((r) => r.id === prev)) radioSelect.value = prev;
    radioHint.hidden = radios.length > 0;
    if (!radios.length) radioHint.textContent = 'No radios in the arsenal yet — add equipment under Radios to assign a bearer.';
  }

  function render() {
    refreshRadioOptions();

    const radios = getRadios?.() ?? [];
    const byId = new Map(radios.map((r) => [r.id, r]));
    const teams = teamsManager.getTeams();

    body.innerHTML = teams
      .map((t) => {
        const radio = t.radioId ? byId.get(t.radioId) : null;
        const radioLabel = radio ? esc(radio.label) : '— none —';
        const stats = t.coverageStats;
        const frac = stats ? (stats.coveredFracAoi ?? stats.coveredFrac) : null;
        const coverage = Number.isFinite(frac) ? `${Math.round(frac * 100)}%` : '—';
        // Endurance ≈ battery Wh / (Tx watts × 10% duty cycle). Needs both a
        // power budget and a radio with a known Tx power, else '—'.
        const txW = radio ? Number(radio.powerW) : NaN;
        const hours = (t.powerWh > 0 && Number.isFinite(txW) && txW > 0)
          ? t.powerWh / (txW * 0.1)
          : null;
        const battery = hours != null ? `${hours >= 100 ? Math.round(hours) : hours.toFixed(1)} h` : '—';
        return (
          `<tr data-id="${esc(t.id)}">` +
          `<td><span class="team-dot" style="background:${esc(t.color)}"></span></td>` +
          `<td class="teams-name">${esc(t.name)}</td>` +
          `<td class="teams-num" data-numeric>${t.members}</td>` +
          `<td class="teams-radio">${radioLabel}</td>` +
          `<td>${bandWord(radio)}</td>` +
          `<td class="teams-num" data-numeric>${coverage}</td>` +
          `<td class="teams-num" data-numeric>${battery}</td>` +
          `<td class="teams-actions">` +
          `<button type="button" class="btn btn--sm" data-action="coverage" title="Run coverage for this team's radio">Coverage</button>` +
          `<button type="button" class="teams-del" data-action="remove" aria-label="Remove team">×</button>` +
          `</td>` +
          `</tr>`
        );
      })
      .join('');

    const has = teams.length > 0;
    table.hidden = !has;
    emptyMsg.hidden = has;

    // Keep the DMR user count tracking total team members until the user overrides it.
    if (!dmrUsersEdited) {
      const total = totalMembers();
      dmrUsers.value = String(Math.max(1, total || 10));
    }
    renderDmr();
  }

  /** Stash a coverage result against a team (re-renders via the model). */
  function updateTeamCoverage(id, stats) {
    teamsManager.updateTeam(id, { coverageStats: stats || null });
  }

  // Re-render on any model change, and once now.
  teamsManager.subscribe(render);
  render();

  return { render, updateTeamCoverage };
}
