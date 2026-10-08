'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call } = require('./helpers');
const inv = require('../src/modules/inventory/service');
const { withTransaction } = require('../src/db/pool');

describe('inventario: stock por lotes, costo promedio, movimientos y merma', () => {
  let app, admin, florista, vend, catId; const P = {};
  const api = (s, m, u, b) => call(app, s, m, u, b);
  const onHand = async (pid) => (await api(admin, 'GET', `/api/v1/inventory/items/${pid}`)).json();
  const adjIn = (pid, q, cost, extra = {}) => api(admin, 'POST', '/api/v1/inventory/adjustments', { productId: pid, direction: 'in', qty: q, unitCostPyg: cost, reason: 'Carga inicial', ...extra });
  const adjOut = (pid, q, extra = {}) => api(admin, 'POST', '/api/v1/inventory/adjustments', { productId: pid, direction: 'out', qty: q, reason: 'Conteo físico', ...extra });
  const mk = async (name, kind = 'raw_flower') => {
    const r = await api(admin, 'POST', '/api/v1/products', { name, categoryId: catId, kind });
    assert.equal(r.statusCode, 201, r.body);
    const e = await api(admin, 'POST', '/api/v1/inventory/items', { productId: r.json().id, unit: 'tallo', minStock: 10 });
    assert.equal(e.statusCode, 201, e.body); return r.json().id;
  };
  before(async () => {
    app = await makeApp();
    admin = await userWithRole(app, 'administrador', 'admin@test.local'); florista = await userWithRole(app, 'florista', 'fl@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local');
    catId = (await api(admin, 'POST', '/api/v1/categories', { name: 'Flores' })).json().id;
    P.rosa = await mk('Rosa roja'); P.euc = await mk('Eucalipto'); P.dec = await mk('Gypsophila'); P.fifo = await mk('Lirio'); P.race = await mk('Cinta');
  });
  after(async () => { await app.close_all(); });

  test('insumos: se crean sin variantes ni precio, no se publican y no aparecen en la web', async () => {
    const p = (await api(admin, 'GET', `/api/v1/products/${P.rosa}`)).json();
    assert.equal(p.kind, 'raw_flower'); assert.equal(p.variants.length, 0); assert.equal(p.active, true);
    assert.equal((await app.inject('/api/v1/public/catalog')).json().productos.length, 0);
    assert.equal((await api(admin, 'POST', '/api/v1/products', { name: 'Ramo', categoryId: catId })).json().error.code, 'VARIANT_REQUIRED');
  });

  test('incorporar a inventario: duplicado → 409; producto fuera de inventario no admite movimientos', async () => {
    assert.equal((await api(admin, 'POST', '/api/v1/inventory/items', { productId: P.rosa })).json().error.code, 'ALREADY_STOCKABLE');
    const r = await api(admin, 'POST', '/api/v1/products', { name: 'Papel kraft', categoryId: catId, kind: 'supply' });
    assert.equal((await adjIn(r.json().id, 5, 100)).json().error.code, 'NOT_STOCKABLE');
    assert.equal((await api(admin, 'POST', '/api/v1/inventory/items', { productId: 999999 })).statusCode, 404);
  });

  test('ingreso: crea lote + movimiento; costo promedio ponderado entre ingresos', async () => {
    assert.equal((await adjIn(P.rosa, 100, 1000)).statusCode, 201);
    assert.equal((await onHand(P.rosa)).avgCostPyg, 1000);
    assert.equal((await adjIn(P.rosa, 100, 2000)).statusCode, 201);
    const i = await onHand(P.rosa);
    assert.equal(i.onHand, 200); assert.equal(i.avgCostPyg, 1500); assert.equal(i.valuePyg, 300000); assert.equal(i.lots.length, 2);
    const mv = (await api(admin, 'GET', `/api/v1/inventory/movements?productId=${P.rosa}`)).json().data;
    assert.equal(mv.length, 2); assert.ok(mv.every((m) => m.type === 'ajuste_positivo' && m.reason === 'Carga inicial' && m.user));
  });

  test('ajuste de ingreso sin costo: usa el promedio; sin promedio exige costo', async () => {
    assert.equal((await api(admin, 'POST', '/api/v1/inventory/adjustments', { productId: P.euc, direction: 'in', qty: 5, reason: 'Sin costo' })).json().error.code, 'COST_REQUIRED');
    assert.equal((await api(admin, 'POST', '/api/v1/inventory/adjustments', { productId: P.rosa, direction: 'in', qty: 10, reason: 'Hallazgo en conteo' })).statusCode, 201);
    assert.equal((await onHand(P.rosa)).avgCostPyg, 1500, 'el promedio no cambia');
    await adjOut(P.rosa, 10);
  });

  test('salida FEFO: primero el lote que vence antes; un movimiento por lote con su costo real', async () => {
    await adjIn(P.fifo, 10, 1000, { expiresAt: '2099-12-31' });
    await adjIn(P.fifo, 10, 3000, { expiresAt: '2099-01-15' });
    await adjIn(P.fifo, 10, 5000);                                    // sin vencimiento: sale último
    const r = await adjOut(P.fifo, 15);
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(r.json().movements.map((m) => [m.qty, m.unitCostPyg]), [[10, 3000], [5, 1000]]);
    assert.equal(r.json().totalCostPyg, 35000);
    const i = await onHand(P.fifo);
    assert.equal(i.onHand, 15); assert.deepEqual(i.lots.map((l) => l.qtyRemaining), [5, 10]);
  });

  test('stock insuficiente → 409 y NO cambia nada', async () => {
    const before = await onHand(P.fifo);
    const r = await adjOut(P.fifo, 16);
    assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'INSUFFICIENT_STOCK'); assert.equal(r.json().error.details.available, 15);
    assert.deepEqual((await onHand(P.fifo)).lots, before.lots);
    assert.equal((await api(admin, 'GET', `/api/v1/inventory/movements?productId=${P.fifo}&type=ajuste_negativo`)).json().data.length, 2, 'solo los 2 movimientos del FEFO anterior');
  });

  test('cantidades: solo > 0 con hasta 3 decimales; sin errores de punto flotante', async () => {
    for (const bad of [0, -1, 0.0001, 1.2345, '5', null, 1e10]) assert.equal((await adjIn(P.dec, bad, 100)).statusCode === 201, false, `qty ${bad}`);
    await adjIn(P.dec, 0.1, 1000); await adjIn(P.dec, 0.2, 1000);
    assert.equal((await onHand(P.dec)).onHand, 0.3);
    assert.equal((await adjOut(P.dec, 0.3)).statusCode, 201);
    const i = await onHand(P.dec); assert.equal(i.onHand, 0); assert.equal(i.status, 'out');
    assert.equal((await adjOut(P.dec, 0.001)).statusCode, 409);
  });

  test('el historial de movimientos es inmutable (la base lo impide) y las cantidades llevan signo', async () => {
    await assert.rejects(app.pool.query(`UPDATE inventory_movements SET qty = 1 WHERE id = (SELECT min(id) FROM inventory_movements)`), /append-only/);
    await assert.rejects(app.pool.query('DELETE FROM inventory_movements'), /append-only/);
    await assert.rejects(app.pool.query('TRUNCATE inventory_movements'), /append-only/);
    const m = (await api(admin, 'GET', `/api/v1/inventory/movements?productId=${P.fifo}`)).json().data;
    assert.ok(m.some((x) => x.qty < 0) && m.some((x) => x.qty > 0));
    assert.equal((await api(admin, 'GET', '/api/v1/inventory/movements?limit=2&page=2')).json().meta.limit, 2);
  });

  test('merma: motivo configurable, costo real por lote, movimiento tipo merma y reporte', async () => {
    const reasons = (await api(florista, 'GET', '/api/v1/waste-reasons')).json().data;
    assert.ok(reasons.length >= 8 && reasons.some((r) => r.code === 'flor_marchita'));
    const w = await api(florista, 'POST', '/api/v1/inventory/waste', { productId: P.rosa, qty: 20, reasonCode: 'flor_marchita', note: 'Calor del fin de semana' });
    assert.equal(w.statusCode, 201, w.body);
    assert.equal(w.json().costPyg, 20 * 1000, 'sale del lote más antiguo (1.000 Gs/u)');
    assert.equal((await onHand(P.rosa)).onHand, 180);
    const mv = (await api(admin, 'GET', `/api/v1/inventory/movements?type=merma`)).json().data;
    assert.equal(mv.length, 1); assert.equal(mv[0].referenceType, 'waste'); assert.equal(mv[0].qty, -20); assert.equal(mv[0].user, 'Usuario Prueba');
    await api(admin, 'POST', '/api/v1/inventory/waste', { productId: P.euc === 0 ? P.rosa : P.rosa, qty: 5, reasonCode: 'rotura' });
    const rep = (await api(admin, 'GET', '/api/v1/inventory/waste')).json();
    assert.equal(rep.meta.total, 2); assert.equal(rep.totalCostPyg, 20000 + 5000);
    assert.deepEqual(rep.byReason.map((r) => [r.reason, r.costPyg]), [['Flor marchita', 20000], ['Rotura', 5000]]);
    assert.equal(rep.byProduct[0].product, 'Rosa roja'); assert.equal(rep.byCategory[0].category, 'Flores');
    assert.equal((await api(admin, 'GET', '/api/v1/inventory/waste?reasonCode=rotura')).json().meta.total, 1);
  });

  test('merma: validaciones y permisos', async () => {
    assert.equal((await api(florista, 'POST', '/api/v1/inventory/waste', { productId: P.rosa, qty: 1, reasonCode: 'inexistente' })).json().error.code, 'UNKNOWN_REASON');
    assert.equal((await api(florista, 'POST', '/api/v1/inventory/waste', { productId: P.rosa, qty: 99999, reasonCode: 'otro' })).json().error.code, 'INSUFFICIENT_STOCK');
    assert.equal((await api(vend, 'POST', '/api/v1/inventory/waste', { productId: P.rosa, qty: 1, reasonCode: 'otro' })).statusCode, 403);
    assert.equal((await api(florista, 'POST', '/api/v1/inventory/adjustments', { productId: P.rosa, direction: 'out', qty: 1, reason: 'x y z' })).statusCode, 403, 'florista puede mermar pero no ajustar');
    assert.equal((await api(vend, 'GET', '/api/v1/inventory/items')).statusCode, 200);
    assert.equal((await api(vend, 'POST', '/api/v1/inventory/adjustments', { productId: P.rosa, direction: 'in', qty: 1, reason: 'abc', unitCostPyg: 1 })).statusCode, 403);
    const nr = await api(admin, 'POST', '/api/v1/waste-reasons', { name: 'Plaga / hongos' });
    assert.equal(nr.statusCode, 201); assert.equal(nr.json().code, 'plaga_hongos');
    assert.equal((await api(admin, 'POST', '/api/v1/inventory/waste', { productId: P.rosa, qty: 1, reasonCode: 'plaga_hongos' })).statusCode, 201);
    await api(admin, 'PATCH', `/api/v1/waste-reasons/${nr.json().id}`, { active: false });
    assert.equal((await api(admin, 'POST', '/api/v1/inventory/waste', { productId: P.rosa, qty: 1, reasonCode: 'plaga_hongos' })).json().error.code, 'UNKNOWN_REASON');
  });

  test('stock físico / reservado / disponible: lo reservado no se puede consumir (evita sobreventa)', async () => {
    await adjIn(P.race, 100, 500);
    await app.pool.query('UPDATE inventory_levels SET reserved = 60 WHERE product_id = $1', [P.race]);
    const i = await onHand(P.race);
    assert.deepEqual([i.onHand, i.reserved, i.available], [100, 60, 40]);
    assert.equal((await adjOut(P.race, 41)).json().error.code, 'INSUFFICIENT_STOCK');
    assert.equal((await adjOut(P.race, 40)).statusCode, 201);
    await assert.rejects(app.pool.query('UPDATE inventory_levels SET reserved = 61 WHERE product_id = $1', [P.race]), (e) => e.code === '23514', 'la base impide reservar más de lo físico');
    await app.pool.query('UPDATE inventory_levels SET reserved = 0 WHERE product_id = $1', [P.race]);
    // una salida que consume su propia reserva puede usar lo reservado
    await app.pool.query('UPDATE inventory_levels SET reserved = 60 WHERE product_id = $1', [P.race]);
    await assert.rejects(withTransaction(app.pool, (tx) => inv.consumeStock(tx, { productId: P.race, locationId: 1, qty: 61, type: 'produccion', useReserved: true })), (e) => e.code === 'RESERVATION_MISSING');
    await withTransaction(app.pool, (tx) => inv.consumeStock(tx, { productId: P.race, locationId: 1, qty: 60, type: 'produccion', useReserved: true }));
    const after = await onHand(P.race);
    assert.deepEqual([after.onHand, after.reserved], [0, 0], 'consumir la reserva la libera');
  });

  test('concurrencia: 8 salidas simultáneas de 3 sobre un stock de 10 → exactamente 3 pasan y no hay sobreventa', async () => {
    await adjIn(P.race, 10, 500);
    const res = await Promise.all(Array.from({ length: 8 }, () => adjOut(P.race, 3)));
    const ok = res.filter((r) => r.statusCode === 201).length;
    assert.equal(ok, 3); assert.equal(res.filter((r) => r.statusCode === 409).length, 5);
    assert.equal((await onHand(P.race)).onHand, 1);
  });

  test('alertas: agotado, bajo, exceso y lotes por vencer', async () => {
    await api(admin, 'PUT', `/api/v1/inventory/items/${P.euc}/settings`, { minStock: 10, maxStock: 50 });
    await adjIn(P.euc, 4, 800, { expiresAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });     // bajo + vence mañana
    await api(admin, 'PUT', `/api/v1/inventory/items/${P.rosa}/settings`, { minStock: 10, maxStock: 100 });      // 177 > 100 → exceso
    const a = (await api(vend, 'GET', '/api/v1/inventory/alerts')).json();
    assert.ok(a.out.some((x) => x.name === 'Gypsophila'));
    assert.ok(a.low.some((x) => x.name === 'Eucalipto'));
    assert.ok(a.excess.some((x) => x.name === 'Rosa roja'));
    assert.ok(a.expiring.some((x) => x.name === 'Eucalipto' && x.daysLeft === 1));
    assert.equal(a.counts.out, a.out.length);
    assert.equal((await api(admin, 'PUT', `/api/v1/inventory/items/${P.euc}/settings`, { minStock: 10, maxStock: 5 })).json().error.code, 'INVALID_LIMITS');
    assert.equal((await api(admin, 'GET', '/api/v1/inventory/items?status=low')).json().data.every((x) => x.status === 'low'), true);
    const list = (await api(admin, 'GET', '/api/v1/inventory/items')).json();
    assert.equal(list.totalValuePyg, list.data.reduce((a, x) => a + x.valuePyg, 0));
    assert.equal((await api(admin, 'GET', '/api/v1/inventory/items?sort=password')).statusCode, 400);
  });

  test('INTEGRIDAD: stock físico = Σ lotes = Σ movimientos, para todos los productos', async () => {
    assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
    // y la verificación detecta una corrupción forzada
    await app.pool.query('UPDATE inventory_lots SET qty_remaining = qty_remaining - 0.001 WHERE id = (SELECT min(id) FROM inventory_lots WHERE qty_remaining > 0)');
    assert.equal((await inv.verifyIntegrity(app.pool)).length, 1);
  });

  test('auditoría: ajustes, merma y cambios de configuración quedan registrados', async () => {
    const acts = new Set((await app.pool.query('SELECT action FROM audit_logs')).rows.map((r) => r.action));
    for (const a of ['inventory.item_enrolled', 'inventory.adjust_in', 'inventory.adjust_out', 'inventory.waste', 'inventory.settings_changed', 'waste_reason.created']) assert.ok(acts.has(a), a);
  });
});
