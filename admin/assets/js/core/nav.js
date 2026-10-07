/**
 * Registro ÚNICO de módulos del panel: rutas, menú, permisos y carga diferida.
 * Un módulo sin permiso no aparece en el menú, ni en la paleta, y entrar por URL directa muestra "sin acceso"
 * (además de que el backend responde 403 a cada llamada). Solo se registran módulos que existen y funcionan.
 */
export const ROUTES = [
  { path: '/', id: 'dashboard', label: 'Dashboard', icon: 'home', group: 'General', anyOf: [], load: () => import('../modules/dashboard/index.js') },
  { path: '/usuarios', id: 'users', label: 'Usuarios', icon: 'users', group: 'Administración', anyOf: ['usuarios.view'], load: () => import('../modules/users/index.js') },
  { path: '/roles', id: 'roles', label: 'Roles y permisos', icon: 'shield', group: 'Administración', anyOf: ['roles.view'], load: () => import('../modules/roles/index.js') },
  { path: '/auditoria', id: 'audit', label: 'Auditoría', icon: 'list', group: 'Administración', anyOf: ['auditoria.view'], load: () => import('../modules/audit/index.js') },
  { path: '/integraciones', id: 'integrations', label: 'Integraciones', icon: 'plug', group: 'Marketing', anyOf: ['marketing.view', 'analytics.view', 'configuracion.view'], load: () => import('../modules/integrations/index.js') },
  { path: '/cuenta', id: 'account', label: 'Mi cuenta', icon: 'key', group: null, anyOf: [], load: () => import('../modules/account/index.js') },
];
export const visibleRoutes = (session) => ROUTES.filter((r) => r.group && session.canAny(r.anyOf));
export const findRoute = (path) => ROUTES.find((r) => r.path === path);
