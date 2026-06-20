/**
 * M46 — Radio-to-node suggestion panel UI.
 *
 * Renders inside a collapsible <details> element under the Node Roles section.
 * One accordion item per role; each shows the top-3 scored radios with a score
 * bar and an "Apply" button that assigns the radio to the role via the undo/stale
 * flow (same pattern as M35 mast wizard — markDirty + onApply callback).
 *
 * Usage:
 *   const panel = createRadioSuggestPanel(hostEl, { onApply });
 *   panel.update(arsenal, roles, context);   // call on arsenal / role change
 *   panel.clear();                           // reset to empty state
 *
 * onApply({ roleKey, radio }) — assign radio to role; caller handles undo/stale.
 */

const e = (tag, cls, ...ch) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of ch) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
};

const htmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function createRadioSuggestPanel(host, { onApply } = {}) {
  function render(suggestions) {
    host.innerHTML = '';

    if (!suggestions || suggestions.length === 0) {
      host.appendChild(e('p', 'help', 'Add radios to the arsenal to see suggestions.'));
      return;
    }

    const noArsenal = suggestions.every((s) => s.suggestions.length === 0);
    if (noArsenal) {
      host.appendChild(e('p', 'help', 'No radios in the arsenal yet.'));
      return;
    }

    for (const { role, suggestions: items } of suggestions) {
      if (items.length === 0) continue;

      const block = e('div', 'radio-suggest__node');

      const nodeLabel = e('div', 'radio-suggest__node-label', role.label);
      block.append(nodeLabel);

      for (const { radio, score } of items) {
        const item = e('div', 'radio-suggest__item');

        // Score bar
        const barWrap = e('div', 'radio-suggest__score-wrap');
        const bar = e('div', 'radio-suggest__score-bar');
        const fill = e('div', 'radio-suggest__score-fill');
        fill.style.width = `${score}%`;
        fill.style.background = score >= 70
          ? 'var(--accent)'
          : score >= 45
          ? 'var(--warn)'
          : 'var(--bad)';
        bar.appendChild(fill);
        const scoreNum = e('span', 'radio-suggest__score-num', `${score}`);
        barWrap.append(bar, scoreNum);

        // Radio info
        const info = e('div', 'radio-suggest__info');
        const name = e('span', 'radio-suggest__radio-name', htmlEsc(radio.label ?? radio.model ?? 'Unknown'));
        const meta = e('span', 'radio-suggest__radio-meta',
          [radio.band, radio.txMaxW ? `${radio.txMaxW} W` : null, radio.digitalMode]
            .filter(Boolean).join(' · ')
        );
        info.append(name, meta);

        // Apply button
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn--sm radio-suggest__apply';
        applyBtn.textContent = 'Apply';
        applyBtn.title = `Assign ${radio.label} to ${role.label}`;
        applyBtn.addEventListener('click', () => {
          onApply?.({ roleKey: role.key, radio });
          // Visual feedback — flash the apply button
          applyBtn.textContent = '✓ Applied';
          applyBtn.disabled = true;
          setTimeout(() => {
            applyBtn.textContent = 'Apply';
            applyBtn.disabled = false;
          }, 2000);
        });

        item.append(barWrap, info, applyBtn);
        block.append(item);
      }

      host.append(block);
    }
  }

  return {
    update(suggestions) {
      render(suggestions);
    },
    clear() {
      host.innerHTML = '';
    },
  };
}
