'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call } = require('./helpers');
const { setupFlowers } = require('./fixtures');

describe('finanzas: gastos, caja y resumen', () => {
  let app, admin, cont, vend, F, cat; const api = (s, m, u, b) => call(app, s, m, u, b);
  const today = new Date().toISOString().slice(0, 10);
  const exp = (b, s = cont) => api(s, 'POST', '/api/v1/expenses', { categoryId: cat, concept: 'Alquiler del local', amountPyg: 1000000, methodCode: 'transferencia', ...b });
  const summary = async () => (await api(cont, 'GET', `/api/v1/finance/summary?from=${today}&to=${today}`)).json();

  before(async () => {
    app = await makeApp();
    admin = await userWithRole(app, 'administrador', 'a@test.local'); cont = await userWithRole(app, 'contabilidad', 'c@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local');
    F = await setupFlowers(app, admin);
    cat = (await api(cont, 'POST', '/api/v1/expense-categories', { name: 'Alquiler' })).json().id;
  });
  after(async () => { await app.close_all(); });

  test('categorías: únicas sin importar mayúsculas; solo con permiso', async () => {
    assert.equal((await api(cont, 'POST', '/api/v1/expense-categories', { name: 'ALQUILER' })).statusCode, 409);
    assert.equal((await api(vend, 'POST', '/api/v1/expense-categories', { name: 'X1' })).statusCode, 403);
    assert.equal((await api(vend, 'GET', '/api/v1/expenses')).statusCode, 403);
  });

  test('gasto por transferencia: no toca la caja; valida fecha, categoría y monto', async () => {
    assert.equal((await exp({ date: '2999-01-01' })).statusCode, 400);
    assert.equal((await exp({ amountPyg: 0 })).statusCode, 400);
    assert.equal((await exp({ amountPyg: 1.5 })).statusCode, 400);
    assert.equal((await exp({ categoryId: 9999 })).statusCode, 400);
    assert.equal((await exp({ methodCode: 'nada' })).statusCode, 400);
    const r = await exp({}); assert.equal(r.statusCode, 201, r.body); assert.match(r.json().number, /^G-\d{6}$/);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM cash_movements')).rows[0].n, 0);
  });

  test('gasto en efectivo: exige caja abierta, descuenta de la caja y la anulación lo devuelve', async () => {
    const closed = await exp({ methodCode: 'efectivo', amountPyg: 50000 }); assert.equal(closed.statusCode, 409); assert.equal(closed.json().error.code, 'CASH_CLOSED');
    assert.equal((await api(admin, 'GET', '/api/v1/expenses?status=all')).json().data.length, 1, 'no quedó nada a medias');
    await api(admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 200000 });
    const big = await exp({ methodCode: 'efectivo', amountPyg: 900000 }); assert.equal(big.statusCode, 409); assert.equal(big.json().error.code, 'INSUFFICIENT_CASH');
    const ok = await exp({ methodCode: 'efectivo', amountPyg: 50000, concept: 'Bolsas' }); assert.equal(ok.statusCode, 201);
    assert.equal((await api(admin, 'GET', '/api/v1/cash/current')).json().session.expectedCashPyg, 150000);
    assert.equal((await api(cont, 'POST', `/api/v1/expenses/${ok.json().id}/void`, { reason: 'x' })).statusCode, 400);
    assert.equal((await api(cont, 'POST', `/api/v1/expenses/${ok.json().id}/void`, { reason: 'Error de carga' })).statusCode, 200);
    assert.equal((await api(admin, 'GET', '/api/v1/cash/current')).json().session.expectedCashPyg, 200000);
    assert.equal((await api(cont, 'POST', `/api/v1/expenses/${ok.json().id}/void`, { reason: 'otra vez' })).statusCode, 409);
    await api(admin, 'POST', '/api/v1/cash/close', { countedCashPyg: 200000 });
  });

  test('resumen: ventas, costo congelado, gastos por categoría y resultado; sin costo completo NO inventa el resultado', async () => {
    assert.equal((await summary()).operatingResultPyg !== undefined, true);
    await api(admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 0 });
    const s = await api(admin, 'POST', '/api/v1/sales', { items: [{ variantId: F.variantId, qty: 2 }], payments: [{ methodCode: 'transferencia', amountPyg: 500000 }] }); assert.equal(s.statusCode, 201, s.body);
    const r = await summary();
    assert.equal(r.salesPyg, 500000); assert.equal(r.costPyg, 58400); assert.equal(r.costComplete, true); assert.equal(r.grossMarginPyg, 441600);
    assert.equal(r.expensesPyg, 1000000, 'el gasto anulado no cuenta'); assert.deepEqual(r.expensesByCategory.map((x) => [x.name, x.totalPyg]), [['Alquiler', 1000000]]);
    assert.equal(r.operatingResultPyg, 441600 - 1000000);
    // venta sin receta ni stock → costo desconocido → resultado null
    const p = (await api(admin, 'POST', '/api/v1/products', { name: 'Servicio sin costo', categoryId: F.cat, variants: [{ label: 'U', pricePyg: 10000 }], mediaIds: [F.img], publish: true })).json();
    const sv = await api(admin, 'POST', '/api/v1/sales', { items: [{ variantId: p.variants[0].id, qty: 1 }], payments: [{ methodCode: 'transferencia', amountPyg: 10000 }] }); assert.equal(sv.statusCode, 201, sv.body);
    const r2 = await summary(); assert.equal(r2.costComplete, false); assert.equal(r2.unknownCostLines, 1); assert.equal(r2.grossMarginPyg, null); assert.equal(r2.operatingResultPyg, null);
    assert.equal((await api(vend, 'GET', '/api/v1/finance/summary')).statusCode, 403);
    assert.equal((await api(cont, 'GET', '/api/v1/finance/summary?from=2030-02-01&to=2030-01-01')).statusCode, 400);
  });

  test('auditoría e invariantes: cada alta/anulación auditada; gastos ligados a su movimiento de caja', async () => {
    const n = (await app.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action IN ('expense.created','expense.voided')`)).rows[0].n; assert.equal(n, 3);
    const bad = await app.pool.query(`SELECT 1 FROM expenses e JOIN payment_methods m ON m.id = e.method_id WHERE m.affects_cash AND e.cash_movement_id IS NULL`); assert.equal(bad.rowCount, 0);
  });
});
