import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable } from '../../components/table.js';
import { input } from '../../components/form.js';
import { skeletonRows, errorState, emptyState } from '../../components/states.js';
import { reportsApi } from '../../api/resources.js';
import { formatGs, formatDate } from '../../utils/format.js';

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA'); };
const CH = { mostrador: 'Mostrador', web: 'Web', whatsapp: 'WhatsApp', instagram: 'Instagram', telefono: 'Teléfono', evento: 'Evento', mayorista: 'Mayorista' };

export default async function mount({ view, session }) {
  const st = { from: monthStart(), to: new Date().toLocaleDateString('en-CA') }; const body = h('div', {});
  const from = input({ type: 'date', value: st.from, 'aria-label': 'Desde' }); const to = input({ type: 'date', value: st.to, 'aria-label': 'Hasta' });
  [from, to].forEach((e) => e.addEventListener('input', () => { if (from.value && to.value && from.value <= to.value) { st.from = from.value; st.to = to.value; load(); } }));
  const csvLinks = () => { if (!session.can('reportes.export')) return null; const q = `?from=${st.from}&to=${st.to}`;
    return h('div', { class: 'toolbar', style: 'border:0;flex-wrap:wrap' }, h('a', { class: 'btn', href: `/api/v1/reports/sales.csv${q}` }, 'Ventas (CSV)'), session.can('finanzas.view') && h('a', { class: 'btn', href: `/api/v1/reports/expenses.csv${q}` }, 'Gastos (CSV)'),
      h('a', { class: 'btn', href: '/api/v1/reports/inventory.csv' }, 'Inventario (CSV)'), h('a', { class: 'btn', href: '/api/v1/reports/receivables.csv' }, 'Por cobrar (CSV)')); };
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Reportes' }]), pageHead({ title: 'Reportes', subtitle: 'Datos reales de ventas del período seleccionado.' }),
    h('div', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'toolbar', style: 'border:0' }, h('label', { class: 'small muted' }, 'Desde ', from), h('label', { class: 'small muted' }, 'Hasta ', to)), csvLinks()), body);
  const card = (title, content) => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, title)), content);
  async function load() {
    setChildren(body, skeletonRows(5));
    try {
      const r = await reportsApi.overview({ from: st.from, to: st.to }); const withCost = r.topProducts[0] && 'marginPyg' in r.topProducts[0];
      if (!r.byDay.length) { setChildren(body, emptyState('Sin ventas en el período', 'Probá con otro rango de fechas.')); return; }
      const max = Math.max(...r.byDay.map((d) => d.totalPyg));
      setChildren(body, h('div', { class: 'grid cols-2' },
        card('Ventas por día', h('ul', { class: 'list' }, r.byDay.map((d) => h('li', { style: 'display:grid;grid-template-columns:90px 1fr auto;gap:8px;align-items:center' }, h('span', { class: 'small' }, formatDate(d.day)),
          h('span', { 'aria-hidden': 'true', style: `height:8px;border-radius:4px;background:var(--primary, #7b2d3b);width:${Math.max(2, Math.round((d.totalPyg / max) * 100))}%` }), h('strong', { class: 'nowrap' }, formatGs(d.totalPyg)))))),
        card('Por canal', dataTable({ rows: r.byChannel, columns: [{ key: 'c', label: 'Canal', render: (x) => CH[x.channel] ?? x.channel }, { key: 'n', label: 'Ventas', render: (x) => String(x.sales) }, { key: 't', label: 'Total', render: (x) => h('strong', {}, formatGs(x.totalPyg)) }] })),
        card('Por método de cobro', dataTable({ rows: r.byMethod, columns: [{ key: 'm', label: 'Método', render: (x) => x.method }, { key: 't', label: 'Cobrado', render: (x) => h('strong', {}, formatGs(x.totalPyg)) }] })),
        card('Mejores clientes', r.topCustomers.length ? dataTable({ rows: r.topCustomers, columns: [{ key: 'c', label: 'Cliente', render: (x) => h('a', { href: `#/clientes/${x.id}` }, x.name) }, { key: 'n', label: 'Compras', render: (x) => String(x.sales) }, { key: 't', label: 'Total', render: (x) => h('strong', {}, formatGs(x.totalPyg)) }] }) : emptyState('Sin clientes registrados en ventas')),
        h('div', { style: 'grid-column:1/-1' }, card('Productos más vendidos', dataTable({ rows: r.topProducts, columns: [{ key: 'd', label: 'Producto', render: (x) => x.description }, { key: 'q', label: 'Unidades', render: (x) => String(x.qty) }, { key: 'r', label: 'Ingresos', render: (x) => formatGs(x.revenuePyg) },
          ...(withCost ? [{ key: 'c', label: 'Costo', render: (x) => (x.costPyg == null ? 'Sin costo' : formatGs(x.costPyg)) }, { key: 'm', label: 'Margen', render: (x) => (x.marginPyg == null ? '—' : h('strong', {}, formatGs(x.marginPyg))) }] : [])] })))));
    } catch (e) { setChildren(body, errorState(e.message, load)); }
  }
  await load();
}
