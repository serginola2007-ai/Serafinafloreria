'use strict';
const crypto = require('node:crypto');
const { unauthorized, forbidden } = require('../lib/errors');
const { resolveSession } = require('../modules/auth/sessions');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const cookieName = (config) => (config.isProd ? '__Host-sid' : 'sid');

function register(app, config, pool) {
  const allowedOrigins = new Set(config.allowedOrigins);

  // Garantía de arranque: toda ruta /api/ debe declarar su política de acceso.
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/api/') && !route.config?.access) {
      throw new Error(`Ruta sin declaración de acceso: ${[].concat(route.method).join(',')} ${route.url}`);
    }
  });

  app.decorateRequest('user', null);
  app.decorateRequest('permissions', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('csrf', null);

  app.addHook('onRequest', async (req) => {
    const access = req.routeOptions?.config?.access;
    if (!access) return;
    const unsafe = !SAFE.has(req.method);

    if (unsafe) { // defensa en profundidad contra CSRF: el Origin, si viene, debe ser uno nuestro
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) throw forbidden('Origen no permitido', 'BAD_ORIGIN');
    }
    if (access.public) return;

    const sess = await resolveSession(pool, req.cookies?.[cookieName(config)], config);
    if (!sess) throw unauthorized();
    req.user = sess.user; req.permissions = sess.permissions; req.sessionId = sess.id; req.csrf = sess.csrf;

    if (unsafe) {
      const sent = req.headers['x-csrf-token'];
      const a = Buffer.from(String(sent || '')); const b = Buffer.from(sess.csrf);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw forbidden('Token CSRF inválido', 'CSRF');
    }
    if (sess.user.mustChangePassword && !access.allowPasswordChange) {
      throw forbidden('Tenés que cambiar tu contraseña antes de continuar', 'PASSWORD_CHANGE_REQUIRED');
    }
    if (access.anyOf && !access.anyOf.some((c) => sess.permissions.has(c))) throw forbidden();
  });
}

module.exports = { register, cookieName };
