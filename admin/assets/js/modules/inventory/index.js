import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input, select } from '../../components/form.js';
import { skeletonRows, errorState, emptyState } from '../../components/states.js';
import { icon } from '../../components/icons.js';
import { inventoryApi } from '../../api/resources.js';
import { formatGs, formatQty, debounce } from '../../utils/format.js';
import { openAdjust, openWaste, openEnroll, openNewSupply, openDetail, statusBadge } from './dialogs.js';

export default async function mount({ view, session }) {
  const st = { page: 1, q: '', status: 'all', kind: '', sort: { key: 'name', dir: 'asc' } };
  const holder = h('div', { class: 'card' }); const alertsBox = h('div', {});
  const search = input({ type: 'search', class: 'input grow', placeholder: 'Buscar insumo o producto…', 'aria-label': 'Buscar en inventario' });
  const status = select([{ value: 'all', label: 'Todos los estados' }, { value: 'out', label: 'Agotados' }, { value: 'low', label: 'Stock bajo' }, { value: 'ok', label: 'Normales' }, { value: 'excess', label: 'Exceso' }], 'all', { 'aria-label': 'Estado' });
  const kind = select([{ value: '', label: 'Todos los tipos' }, { value: 'raw_flower', label: 'Flores' }, { value: 'foliage', label: 'Follaje' }, { value: 'supply', label: 'Insumos' }, { value: 'accessory', label: 'Accesorios' }, { value: 'packaging', label: 'Packaging' }, { value: 'finished', label: 'Terminados' }], '', { 'aria-label': 'Tipo' });
  const actions = [session.can('inventario.merma') && h('button', { class: 'btn', type: 'button', onclick: () => openWaste({ onDone: refresh }) }, 'Registrar merma'),
    session.can('inventario.create') && h('button', { class: 'btn', type: 'button', onclick: () => openEnroll({ onDone: refresh }) }, 'Incorporar existente'),
    session.can('inventario.create') && session.can('productos.create') && h('button', { class: 'btn primary', type: 'button', onclick: () => openNewSupply({ onDone: refresh }) }, icon('plus'), 'Nuevo insumo')].filter(Boolean);
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Inventario' }, { label: 'Stock' }]),
    pageHead({ title: 'Stock', subtitle: 'Existencias en tiempo real: físico, reservado y disponible, con costo promedio.', actions }), alertsBox, holder);

  const reload = () => { st.page = 1; load(); };
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); reload(); }, 300));
  status.addEventListener('change', () => { st.status = status.value; reload(); });
  kind.addEventListener('change', () => { st.kind = kind.value; reload(); });
  const toolbar = () => h('div', { class: 'toolbar' }, search, status, kind);

  function refresh() { return Promise.all([loadAlerts(), load()]); }

  async function loadAlerts() {
    try {
      const a = await inventoryApi.alerts(); const c = a.counts;
      const chips = [['out', 'Agotados', c.out, 'err'], ['low', 'Bajo mínimo', c.low, 'warn'], ['excess', 'En exceso', c.excess, 'info']].filter(([, , n]) => n > 0);
      const extra = [];
      if (c.expiring) extra.push(h('div', { class: 'alert warn', role: 'status' }, h('div', {}, h('strong', {}, `${c.expiring} lote(s) vencen en 3 días o menos: `), a.expiring.slice(0, 4).map((e) => `${e.name} (${e.daysLeft < 0 ? 'vencido' : e.daysLeft === 0 ? 'hoy' : `${e.daysLeft} d`})`).join(', '), a.expiring.length > 4 ? '…' : '')));
      if (c.slow) extra.push(h('div', { class: 'alert info', role: 'status' }, h('div', {}, h('strong', {}, `${c.slow} producto(s) sin salidas hace más de 60 días: `), a.slow.slice(0, 4).map((s) => s.name).join(', '))));
      setChildren(alertsBox, chips.length ? h('div', { class: 'actions', style: 'margin-bottom:12px' }, chips.map(([k, l, n, cls]) => h('button', { class: `btn sm ${cls === 'err' ? 'danger' : ''}`, type: 'button', onclick: () => { status.value = k; st.status = k; reload(); } }, `${l}: ${n}`))) : null, extra);
    } catch { setChildren(alertsBox); }
  }

  async function load() {
    setChildren(holder, toolbar(), skeletonRows(7));
    try {
      const r = await inventoryApi.items({ page: st.page, limit: 15, q: st.q, status: st.status, kind: st.kind, sort: st.sort.key, dir: st.sort.dir });
      const act = (i) => [h('button', { class: 'btn sm', type: 'button', onclick: () => openDetail({ item: i, onChanged: refresh }) }, 'Detalle'),
        session.can('inventario.adjust') && h('button', { class: 'btn sm', type: 'button', onclick: () => openAdjust({ item: i, onDone: refresh }) }, 'Ajustar'),
        session.can('inventario.merma') && h('button', { class: 'btn sm', type: 'button', onclick: () => openWaste({ item: i, onDone: refresh }) }, 'Merma')].filter(Boolean);
      setChildren(holder, toolbar(), r.data.length ? dataTable({ rows: r.data, actions: act, sort: st.sort, onSort: (key, dir) => { st.sort = { key, dir }; load(); }, columns: [
        { key: 'name', sortKey: 'name', label: 'Producto', render: (i) => h('span', {}, h('strong', {}, i.name), h('br'), h('span', { class: 'muted small' }, i.category || '—')) },
        { key: 'onHand', sortKey: 'onHand', label: 'Físico', render: (i) => `${formatQty(i.onHand)} ${i.unit}` },
        { key: 'reserved', label: 'Reservado', render: (i) => formatQty(i.reserved) },
        { key: 'available', label: 'Disponible', render: (i) => h('strong', {}, formatQty(i.available)) },
        { key: 'min', label: 'Mín.', render: (i) => formatQty(i.minStock) },
        { key: 'avg', label: 'Costo prom.', render: (i) => h('span', { class: 'nowrap' }, formatGs(i.avgCostPyg)) },
        { key: 'value', sortKey: 'value', label: 'Valor', render: (i) => h('span', { class: 'nowrap' }, formatGs(i.valuePyg)) },
        { key: 'status', label: 'Estado', render: (i) => statusBadge(i.status) },
      ] }) : emptyState('No hay productos en inventario', st.q || st.status !== 'all' || st.kind ? 'Probá con otros filtros.' : 'Creá un insumo nuevo o incorporá un producto existente.'),
      h('div', { class: 'pager' }, h('span', {}, `Valor del inventario (según filtros): `, h('strong', {}, formatGs(r.totalValuePyg)))), pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } }));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  await refresh();
}
