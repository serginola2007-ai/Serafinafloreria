'use strict';
const migrate = require('../../db/migrate');

module.exports = async function healthRoutes(app) {
  const latest = migrate.load().at(-1)?.version;
  // Liveness: el proceso responde. Sin tocar la base.
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  // Readiness: base alcanzable y esquema al día con el código.
  app.get('/ready', { config: { rateLimit: false } }, async (req, reply) => {
    try {
      const { rows } = await app.pool.query('SELECT max(version) AS v FROM schema_migrations');
      const current = rows[0].v;
      if (current !== latest) return reply.code(503).send({ status: 'schema_outdated', expected: latest, current });
      return { status: 'ready', schema: current };
    } catch (err) {
      req.log.error({ err }, 'readiness falló');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
};
