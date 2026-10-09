import { h, setChildren } from './dom.js';
import { customersApi } from '../api/resources.js';
import { session } from '../auth/session.js';
import { openCustomerForm } from '../modules/customers/customer-form.js';

/** Buscador de clientes con alta rápida. getValue() → {id,name} | null. */
export function customerPicker({ onChange } = {}) {
  let current = null; let timer;
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Buscar cliente por nombre o teléfono…', 'aria-label': 'Buscar cliente', autocomplete: 'off' });
  const results = h('div', { class: 'card', style: 'display:none;margin-top:4px;max-height:220px;overflow:auto', role: 'listbox' });
  const chosen = h('div', {});
  const root = h('div', {}, chosen, search, results);
  const set = (c) => { current = c; draw(); onChange?.(c); };
  function draw() {
    search.style.display = current ? 'none' : ''; results.style.display = 'none';
    setChildren(chosen, current ? h('div', { class: 'alert info', style: 'margin:0;justify-content:space-between;align-items:center' }, h('span', {}, h('strong', {}, current.name), current.phone && ` · ${current.phone}`),
      h('button', { class: 'btn sm', type: 'button', onclick: () => set(null) }, 'Quitar')) : null);
  }
  async function find(q) {
    try {
      const r = await customersApi.list({ q, limit: 8 });
      const items = r.data.map((c) => h('button', { class: 'menu-item', type: 'button', role: 'option', onclick: () => { set({ id: c.id, name: c.name, phone: c.phone }); search.value = ''; } },
        h('span', {}, h('strong', {}, c.name), c.phone && h('span', { class: 'muted small' }, ` · ${c.phone}`), c.balancePyg > 0 && h('span', { class: 'badge warn', style: 'margin-left:6px' }, 'con saldo'))));
      const create = session.can('clientes.create') && h('button', { class: 'menu-item', type: 'button', onclick: () => openCustomerForm({ quick: true, onSaved: (c) => set({ id: c.id, name: c.name, phone: c.phone }) }) }, '+ Crear cliente nuevo');
      setChildren(results, items, create);
      results.style.display = '';
    } catch { results.style.display = 'none'; }
  }
  search.addEventListener('input', () => { clearTimeout(timer); const q = search.value.trim(); if (q.length < 2) { results.style.display = 'none'; return; } timer = setTimeout(() => find(q), 250); });
  root.getValue = () => current;
  root.clear = () => set(null);
  root.set = set;
  return root;
}
