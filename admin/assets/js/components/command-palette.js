import { h, clear } from './dom.js';
import { openModal } from './modal.js';
import { icon } from './icons.js';

/**
 * Paleta de comandos (Ctrl/⌘+K). `getItems()` devuelve SOLO acciones que el usuario puede usar.
 * item: { label, icon, hint?, run() }. Más adelante se suman resultados de búsqueda del backend (clientes, pedidos, productos).
 */
export function openPalette(getItems) {
  const items = getItems();
  let active = 0; let shown = items;
  const input = h('input', { type: 'text', placeholder: 'Buscar módulos y acciones…', 'aria-label': 'Buscar', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', autocomplete: 'off' });
  const list = h('ul', { id: 'palette-list', role: 'listbox' });
  const wrap = h('div', {}, input, list);
  const m = openModal({ title: 'Búsqueda rápida', content: wrap, footer: [], labelledBy: 'palette-title' });
  m.el.classList.add('palette');
  m.el.querySelector('.modal-head').hidden = true; m.el.querySelector('.modal-foot').hidden = true;
  m.body.style.padding = '0';

  function draw() {
    clear(list);
    if (!shown.length) { list.append(h('li', { class: 'muted', style: 'padding:14px' }, 'Sin resultados')); return; }
    shown.forEach((it, i) => list.append(h('li', {}, h('button', { type: 'button', role: 'option', 'aria-selected': String(i === active), onclick: () => run(it), onmousemove: () => { active = i; mark(); } },
      icon(it.icon || 'chevron'), h('span', {}, it.label), it.hint && h('span', { class: 'muted small', style: 'margin-left:auto' }, it.hint)))));
  }
  const mark = () => [...list.querySelectorAll('button')].forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
  function run(it) { m.close(); it.run(); }
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    shown = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items; active = 0; draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); mark(); }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); run(shown[active]); }
  });
  draw(); input.focus();
}
