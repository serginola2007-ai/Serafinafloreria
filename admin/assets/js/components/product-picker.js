import { h, setChildren } from './dom.js';
import { productsApi } from '../api/resources.js';

/** Selector con búsqueda de productos del inventario. getValue() → id o null. */
export function productPicker({ id, onChange, stockableOnly = true, value = null, disabled = false }) {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Buscar producto…', 'aria-label': 'Buscar producto', disabled });
  const sel = h('select', { class: 'select', id, 'aria-label': 'Producto', disabled });
  const box = h('div', { style: 'display:grid;gap:6px' }, search, sel);
  let timer; let items = [];
  async function load(q = '') {
    try {
      const r = await productsApi.list({ q, limit: 50, stockable: stockableOnly ? true : undefined, status: 'all' });
      items = r.data;
      const keep = sel.value;
      setChildren(sel, h('option', { value: '' }, items.length ? 'Elegí un producto…' : 'Sin resultados'), items.map((p) => h('option', { value: p.id }, `${p.name}${p.unit ? ` (${p.unit})` : ''}`)));
      if (keep && items.some((p) => String(p.id) === keep)) sel.value = keep;
    } catch { setChildren(sel, h('option', { value: '' }, 'No se pudo cargar')); }
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(search.value.trim()), 250); });
  sel.addEventListener('change', () => onChange?.(sel.value ? Number(sel.value) : null, items.find((p) => String(p.id) === sel.value)));
  load().then(() => { if (value) { if (![...sel.options].some((o) => o.value === String(value))) sel.append(h('option', { value }, `#${value}`)); sel.value = String(value); } });
  box.getValue = () => (sel.value ? Number(sel.value) : null);
  box.getItem = () => items.find((p) => String(p.id) === sel.value);
  box.setError = (m) => { sel.setAttribute('aria-invalid', m ? 'true' : 'false'); };
  return box;
}
