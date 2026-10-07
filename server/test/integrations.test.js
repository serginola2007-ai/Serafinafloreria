'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call } = require('./helpers');
const { createRegistry } = require('../src/modules/integrations/registry');

describe('integraciones externas', () => {
  let app, mk;
  before(async () => { app = await makeApp(); mk = await userWithRole(app, 'marketing', 'mk@test.local'); });
  after(async () => { await app.close_all(); });

  test('sin credenciales: las 6 aparecen como no configuradas, listando solo NOMBRES de variables', async () => {
    const r = (await call(app, mk, 'GET', '/api/v1/integrations')).json().data;
    assert.deepEqual(r.map((x) => x.id), ['ga4', 'search_console', 'business_profile', 'facebook', 'instagram', 'whatsapp']);
    assert.ok(r.every((x) => x.status === 'not_configured' && x.implemented === false && x.missingEnv.length >= 3));
    assert.ok(!/followers|sessions|reach|impressions/i.test(JSON.stringify(r)), 'ninguna métrica');
  });
  test('pedir métricas sin configurar → 409; configuradas pero sin adaptador → 501; jamás datos de ejemplo', async () => {
    const r = await call(app, mk, 'GET', '/api/v1/integrations/ga4/metrics');
    assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'INTEGRATION_NOT_CONFIGURED');
    const reg = createRegistry({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GA4_PROPERTY_ID: 'c' });
    const a = reg.get('ga4');
    assert.equal(a.status, 'credentials_present');
    await assert.rejects(a.fetchMetrics(), (e) => e.statusCode === 501 && e.code === 'INTEGRATION_NOT_IMPLEMENTED');
    assert.equal((await call(app, mk, 'GET', '/api/v1/integrations/inexistente/metrics')).statusCode, 404);
  });
  test('el valor de las credenciales jamás sale por la API', async () => {
    const a2 = await makeApp({}, {});
    a2.integrationEnv = {};
    await a2.close_all();
    const reg = createRegistry({ GOOGLE_CLIENT_ID: 'SECRETO-123', GOOGLE_CLIENT_SECRET: 'SECRETO-456', GA4_PROPERTY_ID: 'p' });
    assert.ok(!JSON.stringify([...reg.values()].map((x) => x.describe())).includes('SECRETO'));
  });
  test('sin permiso → 403', async () => {
    const v = await userWithRole(app, 'ventas', 'v@test.local');
    assert.equal((await call(app, v, 'GET', '/api/v1/integrations')).statusCode, 403);
  });
});
