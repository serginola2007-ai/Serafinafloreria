import { h, setChildren } from '../../components/dom.js';
import { breadcrumbs, pageHead } from '../../components/page.js';
import { dashboardApi } from '../../api/resources.js';
import { skeletonRows, errorState, emptyState } from '../../components/states.js';
import { formatDateTime, formatGs } from '../../utils/format.js';

const stat = (label, value, hint) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value', style: typeof value === 'string' && value.length > 9 ? 'font-size:24px' : null }, String(value)), hint && h('div', { class: 'hint' }, hint));
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
    pageHead({ title: `Hola, ${session.user.fullName.split(' ')[0]}`, subtitle: 'Resumen de lo que podés ver con tu rol.' }));
  const body = h('div', {}, skeletonRows(4)); root.append(body); view.append(root);

  async function load() {
    setChildren(body, skeletonRows(4));
    let d;
    try { d = await dashboardApi.summary(); } catch (e) { setChildren(body, errorState(e.message, load)); return; }
    const cards = [];
    if (d.catalog) {
      cards.push(stat('Productos publicados', d.catalog.published, `${d.catalog.categories} categorías`));
      cards.push(stat('Productos a revisar', d.catalog.needs_review, d.catalog.needs_review ? 'Requieren revisión manual' : 'Nada pendiente'));
    }
    if (d.sales) {
      cards.push(stat('Ventas de hoy', formatGs(d.sales.today_total), `${d.sales.today_count} venta(s)`));
      cards.push(stat('Ventas del mes', formatGs(d.sales.month_total), `Ticket promedio ${formatGs(d.sales.averageTicket)}`));
      cards.push(stat('Por cobrar a clientes', formatGs(d.sales.receivable), d.sales.receivable_overdue > 0 ? `${formatGs(d.sales.receivable_overdue)} vencido` : 'Sin deuda vencida'));
    }
    if (d.cash) cards.push(stat('Caja', d.cash.open ? formatGs(d.cash.expectedCashPyg) : 'Cerrada', d.cash.open ? 'Efectivo esperado en caja' : 'Abrila para cobrar en efectivo'));
    if (d.inventory) {
      cards.push(stat('Stock agotado', d.inventory.out, d.inventory.out ? 'Revisá reposición' : 'Nada agotado'));
      cards.push(stat('Stock bajo mínimo', d.inventory.low, `Valor del inventario ${formatGs(d.inventory.value)}`));
    }
    if (d.purchasing) {
      cards.push(stat('Por pagar a proveedores', formatGs(d.purchasing.payable), d.purchasing.overdue > 0 ? `${formatGs(d.purchasing.overdue)} vencido` : 'Sin deuda vencida'));
      cards.push(stat('Órdenes de compra abiertas', d.purchasing.open_orders, 'Enviadas o parcialmente recibidas'));
    }
    if (d.users) cards.push(stat('Usuarios activos', d.users.active, `${d.users.inactive} inactivos`));
    if (d.integrations) cards.push(stat('Integraciones con credenciales', `${d.integrations.withCredentials}/${d.integrations.total}`, 'Sin credenciales, no se muestran métricas'));
    setChildren(body);
    if (cards.length) body.append(h('div', { class: 'grid cols-4' }, cards));
    else if (!d.recentActivity) body.append(h('div', { class: 'card' }, emptyState('Todavía no hay indicadores para tu rol', 'Usá el menú de la izquierda para acceder a tus secciones.')));
    if (d.recentActivity) {
      body.append(h('section', { class: 'card', style: 'margin-top:16px' }, h('div', { class: 'card-head' }, h('h2', {}, 'Actividad reciente'), session.canAny(['auditoria.view']) && h('a', { href: '#/auditoria' }, 'Ver todo')),
        d.recentActivity.length ? h('ul', { class: 'list' }, d.recentActivity.map((a) => h('li', {}, h('span', {}, h('strong', {}, a.userName || 'Sistema'), ' · ', actionLabel(a.action)), h('span', { class: 'muted small nowrap' }, formatDateTime(a.at)))))
          : emptyState('Sin actividad registrada')));
    }
  }
  await load();
}
