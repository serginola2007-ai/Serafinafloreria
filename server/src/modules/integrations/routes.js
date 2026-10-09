'use strict';
const access = require('../../lib/access');
const { notFound } = require('../../lib/errors');
const { createRegistry } = require('./registry');

module.exports = async function integrationsRoutes(app) {
  const registry = createRegistry(app.integrationEnv || process.env);
  const read = access.anyPerm('marketing.view', 'analytics.view', 'configuracion.view');
  app.get('/api/v1/integrations', { config: read }, async () => ({ data: [...registry.values()].map((a) => a.describe()) }));
  app.get('/api/v1/integrations/:id/metrics', {
    config: read, schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-z_0-9]+$', maxLength: 40 } } } },
  }, async (req) => {
    const a = registry.get(req.params.id);
    if (!a) throw notFound('Integración desconocida');
    return a.fetchMetrics();
  });
};
