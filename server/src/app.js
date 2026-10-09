'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const { makeHasher } = require('./lib/passwords');
const security = require('./plugins/security');
const errors = require('./plugins/errors');
const auth = require('./plugins/auth');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Validación estricta del cuerpo JSON (sin coerción: null/true/"123" NO se convierten en números).
// Solo query string y params se coercionan, porque llegan siempre como texto.
function makeValidatorCompiler() {
  const make = (coerceTypes) => addFormats(new Ajv({ removeAdditional: false, coerceTypes, useDefaults: true, allErrors: false, strict: false }));
  const strict = make(false); const loose = make(true);
  return ({ schema, httpPart }) => {
    const validate = (httpPart === 'querystring' || httpPart === 'params' ? loose : strict).compile(schema);
    return (data) => (validate(data) ? { value: data } : { error: validate.errors });
  };
}

async function buildApp({ config, pool, storage, logger } = {}) {
  const app = Fastify({
    logger: logger ?? (config.isTest ? false : {
      level: config.logLevel,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], censor: '[REDACTED]' },
    }),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: (req) => { const h = req.headers['x-request-id']; return typeof h === 'string' && /^[\w-]{8,64}$/.test(h) ? h : crypto.randomUUID(); },
  });

  app.setValidatorCompiler(makeValidatorCompiler());
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
  await app.register(require('./modules/catalog/admin-routes'));
  await app.register(require('./modules/media/routes'));
  await app.register(require('./modules/integrations/routes'));
  await app.register(require('./modules/inventory/routes'));
  await app.register(require('./modules/suppliers/routes'));
  await app.register(require('./modules/purchasing/routes'));
  await app.register(require('./modules/customers/routes'));
  await app.register(require('./modules/recipes/routes'));
  await app.register(require('./modules/cash/routes'));
  await app.register(require('./modules/sales/routes'));
  await app.register(require('./modules/orders/routes'));
  await app.register(require('./modules/orders/public-routes'));
  await app.register(require('./modules/production/routes'));
  await app.register(require('./modules/delivery/routes'));
  await app.register(require('./modules/finance/routes'));
  await app.register(require('./modules/events/routes'));
  await app.register(require('./modules/reports/routes'));
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
