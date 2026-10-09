'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call } = require('./helpers');
const { setupFlowers } = require('./fixtures');

describe('recetas: composición, costo y margen', () => {
  let app, admin, vend, F; const api = (s, m, u, b) => call(app, s, m, u, b);
  before(async () => { app = await makeApp(); admin = await userWithRole(app, 'administrador', 'admin@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local'); F = await setupFlowers(app, admin); });
  after(async () => { await app.close_all(); });

  test('costo = componentes al costo promedio + costos extra; margen y % calculados', async () => {
    const r = (await api(admin, 'GET', `/api/v1/variants/${F.variantId}/recipe`)).json();
    assert.equal(r.components.length, 5); assert.equal(r.componentCostPyg, 12 * 1000 + 3 * 400 + 500 + 300 + 200);
    assert.equal(r.extrasPyg, 15000); assert.equal(r.totalCostPyg, 29200);
    assert.equal(r.pricePyg, 250000); assert.equal(r.marginPyg, 220800); assert.equal(r.marginPct, 88.3);
    assert.equal(r.costComplete, true); assert.equal(r.buildable, 8, '100 rosas / 12 por ramo = 8 (la limitante)');
    const p = (await api(vend, 'GET', `/api/v1/products/${F.productId}`)).json(); assert.ok(p.id);
    assert.equal((await app.pool.query('SELECT is_composite FROM products WHERE id=$1', [F.productId])).rows[0].is_composite, true);
  });

  test('el costo sigue al costo promedio real: una compra más cara sube el costo de la receta', async () => {
    await api(admin, 'POST', '/api/v1/inventory/adjustments', { productId: F.rosa, direction: 'in', qty: 100, unitCostPyg: 2000, reason: 'Compra cara' });
    const r = (await api(admin, 'GET', `/api/v1/variants/${F.variantId}/recipe`)).json();
    assert.equal(r.components.find((c) => c.productId === F.rosa).avgCostPyg, 1500); assert.equal(r.totalCostPyg, 12 * 1500 + 1200 + 1000 + 15000);
    assert.equal(r.buildable, 10, 'ahora el límite es el eucalipto: 30 / 3');
    await api(admin, 'POST', '/api/v1/inventory/adjustments', { productId: F.rosa, direction: 'out', qty: 100, reason: 'Revertir prueba' });
  });

  test('validaciones: duplicados, cantidades, autorreferencia, terminados, no inventariados, inexistentes', async () => {
    const put = (b) => api(admin, 'PUT', `/api/v1/variants/${F.variantId}/recipe`, b);
    assert.equal((await put({ components: [{ productId: F.rosa, qty: 1 }, { productId: F.rosa, qty: 2 }] })).json().error.code, 'DUPLICATE_COMPONENT');
    for (const bad of [0, -1, 1.2345, 'x']) assert.equal((await put({ components: [{ productId: F.rosa, qty: bad }] })).statusCode >= 400, true);
    assert.equal((await put({ components: [{ productId: F.productId, qty: 1 }] })).json().error.code, 'SELF_COMPONENT');
    const other = (await api(admin, 'POST', '/api/v1/products', { name: 'Otro ramo', categoryId: F.cat, variants: [{ label: 'U', pricePyg: 1 }] })).json();
    assert.equal((await put({ components: [{ productId: other.id, qty: 1 }] })).json().error.code, 'INVALID_COMPONENT');
    const ns = (await api(admin, 'POST', '/api/v1/products', { name: 'Sin inventario', categoryId: F.supplies, kind: 'supply' })).json();
    assert.equal((await put({ components: [{ productId: ns.id, qty: 1 }] })).json().error.code, 'NOT_STOCKABLE');
    assert.equal((await put({ components: [{ productId: 999999, qty: 1 }] })).json().error.code, 'UNKNOWN_COMPONENT');
    assert.equal((await put({ components: [{ productId: F.rosa, qty: 1 }], extras: [{ concept: 'x', amountPyg: 1.5 }] })).statusCode, 400);
    assert.equal((await api(admin, 'GET', `/api/v1/variants/${F.variantId}/recipe`)).json().components.length, 5, 'una receta inválida no pisa la anterior');
    assert.equal((await api(vend, 'PUT', `/api/v1/variants/${F.variantId}/recipe`, { components: [] })).statusCode, 403);
    assert.equal((await api(vend, 'GET', `/api/v1/variants/${F.variantId}/recipe`)).statusCode, 200);
  });

  test('duplicar receta (con factor) a otra variante; activar/desactivar; costo por producto', async () => {
    const g = (await api(admin, 'POST', `/api/v1/products/${F.productId}/variants`, { label: 'G', pricePyg: 400000 })).json().variants.find((v) => v.label === 'G').id;
    const r = await api(admin, 'POST', `/api/v1/variants/${g}/recipe/copy-from`, { sourceVariantId: F.variantId, factor: 1.5 });
    assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().components.find((c) => c.productId === F.rosa).qty, 18); assert.equal(r.json().extrasPyg, 22500);
    assert.equal((await api(admin, 'POST', `/api/v1/variants/${g}/recipe/copy-from`, { sourceVariantId: 999999 })).statusCode, 404);
    const empty = (await api(admin, 'POST', `/api/v1/products/${F.productId}/variants`, { label: 'XL', pricePyg: 1 })).json().variants.find((v) => v.label === 'XL').id;
    assert.equal((await api(admin, 'POST', `/api/v1/variants/${g}/recipe/copy-from`, { sourceVariantId: empty })).json().error.code, 'EMPTY_SOURCE');
    const costing = (await api(admin, 'GET', `/api/v1/products/${F.productId}/costing`)).json().data;
    assert.equal(costing.length, 3); assert.equal(costing.find((c) => c.label === 'G').totalCostPyg, 27000 + 1800 + 750 + 450 + 300 + 22500, 'costo de G = receta ×1,5 al costo promedio vigente');
    assert.equal(costing.find((c) => c.label === 'G').marginPyg, 400000 - 52800);
    assert.equal(costing.find((c) => c.label === 'XL').hasRecipe, false);
    const off = await api(admin, 'PUT', `/api/v1/variants/${g}/recipe`, { enabled: false, components: costing && [{ productId: F.rosa, qty: 18 }] });
    assert.equal(off.json().enabled, false);
    const acts = new Set((await app.pool.query('SELECT action FROM audit_logs')).rows.map((x) => x.action)); assert.ok(acts.has('recipe.updated') && acts.has('recipe.copied'));
  });
});

