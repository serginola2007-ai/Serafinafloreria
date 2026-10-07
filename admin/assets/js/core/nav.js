/**
 * Registro ÚNICO de módulos del panel: rutas, menú, permisos y carga diferida.
 * Un módulo sin permiso no aparece en el menú, ni en la paleta, y entrar por URL directa muestra "sin acceso"
 * (además de que el backend responde 403 a cada llamada). Solo se registran módulos que existen y funcionan.
 */
export const ROUTES = [
  { path: '/', id: 'dashboard', label: 'Dashboard', icon: 'home', group: 'General', anyOf: [], load: () => import('../modules/dashboard/index.js') },
  { path: '/productos', id: 'products', label: 'Productos', icon: 'box', group: 'Catálogo', anyOf: ['productos.view'], load: () => import('../modules/products/index.js') },
  { path: '/productos/nuevo', id: 'product-new', navId: 'products', label: 'Nuevo producto', group: null, anyOf: ['productos.create'], load: () => import('../modules/products/editor.js') },
  { path: '/productos/:id', id: 'product-edit', navId: 'products', label: 'Editar producto', group: null, anyOf: ['productos.view'], load: () => import('../modules/products/editor.js') },
  { path: '/categorias', id: 'categories', label: 'Categorías', icon: 'list', group: 'Catálogo', anyOf: ['productos.view'], load: () => import('../modules/products/categories.js') },
  { path: '/usuarios', id: 'users', label: 'Usuarios', icon: 'users', group: 'Administración', anyOf: ['usuarios.view'], load: () => import('../modules/users/index.js') },
  { path: '/roles', id: 'roles', label: 'Roles y permisos', icon: 'shield', group: 'Administración', anyOf: ['roles.view'], load: () => import('../modules/roles/index.js') },
  { path: '/auditoria', id: 'audit', label: 'Auditoría', icon: 'list', group: 'Administración', anyOf: ['auditoria.view'], load: () => import('../modules/audit/index.js') },
  { path: '/integraciones', id: 'integrations', label: 'Integraciones', icon: 'plug', group: 'Marketing', anyOf: ['marketing.view', 'analytics.view', 'configuracion.view'], load: () => import('../modules/integrations/index.js') },
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
