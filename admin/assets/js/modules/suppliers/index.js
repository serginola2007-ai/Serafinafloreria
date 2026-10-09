import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dataTable, pager } from '../../components/table.js';
import { input } from '../../components/form.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { confirmDialog } from '../../components/confirm.js';
import { toast } from '../../components/toast.js';
import { icon } from '../../components/icons.js';
import { suppliersApi } from '../../api/resources.js';
import { formatGs, formatDate, debounce } from '../../utils/format.js';
import { openSupplierForm } from './supplier-form.js';

export default async function mount({ view, session }) {
  const st = { page: 1, q: '' }; const holder = h('div', { class: 'card' });
  const search = input({ type: 'search', class: 'input grow', placeholder: 'Buscar por nombre, RUC o contacto…', 'aria-label': 'Buscar proveedores' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.page = 1; load(); }, 300));
  const newBtn = session.can('proveedores.create') ? h('button', { class: 'btn primary', type: 'button', onclick: () => openSupplierForm({ onSaved: load }) }, icon('plus'), 'Nuevo proveedor') : null;
  view.append(breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Compras' }, { label: 'Proveedores' }]), pageHead({ title: 'Proveedores', subtitle: 'Contactos, condiciones de pago y saldo pendiente.', actions: newBtn }), holder);
  const toolbar = () => h('div', { class: 'toolbar' }, search);
  async function load() {
    setChildren(holder, toolbar(), skeletonRows(6));
    try {
      const r = await suppliersApi.list({ page: st.page, limit: 15, q: st.q });
      setChildren(holder, toolbar(), r.data.length ? dataTable({ rows: r.data, columns: [
        { key: 'name', label: 'Proveedor', render: (s) => h('span', {}, h('a', { href: `#/proveedores/${s.id}` }, h('strong', {}, s.name)), h('br'), h('span', { class: 'muted small' }, [s.taxId && `RUC ${s.taxId}`, s.contactName].filter(Boolean).join(' · ') || '—')) },
        { key: 'phone', label: 'Teléfono', render: (s) => s.phone || '—' }, { key: 'terms', label: 'Plazo', render: (s) => (s.paymentTermsDays ? `${s.paymentTermsDays} días` : 'Contado') },
        { key: 'balance', label: 'Saldo', render: (s) => (s.balancePyg > 0 ? badge(formatGs(s.balancePyg), 'warn') : '—') },
        { key: 'last', label: 'Última compra', render: (s) => (s.lastPurchaseAt ? formatDate(s.lastPurchaseAt) : '—') },
      ], actions: (s) => [h('a', { class: 'btn sm', href: `#/proveedores/${s.id}` }, 'Ver'),
        session.can('proveedores.edit') && h('button', { class: 'btn sm', type: 'button', onclick: () => openSupplierForm({ supplier: s, onSaved: load }) }, 'Editar'),
        session.can('proveedores.delete') && h('button', { class: 'btn sm danger', type: 'button', onclick: () => archive(s) }, 'Archivar')].filter(Boolean) }) : emptyState('No hay proveedores', st.q ? 'Probá con otra búsqueda.' : 'Cargá el primero con “Nuevo proveedor”.'),
      pager({ meta: r.meta, onPage: (p) => { st.page = p; load(); } }));
    } catch (e) { setChildren(holder, toolbar(), errorState(e.message, load)); }
  }
  async function archive(s) {
    if (!(await confirmDialog({ title: 'Archivar proveedor', message: `“${s.name}” dejará de aparecer para nuevas compras. Se conserva su historial.`, confirmLabel: 'Archivar', danger: true }))) return;
    try { await suppliersApi.archive(s.id); toast('Proveedor archivado'); load(); } catch (e) { toast(e.message, 'err'); }
  }
  await load();
}
