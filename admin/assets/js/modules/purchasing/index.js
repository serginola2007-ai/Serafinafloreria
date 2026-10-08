import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { icon } from '../../components/icons.js';
import { purchasingApi } from '../../api/resources.js';
import { formatGs, formatDate, debounce } from '../../utils/format.js';

export const ORDER_STATUS = { borrador: ['Borrador', ''], enviada: ['Enviada', 'info'], parcial: ['Recibida parcial', 'warn'], recibida: ['Recibida', 'ok'], cancelada: ['Cancelada', 'err'] };
export const orderBadge = (s) => badge(...(ORDER_STATUS[s] || [s, '']));

export default async function mount({ view, session, query }) {
  const st = { page: 1, q: '', status: query.status || 'all' }; const holder = h('div', { class: 'card' });
  const search = input({ type: 'search', class: 'input grow', placeholder: 'Buscar por número o proveedor…', 'aria-label': 'Buscar órdenes' });
  const status = select([{ value: 'all', label: 'Todas' }, { value: 'open', label: 'Abiertas' }, ...Object.entries(ORDER_STATUS).map(([value, [label]]) => ({ value, label }))], st.status, { 'aria-label': 'Estado' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.page = 1; load(); }, 300));
  status.addEventListener('change', () => { st.status = status.value; st.page = 1; load(); });
  const newBtn = session.can('compras.create') ? h('a', { class: 'btn primary', href: '#/compras/nueva' }, icon('plus'), 'Nueva orden') : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Compras' }, { label: 'Órdenes de compra' }]),
    pageHead({ title: 'Órdenes de compra', subtitle: 'Orden → recepción → stock y cuenta por pagar.', actions: newBtn }), holder);
  const toolbar = () => h('div', { class: 'toolbar' }, search, status);
  async function load() {
    setChildren(holder, toolbar(), skeletonRows(6));
    try {
      const r = await purchasingApi.list({ page: st.page, limit: 15, q: st.q, status: st.status });
      setChildren(holder, toolbar(), r.data.length ? dataTable({ rows: r.data, columns: [
        { key: 'number', label: 'Número', render: (o) => h('a', { href: `#/compras/${o.id}` }, h('strong', {}, o.number)) },
        { key: 'supplier', label: 'Proveedor', render: (o) => o.supplier }, { key: 'status', label: 'Estado', render: (o) => orderBadge(o.status) },
        { key: 'items', label: 'Líneas', render: (o) => String(o.items) }, { key: 'total', label: 'Total', render: (o) => h('span', { class: 'nowrap' }, formatGs(o.totalPyg)) },
        { key: 'expected', label: 'Entrega estimada', render: (o) => (o.expectedAt ? formatDate(o.expectedAt) : '—') }, { key: 'created', label: 'Creada', render: (o) => formatDate(o.createdAt) },
      ], actions: (o) => [h('a', { class: 'btn sm', href: `#/compras/${o.id}` }, 'Abrir')] }) : emptyState('No hay órdenes', st.q || st.status !== 'all' ? 'Probá con otros filtros.' : 'Creá la primera con “Nueva orden”.'),
      pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } }));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  await load();
}
