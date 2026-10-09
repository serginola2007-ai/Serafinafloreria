/**
 * Registro ÚNICO de módulos del panel: rutas, menú, permisos y carga diferida.
 * Un módulo sin permiso no aparece en el menú, ni en la paleta, y entrar por URL directa muestra "sin acceso"
 * (además de que el backend responde 403 a cada llamada). Solo se registran módulos que existen y funcionan.
 */
export const ROUTES = [
  { path: '/', id: 'dashboard', label: 'Dashboard', icon: 'home', group: 'General', anyOf: [], load: () => import('../modules/dashboard/index.js') },
  { path: '/ventas/nueva', id: 'pos', label: 'Nueva venta', icon: 'plus', group: 'Ventas', anyOf: ['ventas.create'], load: () => import('../modules/sales/pos.js') },
  { path: '/ventas', id: 'sales', label: 'Historial de ventas', icon: 'list', group: 'Ventas', anyOf: ['ventas.view'], load: () => import('../modules/sales/index.js') },
  { path: '/ventas/:id', id: 'sale-detail', navId: 'sales', label: 'Venta', group: null, anyOf: ['ventas.view'], load: () => import('../modules/sales/detail.js') },
  { path: '/cobrar', id: 'receivables', label: 'Cuentas por cobrar', icon: 'shield', group: 'Ventas', anyOf: ['ventas.view', 'finanzas.view'], load: () => import('../modules/sales/receivables.js') },
  { path: '/caja', id: 'cash', label: 'Caja', icon: 'inbox', group: 'Ventas', anyOf: ['caja.view'], load: () => import('../modules/cash/index.js') },
  { path: '/clientes', id: 'customers', label: 'Clientes', icon: 'users', group: 'Ventas', anyOf: ['clientes.view'], load: () => import('../modules/customers/index.js') },
  { path: '/clientes/:id', id: 'customer-detail', navId: 'customers', label: 'Cliente', group: null, anyOf: ['clientes.view'], load: () => import('../modules/customers/detail.js') },
  { path: '/pedidos/nuevo', id: 'order-new', navId: 'orders', label: 'Nuevo pedido', group: null, anyOf: ['pedidos.create'], load: () => import('../modules/orders/form.js') },
  { path: '/pedidos/:id/editar', id: 'order-edit', navId: 'orders', label: 'Editar pedido', group: null, anyOf: ['pedidos.edit'], load: () => import('../modules/orders/form.js') },
  { path: '/pedidos', id: 'orders', label: 'Pedidos', icon: 'list', group: 'Pedidos', anyOf: ['pedidos.view'], load: () => import('../modules/orders/index.js') },
  { path: '/pedidos/:id', id: 'order-detail', navId: 'orders', label: 'Pedido', group: null, anyOf: ['pedidos.view'], load: () => import('../modules/orders/detail.js') },
  { path: '/produccion', id: 'production', label: 'Producción', icon: 'box', group: 'Pedidos', anyOf: ['produccion.view'], load: () => import('../modules/production/index.js') },
  { path: '/entregas', id: 'deliveries', label: 'Entregas', icon: 'inbox', group: 'Pedidos', anyOf: ['delivery.view', 'delivery.edit', 'delivery.own'], load: () => import('../modules/delivery/index.js') },
  { path: '/eventos', id: 'events', label: 'Eventos', icon: 'list', group: 'Pedidos', anyOf: ['eventos.view'], load: () => import('../modules/events/index.js') },
  { path: '/cotizaciones/nueva', id: 'quote-new', navId: 'events', label: 'Nueva cotización', group: null, anyOf: ['eventos.create'], load: () => import('../modules/events/form.js') },
  { path: '/cotizaciones/:id/editar', id: 'quote-edit', navId: 'events', label: 'Editar cotización', group: null, anyOf: ['eventos.edit'], load: () => import('../modules/events/form.js') },
  { path: '/cotizaciones/:id', id: 'quote-detail', navId: 'events', label: 'Cotización', group: null, anyOf: ['eventos.view'], load: () => import('../modules/events/detail.js') },
  { path: '/productos', id: 'products', label: 'Productos', icon: 'box', group: 'Catálogo y stock', anyOf: ['productos.view'], load: () => import('../modules/products/index.js') },
  { path: '/productos/nuevo', id: 'product-new', navId: 'products', label: 'Nuevo producto', group: null, anyOf: ['productos.create'], load: () => import('../modules/products/editor.js') },
  { path: '/productos/:id', id: 'product-edit', navId: 'products', label: 'Editar producto', group: null, anyOf: ['productos.view'], load: () => import('../modules/products/editor.js') },
  { path: '/categorias', id: 'categories', label: 'Categorías', icon: 'list', group: 'Catálogo y stock', anyOf: ['productos.view'], load: () => import('../modules/products/categories.js') },
  { path: '/inventario', id: 'stock', label: 'Stock', icon: 'box', group: 'Catálogo y stock', anyOf: ['inventario.view'], load: () => import('../modules/inventory/index.js') },
  { path: '/inventario/movimientos', id: 'movements', label: 'Movimientos', icon: 'list', group: 'Catálogo y stock', anyOf: ['inventario.view'], load: () => import('../modules/inventory/movements.js') },
  { path: '/inventario/merma', id: 'waste', label: 'Merma', icon: 'inbox', group: 'Catálogo y stock', anyOf: ['inventario.view', 'inventario.merma'], load: () => import('../modules/inventory/waste.js') },
  { path: '/compras', id: 'purchases', label: 'Órdenes de compra', icon: 'list', group: 'Compras', anyOf: ['compras.view'], load: () => import('../modules/purchasing/index.js') },
  { path: '/compras/nueva', id: 'purchase-new', navId: 'purchases', label: 'Nueva orden', group: null, anyOf: ['compras.create'], load: () => import('../modules/purchasing/order-form.js') },
  { path: '/compras/:id/editar', id: 'purchase-edit', navId: 'purchases', label: 'Editar orden', group: null, anyOf: ['compras.edit'], load: () => import('../modules/purchasing/order-form.js') },
  { path: '/compras/:id', id: 'purchase-detail', navId: 'purchases', label: 'Orden de compra', group: null, anyOf: ['compras.view'], load: () => import('../modules/purchasing/detail.js') },
  { path: '/proveedores', id: 'suppliers', label: 'Proveedores', icon: 'users', group: 'Compras', anyOf: ['proveedores.view'], load: () => import('../modules/suppliers/index.js') },
  { path: '/proveedores/:id', id: 'supplier-detail', navId: 'suppliers', label: 'Proveedor', group: null, anyOf: ['proveedores.view'], load: () => import('../modules/suppliers/detail.js') },
  { path: '/pagar', id: 'payables', label: 'Cuentas por pagar', icon: 'shield', group: 'Compras', anyOf: ['compras.view', 'finanzas.view'], load: () => import('../modules/purchasing/payables.js') },
  { path: '/finanzas', id: 'finance', label: 'Finanzas', icon: 'shield', group: 'Finanzas', anyOf: ['finanzas.view'], load: () => import('../modules/finance/index.js') },
  { path: '/reportes', id: 'reports', label: 'Reportes', icon: 'list', group: 'Finanzas', anyOf: ['reportes.view'], load: () => import('../modules/reports/index.js') },
  { path: '/usuarios', id: 'users', label: 'Usuarios', icon: 'users', group: 'Administración', anyOf: ['usuarios.view'], load: () => import('../modules/users/index.js') },
  { path: '/roles', id: 'roles', label: 'Roles y permisos', icon: 'shield', group: 'Administración', anyOf: ['roles.view'], load: () => import('../modules/roles/index.js') },
  { path: '/auditoria', id: 'audit', label: 'Auditoría', icon: 'list', group: 'Administración', anyOf: ['auditoria.view'], load: () => import('../modules/audit/index.js') },
  { path: '/integraciones', id: 'integrations', label: 'Integraciones', icon: 'plug', group: 'Administración', anyOf: ['marketing.view', 'analytics.view', 'configuracion.view'], load: () => import('../modules/integrations/index.js') },
  { path: '/cuenta', id: 'account', label: 'Mi cuenta', icon: 'key', group: null, anyOf: [], load: () => import('../modules/account/index.js') },
];
export const visibleRoutes = (session) => ROUTES.filter((r) => r.group && session.canAny(r.anyOf));
/** Busca la ruta (soporta segmentos :param). Las rutas exactas (/productos/nuevo) tienen prioridad por orden. */
export function findRoute(path) {
  for (const r of ROUTES) {
    if (r.path === path) return { route: r, params: {} };
    if (!r.path.includes(':')) continue;
    const a = r.path.split('/'), b = path.split('/');
    if (a.length !== b.length) continue;
    const params = {};
    if (a.every((seg, i) => (seg.startsWith(':') ? ((params[seg.slice(1)] = decodeURIComponent(b[i])), b[i] !== '') : seg === b[i]))) return { route: r, params };
  }
  return null;
}
