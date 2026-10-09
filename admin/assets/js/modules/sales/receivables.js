import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { salesApi } from '../../api/resources.js';
import { formatGs, formatDate } from '../../utils/format.js';
import { openCollect } from './detail.js';

export default async function mount({ view, session }) {
  const st = { page: 1, status: 'open' }; const holder = h('div', {});
  const status = select([{ value: 'open', label: 'Pendientes' }, { value: 'overdue', label: 'Vencidas' }, { value: 'pending', label: 'Por vencer' }], 'open', { 'aria-label': 'Estado' });
  status.addEventListener('change', () => { st.status = status.value; st.page = 1; load(); });
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Ventas' }, { label: 'Cuentas por cobrar' }]), pageHead({ title: 'Cuentas por cobrar', subtitle: 'Ventas con saldo pendiente de clientes.' }), holder);
  const toolbar = () => h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, status));
  async function load() {
    setChildren(holder, toolbar(), skeletonRows(5));
    try {
      const r = await salesApi.receivables({ page: st.page, limit: 15, status: st.status });
      setChildren(holder, toolbar(), h('div', { class: 'grid cols-4', style: 'margin-bottom:16px' }, h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Por cobrar'), h('div', { class: 'value', style: 'font-size:28px' }, formatGs(r.balancePyg))), h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Vencido'), h('div', { class: 'value', style: 'font-size:28px;color:var(--err)' }, formatGs(r.overduePyg)))),
        h('div', { class: 'card' }, r.data.length ? dataTable({ rows: r.data, columns: [
          { key: 'n', label: 'Venta', render: (s) => h('a', { href: `#/ventas/${s.id}` }, h('strong', {}, s.number)) }, { key: 'c', label: 'Cliente', render: (s) => (s.customer ? h('a', { href: `#/clientes/${s.customer.id}` }, s.customer.name) : '—') },
          { key: 't', label: 'Total', render: (s) => formatGs(s.totalPyg) }, { key: 'b', label: 'Saldo', render: (s) => h('strong', {}, formatGs(s.balancePyg)) }, { key: 'd', label: 'Vence', render: (s) => formatDate(s.creditDueDate) },
          { key: 's', label: 'Estado', render: (s) => (s.status === 'overdue' ? badge('Vencida', 'err') : badge('Por vencer', 'info')) }],
          actions: (s) => [session.can('ventas.edit') && h('button', { class: 'btn sm primary', type: 'button', onclick: () => openCollect(s, load) }, 'Cobrar')].filter(Boolean) }) : emptyState('Sin cuentas por cobrar', 'No hay ventas con saldo pendiente.'), pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } })));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  await load();
}
