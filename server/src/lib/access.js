'use strict';
/**
 * Declaración obligatoria de acceso para toda ruta bajo /api/.
 *   config: access.public                 → sin sesión
 *   config: access.authenticated          → cualquier usuario autenticado
 *   config: access.perm('ventas.view')    → requiere permiso (código validado contra el catálogo al cargar)
 *   config: access.anyPerm('a.b','c.d')   → requiere al menos uno
 * Una ruta /api/ sin esta declaración hace fallar el arranque (ver plugins/auth.js).
 */
const { ALL_CODES } = require('../modules/rbac/catalog');

const known = new Set(ALL_CODES);
const check = (codes) => { for (const c of codes) if (!known.has(c)) throw new Error('Permiso inexistente en el catálogo: ' + c); };

module.exports = {
  public: { access: { public: true } },
  authenticated: { access: { authenticated: true } },
  /** Autenticado aun cuando deba cambiar la contraseña (logout, me, change-password). */
  authenticatedAllowPasswordChange: { access: { authenticated: true, allowPasswordChange: true } },
  perm: (code, extra = {}) => { check([code]); return { ...extra, access: { anyOf: [code] } }; },
  anyPerm: (...codes) => { check(codes); return { access: { anyOf: codes } }; },
};
