import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { icon } from '../../components/icons.js';
import { salesApi } from '../../api/resources.js';
import { formatGs, formatDateTime, debounce } from '../../utils/format.js';

export const PAY_STATE = { paid: ['Pagada', 'ok'], partial: ['Pago parcial', 'warn'], credit: ['A crédito', 'warn'], overdue: ['Vencida', 'err'], void: ['Anulada', 'err'] };
export const payBadge = (s) => badge(...(PAY_STATE[s] ?? [s, '']));

export default async function mount({ view, session, query }) {
  const st = { page: 1, q: '', status: 'all', payment: 'all', from: '', to: '', customerId: query.customerId || '' }; const holder = h('div', {});
  const search = input({ type: 'search', class: 'input grow', placeholder: 'Buscar por número o cliente…', 'aria-label': 'Buscar ventas' });
  const status = select([{ value: 'all', label: 'Todas' }, { value: 'confirmada', label: 'Confirmadas' }, { value: 'anulada', label: 'Anuladas' }], 'all', { 'aria-label': 'Estado' });
  const pay = select([{ value: 'all', label: 'Cualquier cobro' }, { value: 'paid', label: 'Pagadas' }, { value: 'partial', label: 'Pago parcial' }, { value: 'credit', label: 'A crédito' }, { value: 'overdue', label: 'Vencidas' }], 'all', { 'aria-label': 'Cobro' });
  const from = input({ type: 'date', 'aria-label': 'Desde' }); const to = input({ type: 'date', 'aria-label': 'Hasta' });
  const apply = debounce(() => { Object.assign(st, { q: search.value.trim(), status: status.value, payment: pay.value, from: from.value, to: to.value, page: 1 }); load(); }, 300);
  [search, status, pay, from, to].forEach((e) => e.addEventListener('input', apply));
  const newBtn = session.can('ventas.create') ? h('a', { class: 'btn primary', href: '#/ventas/nueva' }, icon('plus'), 'Nueva venta') : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Ventas' }, { label: 'Historial' }]), pageHead({ title: 'Ventas', subtitle: 'Historial de ventas, cobros y anulaciones.', actions: newBtn }), holder);
  const toolbar = () => h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, search, status, pay, h('label', { class: 'small muted' }, 'Desde ', from), h('label', { class: 'small muted' }, 'Hasta ', to)));
  async function load() {
    setChildren(holder, toolbar(), skeletonRows(7));
    try {
      const q = { page: st.page, limit: 15, q: st.q, status: st.status, payment: st.payment, customerId: st.customerId || undefined };
      if (st.from) q.from = new Date(st.from + 'T00:00:00').toISOString(); if (st.to) q.to = new Date(st.to + 'T23:59:59').toISOString();
      const r = await salesApi.list(q); const sm = r.summary;
      setChildren(holder, toolbar(), h('div', { class: 'grid cols-4', style: 'margin-bottom:16px' }, ...[['Ventas', String(sm.salesCount)], ['Total vendido', formatGs(sm.totalPyg)], ['Ticket promedio', formatGs(sm.averageTicketPyg)]].map(([l, v]) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value', style: 'font-size:26px' }, v)))),
        h('div', { class: 'card' }, r.data.length ? dataTable({ rows: r.data, columns: [
          { key: 'number', label: 'Número', render: (s) => h('a', { href: `#/ventas/${s.id}` }, h('strong', {}, s.number)) }, { key: 'at', label: 'Fecha', render: (s) => h('span', { class: 'small nowrap' }, formatDateTime(s.createdAt)) },
          { key: 'customer', label: 'Cliente', render: (s) => s.customer?.name ?? 'Mostrador' }, { key: 'channel', label: 'Canal', render: (s) => s.channel },
          { key: 'total', label: 'Total', render: (s) => h('strong', {}, formatGs(s.totalPyg)) }, { key: 'balance', label: 'Saldo', render: (s) => (s.balancePyg > 0 ? formatGs(s.balancePyg) : '—') }, { key: 'state', label: 'Estado', render: (s) => payBadge(s.paymentState) }],
          actions: (s) => [h('a', { class: 'btn sm', href: `#/ventas/${s.id}` }, 'Abrir')] }) : emptyState('No hay ventas', 'No hay ventas que coincidan con los filtros.'), pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } })));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  await load();
}