describe('caja: apertura, movimientos, arqueo y cierre', () => {
  let app, admin, vend, cont; const api = (s, m, u, b) => call(app, s, m, u, b);
  before(async () => { app = await makeApp(); admin = await userWithRole(app, 'administrador', 'admin@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local'); cont = await userWithRole(app, 'contabilidad', 'c@test.local'); });
  after(async () => { await app.close_all(); });

  test('permisos: ventas solo mira; contabilidad opera', async () => {
    assert.equal((await api(vend, 'GET', '/api/v1/cash/current')).statusCode, 200);
    for (const [u, b] of [['/api/v1/cash/open', { openingAmountPyg: 1 }], ['/api/v1/cash/close', { countedCashPyg: 0 }], ['/api/v1/cash/movements', { type: 'ingreso', amountPyg: 1, concept: 'abc' }]]) assert.equal((await api(vend, 'POST', u, b)).statusCode, 403, u);
    assert.equal((await app.inject('/api/v1/cash/current')).statusCode, 401);
  });
  test('cerrada por defecto; no se opera con efectivo sin caja abierta', async () => {
    assert.deepEqual((await api(cont, 'GET', '/api/v1/cash/current')).json(), { open: false });
    assert.equal((await api(cont, 'POST', '/api/v1/cash/movements', { type: 'ingreso', amountPyg: 100, concept: 'Prueba' })).json().error.code, 'CASH_CLOSED');
    assert.equal((await api(cont, 'POST', '/api/v1/cash/close', { countedCashPyg: 0 })).json().error.code, 'CASH_CLOSED');
  });
  let sid;
  test('apertura con monto inicial; solo una caja abierta a la vez (también a nivel de base)', async () => {
    assert.equal((await api(cont, 'POST', '/api/v1/cash/open', { openingAmountPyg: -5 })).statusCode, 400);
    assert.equal((await api(cont, 'POST', '/api/v1/cash/open', { openingAmountPyg: 100000.5 })).statusCode, 400);
    const o = await api(cont, 'POST', '/api/v1/cash/open', { openingAmountPyg: 200000 }); assert.equal(o.statusCode, 201); sid = o.json().id;
    assert.equal((await api(admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 1 })).json().error.code, 'CASH_ALREADY_OPEN');
    await assert.rejects(app.pool.query('INSERT INTO cash_sessions(opened_by, opening_amount_pyg) VALUES (1, 0)'), (e) => e.code === '23505');
    const c = (await api(cont, 'GET', '/api/v1/cash/current')).json(); assert.equal(c.open, true); assert.equal(c.session.expectedCashPyg, 200000);
  });
  test('ingresos, egresos y retiros con concepto; nunca deja la caja en negativo', async () => {
    assert.equal((await api(cont, 'POST', '/api/v1/cash/movements', { type: 'ingreso', amountPyg: 50000, concept: 'Cambio aportado' })).json().expectedCashPyg, 250000);
    assert.equal((await api(cont, 'POST', '/api/v1/cash/movements', { type: 'egreso', amountPyg: 30000, concept: 'Compra de cinta en el mercado' })).json().expectedCashPyg, 220000);
    assert.equal((await api(cont, 'POST', '/api/v1/cash/movements', { type: 'retiro', amountPyg: 100000, concept: 'Retiro del dueño' })).json().expectedCashPyg, 120000);
    assert.equal((await api(cont, 'POST', '/api/v1/cash/movements', { type: 'egreso', amountPyg: 120001, concept: 'Demasiado' })).json().error.code, 'INSUFFICIENT_CASH');
    assert.equal((await api(cont, 'POST', '/api/v1/cash/movements', { type: 'egreso', amountPyg: 10, concept: 'ab' })).statusCode, 400, 'concepto obligatorio');
    assert.equal((await api(cont, 'POST', '/api/v1/cash/movements', { type: 'venta', amountPyg: 10, concept: 'abc' })).statusCode, 400, 'tipos reservados al sistema');
    await assert.rejects(app.pool.query('DELETE FROM cash_movements'), /append-only/); await assert.rejects(app.pool.query('UPDATE cash_movements SET amount_pyg = 1'), /append-only/);
  });
  test('arqueo y cierre: esperado vs contado, diferencia, y la caja vuelve a poder abrirse', async () => {
    const r = await api(cont, 'POST', '/api/v1/cash/close', { countedCashPyg: 118000, note: 'Faltan 2.000 por vuelto mal dado' });
    assert.equal(r.statusCode, 200); assert.deepEqual([r.json().expectedCashPyg, r.json().countedCashPyg, r.json().differencePyg], [120000, 118000, -2000]);
    assert.deepEqual((await api(cont, 'GET', '/api/v1/cash/current')).json(), { open: false });
    const d = (await api(cont, 'GET', `/api/v1/cash/sessions/${sid}`)).json();
    assert.equal(d.differencePyg, -2000); assert.equal(d.closedBy, 'Usuario Prueba'); assert.equal(d.movements.length, 4); assert.deepEqual(d.movements.map((m) => m.type), ['apertura', 'ingreso', 'egreso', 'retiro']);
    assert.equal((await api(cont, 'GET', '/api/v1/cash/sessions')).json().meta.total, 1);
    assert.equal((await api(cont, 'POST', '/api/v1/cash/open', { openingAmountPyg: 0 })).statusCode, 201, 'se puede abrir sin monto inicial');
    const acts = new Set((await app.pool.query('SELECT action FROM audit_logs')).rows.map((x) => x.action)); for (const a of ['cash.opened', 'cash.closed', 'cash.ingreso', 'cash.egreso', 'cash.retiro']) assert.ok(acts.has(a), a);
  });
});
