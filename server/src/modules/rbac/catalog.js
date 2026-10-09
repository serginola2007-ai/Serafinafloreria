'use strict';
/**
 * Catálogo ÚNICO de permisos y roles del sistema (nomenclatura `modulo.accion`, en español).
 * `npm run seed` lo sincroniza con la base de forma idempotente.
 * Los conjuntos por rol son el punto de partida propuesto: el Administrador puede ajustarlos desde la API.
 */
const MODULES = {
  ventas:        { view: 'Ver ventas', create: 'Crear ventas / usar POS', edit: 'Editar ventas', cancel: 'Anular ventas', refund: 'Registrar devoluciones', discount: 'Aplicar descuentos' },
  pedidos:       { view: 'Ver pedidos', create: 'Crear pedidos', edit: 'Editar pedidos', cancel: 'Cancelar pedidos' },
  productos:     { view: 'Ver productos', create: 'Crear productos', edit: 'Editar productos y precios', delete: 'Archivar productos' },
  inventario:    { view: 'Ver inventario', create: 'Crear ítems de inventario', edit: 'Editar ítems de inventario', adjust: 'Ajustar stock', merma: 'Registrar merma' },
  compras:       { view: 'Ver compras', create: 'Crear órdenes de compra', edit: 'Editar compras', receive: 'Recibir mercadería' },
  proveedores:   { view: 'Ver proveedores', create: 'Crear proveedores', edit: 'Editar proveedores', delete: 'Archivar proveedores' },
  produccion:    { view: 'Ver producción', edit: 'Gestionar órdenes de producción' },
  delivery:      { view: 'Ver entregas', edit: 'Gestionar entregas y rutas', own: 'Ver y actualizar solo entregas propias' },
  caja:          { view: 'Ver caja', open: 'Abrir caja', close: 'Cerrar caja', adjust: 'Registrar ingresos, egresos y ajustes' },
  finanzas:      { view: 'Ver finanzas (gastos, cuentas por cobrar y pagar)', edit: 'Gestionar finanzas' },
  clientes:      { view: 'Ver clientes', create: 'Crear clientes', edit: 'Editar clientes', delete: 'Archivar clientes', export: 'Exportar clientes' },
  eventos:       { view: 'Ver eventos y cotizaciones', create: 'Crear eventos y cotizaciones', edit: 'Editar eventos y cotizaciones' },
  facturacion:   { view: 'Ver documentos y configuración fiscal', emit: 'Emitir documentos', edit: 'Editar configuración fiscal' },
  web:           { view: 'Ver contenido del sitio', edit: 'Editar contenido del sitio', publish: 'Publicar cambios del sitio' },
  media:         { view: 'Ver biblioteca multimedia', upload: 'Subir archivos', delete: 'Eliminar archivos' },
  analytics:     { view: 'Ver analytics' },
  marketing:     { view: 'Ver marketing e integraciones', edit: 'Configurar integraciones' },
  reportes:      { view: 'Ver reportes', export: 'Exportar reportes' },
  usuarios:      { view: 'Ver usuarios', create: 'Crear usuarios', edit: 'Editar usuarios', delete: 'Desactivar usuarios' },
  roles:         { view: 'Ver roles y permisos', edit: 'Editar roles y permisos' },
  auditoria:     { view: 'Ver auditoría' },
  configuracion: { view: 'Ver configuración', edit: 'Editar configuración' },
};

const PERMISSIONS = [];
for (const [module, actions] of Object.entries(MODULES)) {
  for (const [action, description] of Object.entries(actions)) PERMISSIONS.push({ code: `${module}.${action}`, module, description });
}
const ALL = PERMISSIONS.map((p) => p.code);
const pick = (...patterns) => ALL.filter((c) => patterns.some((p) => (p.endsWith('.*') ? c.startsWith(p.slice(0, -1)) : c === p)));

const ROLES = [
  { code: 'administrador', name: 'Administrador', description: 'Acceso total', is_superuser: true, permissions: [] },
  { code: 'ventas', name: 'Ventas', description: 'Ventas, pedidos, clientes y consulta de catálogo',
    permissions: pick('ventas.view', 'ventas.create', 'ventas.edit', 'ventas.cancel', 'ventas.discount', 'pedidos.*', 'clientes.view', 'clientes.create', 'clientes.edit', 'productos.view', 'inventario.view', 'eventos.*', 'caja.view', 'media.view') },
  { code: 'florista', name: 'Florista / Producción', description: 'Producción, pedidos e inventario necesario',
    permissions: pick('produccion.*', 'pedidos.view', 'inventario.view', 'inventario.merma', 'productos.view', 'eventos.view', 'media.view') },
  { code: 'repartidor', name: 'Repartidor', description: 'Entregas propias', permissions: pick('delivery.own') },
  { code: 'marketing', name: 'Marketing', description: 'Contenido web, analytics y redes',
    permissions: pick('web.*', 'media.*', 'analytics.view', 'marketing.*', 'productos.view', 'reportes.view') },
  { code: 'contabilidad', name: 'Contabilidad', description: 'Caja, pagos, gastos, facturación y reportes financieros',
    permissions: pick('caja.*', 'finanzas.*', 'facturacion.*', 'reportes.*', 'ventas.view', 'compras.view', 'proveedores.view', 'clientes.view') },
  { code: 'personalizado', name: 'Personalizado', description: 'Sin permisos base; el Administrador asigna permisos individuales', permissions: [] },
];

module.exports = { MODULES, PERMISSIONS, ROLES, ALL_CODES: ALL };
