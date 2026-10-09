import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { icon } from '../../components/icons.js';
import { ordersApi } from '../../api/resources.js';
import { formatGs, formatDate, debounce } from '../../utils/format.js';

export const ORDER_STATUS = { consulta: ['Consulta', ''], cotizacion: ['Cotización', ''], pendiente: ['Pendiente', 'warn'], confirmado: ['Confirmado', 'info'], pendiente_pago: ['Pendiente de pago', 'warn'], pagado: ['Pagado', 'ok'],
  en_preparacion: ['En preparación', 'info'], listo: ['Listo', 'ok'], en_reparto: ['En reparto', 'info'], entregado: ['Entregado', 'ok'], cancelado: ['Cancelado', 'err'], reprogramado: ['Reprogramado', 'warn'], no_entregado: ['No entregado', 'err'] };
export const orderBadge = (s) => badge(...(ORDER_STATUS[s] ?? [s, '']));

export default async function mount({ view, session }) {
  const st = { page: 1, q: '', status: 'open' }; const holder = h('div', {}); const alerts = h('div', {});
  const search = input({ type: 'search', class: 'input grow', placeholder: 'Buscar por número, cliente o destinatario…', 'aria-label': 'Buscar pedidos' });
  const status = select([{ value: 'open', label: 'Abiertos' }, { value: 'all', label: 'Todos' }, ...Object.entries(ORDER_STATUS).map(([v, [l]]) => ({ value: v, label: l }))], 'open', { 'aria-label': 'Estado' });
  const apply = debounce(() => { Object.assign(st, { q: search.value.trim(), status: status.value, page: 1 }); load(); }, 300);
  [search, status].forEach((e) => e.addEventListener('input', apply));
  const newBtn = session.can('pedidos.create') ? h('a', { class: 'btn primary', href: '#/pedidos/nuevo' }, icon('plus'), 'Nuevo pedido') : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Pedidos' }]), pageHead({ title: 'Pedidos', subtitle: 'Pedidos con stock reservado, producción y entrega.', actions: newBtn }), alerts, holder);
  const toolbar = () => h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, search, status));
  async function load() {
    setChildren(holder, toolbar(), skeletonRows(7));
    try {
      const [r, dem] = await Promise.all([ordersApi.list({ page: st.page, limit: 15, q: st.q, status: st.status }), ordersApi.demand().catch(() => ({ data: [] }))]);
      setChildren(alerts, dem.data.map((a) => h('div', { class: 'alert warn', role: 'alert' }, a.message)));
      setChildren(holder, toolbar(), h('div', { class: 'card' }, r.data.length ? dataTable({ rows: r.data, columns: [
        { key: 'n', label: 'Número', render: (o) => h('a', { href: `#/pedidos/${o.id}` }, h('strong', {}, o.number)) }, { key: 'c', label: 'Cliente', render: (o) => o.customer?.name ?? '—' },
        { key: 'd', label: 'Para el', render: (o) => h('span', { class: 'nowrap' }, formatDate(o.requestedDate), o.timeSlot && ` · ${o.timeSlot}`) }, { key: 't', label: 'Tipo', render: (o) => (o.deliveryType === 'delivery' ? 'Delivery' : 'Retiro') },
        { key: 'tot', label: 'Total', render: (o) => h('strong', {}, formatGs(o.totalPyg)) }, { key: 'b', label: 'Saldo', render: (o) => (o.balancePyg > 0 ? formatGs(o.balancePyg) : '—') }, { key: 's', label: 'Estado', render: (o) => orderBadge(o.status) }],
        actions: (o) => [h('a', { class: 'btn sm', href: `#/pedidos/${o.id}` }, 'Abrir')] }) : emptyState('No hay pedidos', 'No hay pedidos que coincidan con los filtros.'), pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } })));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  await load();
}
