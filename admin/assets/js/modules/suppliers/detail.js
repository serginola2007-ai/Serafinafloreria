import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { skeletonRows, errorState, emptyState, badge } from '../../components/states.js';
import { openModal } from '../../components/modal.js';
import { productPicker } from '../../components/product-picker.js';
import { toast } from '../../components/toast.js';
import { suppliersApi } from '../../api/resources.js';
import { formatGs, formatDate, formatDateTime } from '../../utils/format.js';
import { openSupplierForm } from './supplier-form.js';
import { ORDER_STATUS } from '../purchasing/index.js';

export default async function mount({ view, session, params }) {
  const root = h('div', {}, skeletonRows(8)); view.append(root);
  async function load() {
    let s;
    try { s = await suppliersApi.get(params.id); } catch (e) { setChildren(root, errorState(e.message, load)); return; }
    const actions = [session.can('proveedores.edit') && h('button', { class: 'btn', type: 'button', onclick: () => openSupplierForm({ supplier: s, onSaved: load }) }, 'Editar'),
      session.can('compras.create') && s.active && h('a', { class: 'btn primary', href: `#/compras/nueva?supplierId=${s.id}` }, 'Nueva orden de compra')].filter(Boolean);
    const info = [['RUC', s.taxId], ['Contacto', s.contactName], ['Teléfono', s.phone], ['Correo', s.email], ['Dirección', s.address], ['Plazo de pago', s.paymentTermsDays ? `${s.paymentTermsDays} días` : 'Contado']];
    setChildren(root, breadcrumbs([{ label: 'Dashboard', href: '#/' }, { label: 'Compras' }, { label: 'Proveedores', href: '#/proveedores' }, { label: s.name }]),
      pageHead({ title: s.name, subtitle: s.notes || null, actions }),
      h('div', { class: 'grid cols-4', style: 'margin-bottom:16px' }, h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Saldo pendiente'), h('div', { class: 'value', style: 'font-size:26px' }, formatGs(s.balancePyg))),
        h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Órdenes'), h('div', { class: 'value' }, String(s.orders.length)))),
      h('div', { class: 'grid cols-2' },
        h('section', { class: 'card card-pad' }, h('h2', { style: 'margin-bottom:10px' }, 'Datos'), h('dl', { style: 'display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0' }, info.map(([k, v]) => [h('dt', { class: 'muted' }, k), h('dd', { style: 'margin:0' }, v || '—')]))),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Productos y precios'), session.can('proveedores.edit') && h('button', { class: 'btn sm', type: 'button', onclick: () => linkProduct(s) }, 'Vincular producto')),
          s.products.length ? h('ul', { class: 'list' }, s.products.map((p) => h('li', {}, h('span', {}, h('strong', {}, p.name), p.supplierSku && h('span', { class: 'muted small' }, ` · cód. ${p.supplierSku}`)),
            h('span', { class: 'nowrap' }, p.lastPricePyg != null ? `${formatGs(p.lastPricePyg)} / ${p.unit}` : 'sin compras', ' ', h('button', { class: 'btn sm', type: 'button', onclick: () => history(s, p) }, 'Historial'),
              session.can('proveedores.edit') && h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': `Desvincular ${p.name}`, onclick: async () => { try { await suppliersApi.unlink(s.id, p.productId); load(); } catch (e) { toast(e.message, 'err'); } } }, '✕')))))
            : emptyState('Sin productos vinculados', 'Se vinculan solos al recibir una compra, o manualmente.')),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Órdenes de compra')),
          s.orders.length ? h('ul', { class: 'list' }, s.orders.map((o) => h('li', {}, h('span', {}, h('a', { href: `#/compras/${o.id}` }, h('strong', {}, o.number)), ' ', badge(...(ORDER_STATUS[o.status] || [o.status, '']))), h('span', { class: 'muted small nowrap' }, `${formatGs(o.totalPyg)} · ${formatDate(o.createdAt)}`)))) : emptyState('Sin órdenes')),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Facturas pendientes')),
          s.openPayables.length ? h('ul', { class: 'list' }, s.openPayables.map((p) => h('li', {}, h('span', {}, p.invoiceNo || `Cuenta #${p.id}`, h('span', { class: 'muted small' }, ` · vence ${formatDate(p.dueDate)}`)), h('strong', {}, formatGs(p.totalPyg - p.paidPyg))))) : emptyState('Sin deuda'))));
  }
  function linkProduct(s) {
    const picker = productPicker({ id: 'lp-prod' }); const sku = h('input', { class: 'input', placeholder: 'Código del proveedor (opcional)', 'aria-label': 'Código del proveedor', maxlength: 60 });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Vincular'); const m = openModal({ title: 'Vincular producto', content: h('div', { style: 'display:grid;gap:12px' }, picker, sku), footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
    save.addEventListener('click', async () => { const pid = picker.getValue(); if (!pid) { toast('Elegí un producto', 'err'); return; } try { await suppliersApi.link(s.id, pid, sku.value.trim()); toast('Producto vinculado'); m.close(); load(); } catch (e) { toast(e.message, 'err'); } });
  }
  async function history(s, p) {
    const body = h('div', {}, skeletonRows(3)); const m = openModal({ title: `Precios de ${p.name}`, content: body, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cerrar')] });
    try { const { data } = await suppliersApi.priceHistory(s.id, p.productId); setChildren(body, data.length ? h('ul', { class: 'list' }, data.map((x) => h('li', {}, h('strong', {}, formatGs(x.pricePyg)), h('span', { class: 'muted small' }, formatDateTime(x.recordedAt))))) : emptyState('Todavía no hay compras de este producto')); }
    catch (e) { setChildren(body, errorState(e.message)); }
  }
  await load();
}
