import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { inventoryApi } from '../../api/resources.js';
import { formatGs, formatQty, formatDateTime, debounce, MOVEMENT_TYPES } from '../../utils/format.js';

export default async function mount({ view }) {
  const st = { page: 1, type: '', from: '', to: '' };
  const holder = h('div', { class: 'card' });
  const type = select([{ value: '', label: 'Todos los tipos' }, ...Object.entries(MOVEMENT_TYPES).map(([value, label]) => ({ value, label }))], '', { 'aria-label': 'Tipo de movimiento' });
  const from = input({ type: 'date', 'aria-label': 'Desde' }); const to = input({ type: 'date', 'aria-label': 'Hasta' });
  const apply = debounce(() => { st.type = type.value; st.from = from.value; st.to = to.value; st.page = 1; load(); }, 250);
  [type, from, to].forEach((e) => e.addEventListener('input', apply));
  const toolbar = () => h('div', { class: 'toolbar' }, type, h('label', { class: 'small muted' }, 'Desde ', from), h('label', { class: 'small muted' }, 'Hasta ', to));
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Inventario' }, { label: 'Movimientos' }]),
    pageHead({ title: 'Movimientos de inventario', subtitle: 'Historial completo e inmutable. Las correcciones se registran como nuevos movimientos.' }), holder);
  async function load() {
    setChildren(holder, toolbar(), skeletonRows(8));
    try {
      const q = { page: st.page, limit: 20, type: st.type };
      if (st.from) q.from = new Date(st.from + 'T00:00:00').toISOString(); if (st.to) q.to = new Date(st.to + 'T23:59:59').toISOString();
      const r = await inventoryApi.movements(q);
      setChildren(holder, toolbar(), r.data.length ? dataTable({ rows: r.data, columns: [
        { key: 'at', label: 'Fecha', render: (m) => h('span', { class: 'nowrap small' }, formatDateTime(m.occurredAt)) },
        { key: 'product', label: 'Producto', render: (m) => m.product },
        { key: 'type', label: 'Tipo', render: (m) => badge(MOVEMENT_TYPES[m.type] || m.type, m.qty > 0 ? 'ok' : 'warn') },
        { key: 'qty', label: 'Cantidad', render: (m) => h('strong', {}, `${m.qty > 0 ? '+' : ''}${formatQty(m.qty)} ${m.unit}`) },
        { key: 'cost', label: 'Costo unit.', render: (m) => formatGs(m.unitCostPyg) },
        { key: 'reason', label: 'Motivo', render: (m) => m.reason || '—' },
        { key: 'user', label: 'Usuario', render: (m) => m.user || 'Sistema' },
      ] }) : emptyState('Sin movimientos', 'No hay movimientos que coincidan con los filtros.'), pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } }));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  await load();
}
