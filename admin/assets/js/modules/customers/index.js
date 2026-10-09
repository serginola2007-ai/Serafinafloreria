import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { icon } from '../../components/icons.js';
import { customersApi } from '../../api/resources.js';
import { formatGs, formatDate, debounce } from '../../utils/format.js';
import { openCustomerForm, KINDS } from './customer-form.js';

export default async function mount({ view, session, navigate }) {
  const st = { page: 1, q: '', kind: '', sort: { key: 'name', dir: 'asc' } }; const holder = h('div', { class: 'card' });
  const search = input({ type: 'search', class: 'input grow', placeholder: 'Buscar por nombre, teléfono, correo o RUC…', 'aria-label': 'Buscar clientes' });
  const kind = select([{ value: '', label: 'Todos los tipos' }, ...Object.entries(KINDS).map(([value, label]) => ({ value, label }))], '', { 'aria-label': 'Tipo' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.page = 1; load(); }, 300));
  kind.addEventListener('change', () => { st.kind = kind.value; st.page = 1; load(); });
  const actions = [session.can('clientes.export') && h('a', { class: 'btn', href: '/api/v1/customers/export.csv', download: 'clientes.csv' }, 'Exportar CSV'),
    session.can('clientes.create') && h('button', { class: 'btn primary', type: 'button', onclick: () => openCustomerForm({ onSaved: (c) => navigate(`/clientes/${c.id}`) }) }, icon('plus'), 'Nuevo cliente')].filter(Boolean);
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Clientes' }]), pageHead({ title: 'Clientes', subtitle: 'Quién compra, cuánto, y qué saldo tiene pendiente.', actions }), holder);
  const toolbar = () => h('div', { class: 'toolbar' }, search, kind);
  async function load() {
    setChildren(holder, toolbar(), skeletonRows(6));
    try {
      const r = await customersApi.list({ page: st.page, limit: 15, q: st.q, kind: st.kind, sort: st.sort.key, dir: st.sort.dir });
      setChildren(holder, toolbar(), r.data.length ? dataTable({ rows: r.data, sort: st.sort, onSort: (key, dir) => { st.sort = { key, dir }; load(); }, columns: [
        { key: 'name', sortKey: 'name', label: 'Cliente', render: (c) => h('span', {}, h('a', { href: `#/clientes/${c.id}` }, h('strong', {}, c.name)), h('br'), h('span', { class: 'muted small' }, [c.phone, c.email].filter(Boolean).join(' · ') || '—')) },
        { key: 'kind', label: 'Tipo', render: (c) => badge(KINDS[c.kind] ?? c.kind) }, { key: 'purchases', label: 'Compras', render: (c) => String(c.purchases) },
        { key: 'spent', sortKey: 'spent', label: 'Total comprado', render: (c) => h('span', { class: 'nowrap' }, formatGs(c.totalSpentPyg)) }, { key: 'avg', label: 'Ticket prom.', render: (c) => (c.purchases ? formatGs(c.averageTicketPyg) : '—') },
        { key: 'balance', label: 'Saldo', render: (c) => (c.balancePyg > 0 ? badge(formatGs(c.balancePyg), 'warn') : '—') }, { key: 'last', sortKey: 'last', label: 'Última compra', render: (c) => (c.lastPurchaseAt ? formatDate(c.lastPurchaseAt) : '—') },
      ], actions: (c) => [h('a', { class: 'btn sm', href: `#/clientes/${c.id}` }, 'Ver')] }) : emptyState('No hay clientes', st.q || st.kind ? 'Probá con otros filtros.' : 'Se crean acá o directamente desde el punto de venta.'),
      pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } }));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  await load();
}
