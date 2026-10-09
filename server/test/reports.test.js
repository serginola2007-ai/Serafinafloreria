'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call } = require('./helpers');
const { setupFlowers } = require('./fixtures');

describe('reportes y exportaciones', () => {
  let app, admin, cont, mk, vend, F; const api = (s, m, u, b) => call(app, s, m, u, b);
  before(async () => {
    app = await makeApp();
    admin = await userWithRole(app, 'administrador', 'a@test.local'); cont = await userWithRole(app, 'contabilidad', 'c@test.local'); mk = await userWithRole(app, 'marketing', 'm@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local');
    F = await setupFlowers(app, admin);
    const cu = (await api(admin, 'POST', '/api/v1/customers', { name: '=HYPERLINK("http://x")', phone: '0981 1' })).json().id;
    await api(admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 0 });
    await api(admin, 'POST', '/api/v1/sales', { customerId: cu, channel: 'whatsapp', items: [{ variantId: F.variantId, qty: 2 }], payments: [{ methodCode: 'transferencia', amountPyg: 300000 }], creditDueDate: '2020-01-01' });
    const cat = (await api(admin, 'POST', '/api/v1/expense-categories', { name: 'Servicios' })).json().id;
    await api(admin, 'POST', '/api/v1/expenses', { categoryId: cat, concept: '+cmd|calc', amountPyg: 10000, methodCode: 'transferencia' });
  });
  after(async () => { await app.close_all(); });

  test('resumen: ventas por día/canal/método y top productos; costos solo con permiso financiero', async () => {
    const r = (await api(cont, 'GET', '/api/v1/reports/overview')).json();
    assert.equal(r.byChannel[0].channel, 'whatsapp'); assert.equal(r.byChannel[0].totalPyg, 500000); assert.equal(r.byMethod[0].totalPyg, 300000);
    assert.equal(r.topProducts[0].qty, 2); assert.equal(r.topProducts[0].costPyg, 58400); assert.equal(r.topProducts[0].marginPyg, 441600);
    const m = (await api(mk, 'GET', '/api/v1/reports/overview')).json(); assert.equal('costPyg' in m.topProducts[0], false, 'marketing no ve costos');
    assert.equal((await api(vend, 'GET', '/api/v1/reports/overview')).statusCode, 403);
    assert.equal((await api(cont, 'GET', '/api/v1/reports/overview?from=2030-02-01&to=2030-01-01')).statusCode, 400);
  });

  test('CSV: encabezados, BOM, descarga, neutralización de fórmulas y auditoría', async () => {
    const r = await api(cont, 'GET', '/api/v1/reports/sales.csv'); assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-type'], /text\/csv/); assert.match(r.headers['content-disposition'], /attachment; filename="ventas_/);
    assert.ok(r.body.startsWith('﻿numero,fecha,canal,cliente'), r.body.slice(0, 60)); assert.match(r.body, /V-000001/); assert.match(r.body, /441600/);
    assert.match(r.body, /"'=HYPERLINK/, 'la fórmula del nombre del cliente queda neutralizada');
    const e = await api(cont, 'GET', '/api/v1/reports/expenses.csv'); assert.match(e.body, /'\+cmd\|calc/); assert.doesNotMatch(e.body, /,\+cmd/);
    const mkSales = await api(mk, 'GET', '/api/v1/reports/sales.csv'); assert.equal(mkSales.statusCode, 403, 'marketing ve el resumen pero no exporta');
    assert.equal((await api(mk, 'GET', '/api/v1/reports/expenses.csv')).statusCode, 403);
    assert.equal((await api(null, 'GET', '/api/v1/reports/sales.csv')).statusCode, 401);
    assert.ok((await app.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'report.exported'`)).rows[0].n >= 2);
  });

  test('inventario y por cobrar: datos reales, vencidas marcadas; costos ocultos sin permiso', async () => {
    const i = await api(cont, 'GET', '/api/v1/reports/inventory.csv'); assert.match(i.body, /Rosa roja/); assert.match(i.body, /costo_promedio_pyg/);
    const rc = await api(cont, 'GET', '/api/v1/reports/receivables.csv'); assert.match(rc.body, /200000/); assert.match(rc.body, /,si\r?\n/, 'vencida');
    await api(admin, 'PUT', `/api/v1/roles/marketing/permissions`, { permissions: ['reportes.view', 'reportes.export'] });
    const mi = await api(mk, 'GET', '/api/v1/reports/inventory.csv'); assert.equal(mi.statusCode, 200); assert.doesNotMatch(mi.body, /costo_promedio/);
    const ms = await api(mk, 'GET', '/api/v1/reports/sales.csv'); assert.doesNotMatch(ms.body, /costo_pyg/);
  });
});
