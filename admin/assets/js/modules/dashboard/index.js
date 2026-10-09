import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dashboardApi } from '../../api/resources.js';
import { skeletonRows, errorState, emptyState } from '../../components/states.js';
import { formatDateTime, formatGs } from '../../utils/format.js';

const kpi = (label, value, hint) => h('div', { class: 'stat kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, String(value)), hint && h('div', { class: 'hint' }, hint));
const ACTIONS = { 'auth.login': 'Inició sesión', 'auth.logout': 'Cerró sesión', 'auth.login_failed': 'Intento de ingreso fallido', 'auth.password_changed': 'Cambió su contraseña',
  'user.created': 'Creó un usuario', 'user.updated': 'Modificó un usuario', 'user.deactivated': 'Desactivó un usuario', 'user.permissions_set': 'Cambió permisos de un usuario',
  'user.password_reset': 'Restableció una contraseña', 'role.permissions_set': 'Cambió permisos de un rol', 'media.uploaded': 'Subió un archivo', 'media.deleted': 'Eliminó un archivo',
  'inventory.adjust_in': 'Ajustó stock (+)', 'inventory.adjust_out': 'Ajustó stock (−)', 'inventory.waste': 'Registró merma', 'inventory.item_enrolled': 'Incorporó un producto al inventario', 'inventory.settings_changed': 'Cambió límites de stock',
  'purchase_order.created': 'Creó una orden de compra', 'purchase_order.updated': 'Editó una orden de compra', 'purchase_order.sent': 'Envió una orden de compra', 'purchase_order.cancelled': 'Canceló una orden de compra', 'purchase_order.closed': 'Cerró una orden de compra',
  'purchase.received': 'Recibió mercadería', 'payable.payment': 'Registró un pago a proveedor', 'supplier.created': 'Creó un proveedor', 'supplier.updated': 'Modificó un proveedor', 'supplier.archived': 'Archivó un proveedor',
  'product.created': 'Creó un producto', 'product.updated': 'Modificó un producto', 'product.published': 'Publicó un producto', 'product.unpublished': 'Despublicó un producto', 'product.archived': 'Archivó un producto', 'variant.price_changed': 'Cambió un precio', 'category.created': 'Creó una categoría',
  'sale.confirmed': 'Confirmó una venta', 'sale.voided': 'Anuló una venta', 'sale.payment_added': 'Registró un cobro', 'cash.opened': 'Abrió la caja', 'cash.closed': 'Cerró la caja', 'cash.ingreso': 'Registró un ingreso de caja', 'cash.egreso': 'Registró un egreso de caja', 'cash.retiro': 'Registró un retiro de caja',
  'customer.created': 'Creó un cliente', 'customer.updated': 'Modificó un cliente', 'customer.archived': 'Archivó un cliente', 'recipe.updated': 'Modificó una receta', 'recipe.copied': 'Copió una receta' };
export const actionLabel = (a) => ACTIONS[a] || a;

export default async function mount({ view, session }) {
  const root = h('div', {}, breadcrumbs([{ label: 'Dashboard' }]),
    pageHead({ title: `Hola, ${session.user.fullName.split(' ')[0]}`, subtitle: 'Resumen según tu rol.' }));
  const body = h('div', {}); body.append(skeletonRows(3)); root.append(body); view.append(root);

  async function load() {
    setChildren(body, skeletonRows(3));
    let d;
    try { d = await dashboardApi.summary(); } catch (e) { setChildren(body, errorState(e.message, load)); return; }
    // Indicadores del día: una sola fila compacta con lo esencial.
    const kpis = [];
    if (d.sales) { kpis.push(kpi('Ventas de hoy', formatGs(d.sales.today_total), `${d.sales.today_count} venta(s)`), kpi('Ventas del mes', formatGs(d.sales.month_total), `Ticket promedio ${formatGs(d.sales.averageTicket)}`)); }
    if (d.cash) kpis.push(kpi('Caja', d.cash.open ? formatGs(d.cash.expectedCashPyg) : 'Cerrada', d.cash.open ? 'Efectivo esperado' : 'Sin abrir'));
    if (d.orders) kpis.push(kpi('Pedidos para hoy', d.orders.due_today, `${d.orders.in_progress} en curso`));
    // Solo lo que requiere acción: nada de contadores en cero.
    const todo = [];
    const add = (label, text, href, level = 'warn') => todo.push({ label, text, href, level });
    if (d.orders?.pending) add('Pedidos pendientes', `${d.orders.pending} por confirmar`, '#/pedidos');
    if (d.orders?.ready) add('Pedidos listos', `${d.orders.ready} para entregar`, '#/pedidos', 'info');
    if (d.inventory?.out) add('Stock agotado', `${d.inventory.out} producto(s)`, '#/inventario', 'err');
    if (d.inventory?.low) add('Stock bajo mínimo', `${d.inventory.low} producto(s)`, '#/inventario');
    if (d.sales?.receivable_overdue > 0) add('Cobros vencidos', formatGs(d.sales.receivable_overdue), '#/cobrar', 'err');
    else if (d.sales?.receivable > 0) add('Por cobrar a clientes', formatGs(d.sales.receivable), '#/cobrar', 'info');
    if (d.purchasing?.overdue > 0) add('Pagos vencidos a proveedores', formatGs(d.purchasing.overdue), '#/pagar', 'err');
    if (d.purchasing?.payable > 0) add('Por pagar a proveedores', formatGs(d.purchasing.payable), '#/pagar', 'info');
    if (d.purchasing?.open_orders) add('Órdenes de compra abiertas', `${d.purchasing.open_orders}`, '#/compras', 'info');
    if (d.catalog?.needs_review) add('Productos a revisar', `${d.catalog.needs_review}`, '#/productos');
    setChildren(body,
      kpis.length ? h('div', { class: 'kpi-row' }, kpis) : null,
      (kpis.length || todo.length) && h('section', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'card-head' }, h('h2', {}, 'Requiere atención')),
        todo.length ? h('ul', { class: 'list' }, todo.map((t) => h('li', {}, h('a', { href: t.href, class: 'todo-link' }, t.label), h('span', { class: `todo-val ${t.level}` }, t.text)))) : h('p', { class: 'muted', style: 'margin:0;padding:14px 16px' }, 'Sin pendientes por ahora.')),
      d.recentActivity && h('section', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'card-head' }, h('h2', {}, 'Actividad reciente'), session.canAny(['auditoria.view']) && h('a', { href: '#/auditoria' }, 'Ver todo')),
        d.recentActivity.length ? h('ul', { class: 'list' }, d.recentActivity.slice(0, 5).map((a) => h('li', {}, h('span', {}, h('strong', {}, a.userName || 'Sistema'), ' · ', actionLabel(a.action)), h('span', { class: 'muted small nowrap' }, formatDateTime(a.at))))) : emptyState('Sin actividad registrada')),
      !kpis.length && !d.recentActivity ? h('div', { class: 'card' }, emptyState('Todavía no hay indicadores para tu rol', 'Usá el menú superior para acceder a tus secciones.')) : null);
  }
  await load();
}
