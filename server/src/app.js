'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const { makeHasher } = require('./lib/passwords');
const security = require('./plugins/security');
const errors = require('./plugins/errors');
const auth = require('./plugins/auth');

async function buildApp({ config, pool, storage, logger } = {}) {
  const app = Fastify({
    logger: logger ?? (config.isTest ? false : {
      level: config.logLevel,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], censor: '[REDACTED]' },
    }),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: (req) => { const h = req.headers['x-request-id']; return typeof h === 'string' && /^[\w-]{8,64}$/.test(h) ? h : crypto.randomUUID(); },
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true, useDefaults: true, allErrors: false } },
  });

  app.decorate('config', config);
  app.decorate('pool', pool);
  app.decorate('storage', storage);
  app.decorate('hasher', makeHasher(config.argonMemoryKiB));

  app.addHook('onSend', async (req, reply) => { reply.header('x-request-id', req.id); });

  errors.register(app);
  await security.register(app, config);
  auth.register(app, config, pool);

  await app.register(require('./modules/health/routes'));
  await app.register(require('./modules/auth/routes'));
  await app.register(require('./modules/users/routes'));
  await app.register(require('./modules/rbac/routes'));
  await app.register(require('./modules/audit/routes'));
  await app.register(require('./modules/catalog/routes'));
  await app.register(require('./modules/media/routes'));
  await app.register(require('./modules/integrations/routes'));
  await app.register(require('./modules/dashboard/routes'));

  // El panel (/admin/) lo sirve este mismo backend cuando existe el directorio.
  const adminDir = path.join(__dirname, '..', '..', 'admin');
  if (fs.existsSync(adminDir)) {
    await app.register(require('@fastify/static'), { root: adminDir, prefix: '/admin/' });
    app.get('/admin', { config: { rateLimit: false } }, (req, reply) => reply.redirect('/admin/'));
  }
  return app;
}
module.exports = { buildApp };
