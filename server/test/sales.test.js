'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, createUser, login, call } = require('./helpers');
const { setupFlowers } = require('./fixtures');
const inv = require('../src/modules/inventory/service');

describe('ventas / POS: stock por receta, costo congelado, pagos, caja y crédito', () => {
  let app, admin, vend, cont, noDisc, F, customer; const api = (s, m, u, b) => call(app, s, m, u, b);
  const level = async (pid) => (await api(admin, 'GET', `/api/v1/inventory/items/${pid}`)).json();
  const snapshot = async () => ({ rosa: (await level(F.rosa)).onHand, euc: (await level(F.euc)).onHand, papel: (await level(F.papel)).onHand,
    sales: (await app.pool.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, pays: (await app.pool.query('SELECT count(*)::int AS n FROM payments')).rows[0].n, cm: (await app.pool.query('SELECT count(*)::int AS n FROM cash_movements')).rows[0].n });
  const sale = (s, b) => api(s, 'POST', '/api/v1/sales', b);
  const cashNow = async () => (await api(admin, 'GET', '/api/v1/cash/current')).json();

  before(async () => {
    app = await makeApp();
    admin = await userWithRole(app, 'administrador', 'admin@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local'); cont = await userWithRole(app, 'contabilidad', 'c@test.local');
    await createUser(app, { email: 'nd@test.local', role: 'personalizado' }); const nd = await login(app, 'nd@test.local');
    const uid = (await app.pool.query(`SELECT id FROM users WHERE email='nd@test.local'`)).rows[0].id;
    await api(admin, 'PUT', `/api/v1/users/${uid}/permissions`, { allow: ['ventas.create', 'ventas.view'], deny: [] }); noDisc = nd;
    F = await setupFlowers(app, admin);
    customer = (await api(admin, 'POST', '/api/v1/customers', { name: 'Juan Pérez', phone: '0981 111 222' })).json().id;
  });
  after(async () => { await app.close_all(); });

  test('POS: catálogo vendible con disponibilidad real (cuántos ramos se pueden armar)', async () => {
    const r = (await api(vend, 'GET', '/api/v1/pos/catalog')).json().data;
    assert.equal(r.length, 1); assert.equal(r[0].name, 'Bouquet Romántico'); assert.equal(r[0].pricePyg, 250000);
    assert.deepEqual(r[0].availability, { type: 'recipe', qty: 8 });
    assert.equal((await api(vend, 'GET', '/api/v1/pos/catalog?q=zzz')).json().data.length, 0);
    assert.equal((await api(cont, 'GET', '/api/v1/pos/catalog')).statusCode, 403, 'contabilidad no vende');
  });

  test('sin caja abierta no se puede cobrar en efectivo, y no queda NADA a medias', async () => {
    const before = await snapshot();
    const r = await sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], payments: [{ methodCode: 'efectivo', amountPyg: 250000 }] });
    assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'CASH_CLOSED');
    assert.deepEqual(await snapshot(), before);
  });

  test('los precios los pone el servidor: el cliente no puede enviar precio ni costo', async () => {
    for (const extra of [{ unitPricePyg: 1 }, { pricePyg: 1 }, { costPyg: 0 }]) assert.equal((await sale(vend, { items: [{ variantId: F.variantId, qty: 1, ...extra }], payments: [] })).statusCode, 400);
    assert.equal((await sale(vend, { items: [{ variantId: F.variantId, qty: 0 }] })).statusCode, 400);
    assert.equal((await sale(vend, { items: [{ variantId: F.variantId, qty: 1.5 }] })).statusCode, 400);
    assert.equal((await sale(vend, { items: [{ variantId: 999999, qty: 1 }], customerId: customer, creditDueDate: '2099-01-01' })).json().error.code, 'UNKNOWN_VARIANT');
  });

  test('VENTA COMPLETA: descuenta los componentes de la receta, congela costo/margen, cobra y mueve la caja', async () => {
    await api(admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 100000 });
    const before = await snapshot();
    const r = await sale(vend, { customerId: customer, channel: 'mostrador', items: [{ variantId: F.variantId, qty: 2 }], payments: [{ methodCode: 'efectivo', amountPyg: 500000 }], notes: 'Para el viernes' });
    assert.equal(r.statusCode, 201, r.body);
    assert.match(r.json().number, /^V-\d{6}$/); assert.equal(r.json().totalPyg, 500000); assert.equal(r.json().balancePyg, 0);
    // stock: 2 ramos × (12 rosas, 3 eucaliptos, 1 papel…)
    const after = await snapshot();
    assert.equal(before.rosa - after.rosa, 24); assert.equal(before.euc - after.euc, 6); assert.equal(before.papel - after.papel, 2);
    const mv = (await api(admin, 'GET', `/api/v1/inventory/movements?productId=${F.rosa}&type=venta`)).json().data;
    assert.equal(mv.length, 1); assert.equal(mv[0].qty, -24); assert.equal(mv[0].referenceType, 'sale'); assert.match(mv[0].reason, /^Venta V-/);
    // detalle: costo REAL congelado = 2 × 29.200 y margen
    const d = (await api(admin, 'GET', `/api/v1/sales/${r.json().id}`)).json();
    assert.equal(d.items[0].qty, 2); assert.equal(d.items[0].unitPricePyg, 250000); assert.equal(d.items[0].costPyg, 58400); assert.equal(d.items[0].costKnown, true);
    assert.equal(d.items[0].marginPyg, 500000 - 58400); assert.equal(d.costPyg, 58400); assert.equal(d.marginPyg, 441600);
    assert.equal(d.customer.name, 'Juan Pérez'); assert.equal(d.paymentState, 'paid'); assert.equal(d.payments.length, 1); assert.equal(d.status, 'confirmada');
    // caja: +500.000 de venta; esperado = 100.000 + 500.000
    const c = await cashNow(); assert.equal(c.session.expectedCashPyg, 600000);
    assert.deepEqual(c.movementsByType.map((m) => [m.type, m.totalPyg]), [['apertura', 100000], ['venta', 500000]]);
    assert.equal(c.salesByMethod.find((m) => m.code === 'efectivo').totalPyg, 500000);
    // un solo registro por pago, ligado al movimiento de caja
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM payments WHERE cash_movement_id IS NOT NULL')).rows[0].n, 1);
    assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
  });

  test('el costo congelado NO cambia aunque después cambien los precios de compra', async () => {
    await api(admin, 'POST', '/api/v1/inventory/adjustments', { productId: F.rosa, direction: 'in', qty: 50, unitCostPyg: 9000, reason: 'Compra a precio alto' });
    const list = (await api(admin, 'GET', '/api/v1/sales')).json().data; const d = (await api(admin, 'GET', `/api/v1/sales/${list[0].id}`)).json();
    assert.equal(d.items[0].costPyg, 58400);
  });

  test('stock insuficiente: informa qué falta, y no cambia ni stock, ni ventas, ni caja', async () => {
    const before = await snapshot();
    const r = await sale(vend, { items: [{ variantId: F.variantId, qty: 100 }], payments: [{ methodCode: 'efectivo', amountPyg: 25000000 }] });
    assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'INSUFFICIENT_STOCK');
    const sh = r.json().error.details.shortages; assert.ok(sh.some((s) => s.name === 'Eucalipto' && s.required === 300)); assert.match(r.json().error.message, /Stock insuficiente/);
    assert.deepEqual(await snapshot(), before);
  });

  test('pago con tarjeta/transferencia: no toca la caja; pagos mixtos suman; sobrepago rechazado', async () => {
    const cm0 = (await snapshot()).cm;
    const r = await sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], payments: [{ methodCode: 'transferencia', amountPyg: 150000, reference: 'TRF 1' }, { methodCode: 'tarjeta', amountPyg: 100000 }] });
    assert.equal(r.statusCode, 201, r.body); assert.equal((await snapshot()).cm, cm0, 'sin efectivo → sin movimiento de caja');
    assert.equal((await sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], payments: [{ methodCode: 'tarjeta', amountPyg: 250001 }] })).json().error.code, 'OVERPAYMENT');
    assert.equal((await sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], payments: [{ methodCode: 'bitcoin', amountPyg: 1 }] })).json().error.code, 'UNKNOWN_METHOD');
    const d = (await api(admin, 'GET', `/api/v1/sales/${r.json().id}`)).json(); assert.deepEqual(d.payments.map((p) => p.amountPyg), [150000, 100000]);
    const c = await cashNow(); assert.equal(c.salesByMethod.find((m) => m.code === 'tarjeta').totalPyg, 100000);
  });

  test('descuentos: requieren permiso, no superan el subtotal y quedan en la venta', async () => {
    const body = { items: [{ variantId: F.variantId, qty: 1, discountPyg: 10000 }], payments: [{ methodCode: 'tarjeta', amountPyg: 240000 }] };
    assert.equal((await sale(noDisc, body)).json().error.code, 'DISCOUNT_FORBIDDEN');
    assert.equal((await sale(vend, { ...body, items: [{ variantId: F.variantId, qty: 1, discountPyg: 250001 }] })).json().error.code, 'DISCOUNT_TOO_HIGH');
    assert.equal((await sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], discountPyg: 300000 })).json().error.code, 'DISCOUNT_TOO_HIGH');
    const r = await sale(vend, { ...body, discountPyg: 5000, deliveryFeePyg: 20000, payments: [{ methodCode: 'tarjeta', amountPyg: 255000 }] });
    assert.equal(r.statusCode, 201, r.body); const d = (await api(admin, 'GET', `/api/v1/sales/${r.json().id}`)).json();
    assert.equal(d.subtotalPyg, 250000); assert.equal(d.discountPyg, 15000); assert.equal(d.deliveryFeePyg, 20000); assert.equal(d.totalPyg, 255000); assert.equal(d.items[0].totalPyg, 240000);
    assert.equal((await app.pool.query('SELECT 1 FROM sales WHERE total_pyg <> subtotal_pyg - discount_pyg + delivery_fee_pyg')).rowCount, 0);
  });

  test('crédito: exige cliente y vencimiento; el saldo es cuenta por cobrar; cobros parciales y totales', async () => {
    const items = [{ variantId: F.variantId, qty: 1 }];
    assert.equal((await sale(vend, { items, payments: [{ methodCode: 'efectivo', amountPyg: 50000 }] })).json().error.code, 'CREDIT_REQUIRES_CUSTOMER');
    assert.equal((await sale(vend, { items, customerId: customer, payments: [] })).json().error.code, 'CREDIT_DUE_REQUIRED');
    const r = await sale(vend, { items, customerId: customer, creditDueDate: '2020-01-15', payments: [{ methodCode: 'efectivo', amountPyg: 50000 }] });
    assert.equal(r.statusCode, 201, r.body); assert.equal(r.json().balancePyg, 200000);
    const rc = (await api(vend, 'GET', '/api/v1/receivables')).json(); assert.equal(rc.data.length, 1); assert.equal(rc.data[0].status, 'overdue'); assert.equal(rc.balancePyg, 200000); assert.equal(rc.overduePyg, 200000);
    const sid = r.json().id;
    assert.equal((await api(vend, 'POST', `/api/v1/sales/${sid}/payments`, { methodCode: 'efectivo', amountPyg: 200001 })).json().error.code, 'OVERPAYMENT');
    const cm = (await snapshot()).cm;
    assert.equal((await api(vend, 'POST', `/api/v1/sales/${sid}/payments`, { methodCode: 'efectivo', amountPyg: 80000 })).json().balancePyg, 120000);
    assert.equal((await snapshot()).cm, cm + 1, 'el cobro en efectivo entra a la caja');
    assert.equal((await api(vend, 'POST', `/api/v1/sales/${sid}/payments`, { methodCode: 'transferencia', amountPyg: 120000 })).json().balancePyg, 0);
    assert.equal((await api(vend, 'GET', '/api/v1/receivables')).json().data.length, 0);
    assert.equal((await api(admin, 'GET', `/api/v1/sales/${sid}`)).json().paymentState, 'paid');
    assert.equal((await api(cont, 'GET', '/api/v1/receivables')).statusCode, 200);
  });

  test('cliente: totales, ticket promedio y saldo salen de las ventas reales', async () => {
    const c = (await api(admin, 'GET', `/api/v1/customers/${customer}`)).json();
    assert.equal(c.purchases, 2); assert.equal(c.totalSpentPyg, 500000 + 250000); assert.equal(c.averageTicketPyg, 375000); assert.equal(c.balancePyg, 0); assert.equal(c.recentSales.length, 2);
  });

  test('anulación: repone stock al costo original, devuelve el dinero (contra-asientos) y deja todo auditado', async () => {
    const r = await sale(vend, { customerId: customer, items: [{ variantId: F.variantId, qty: 1 }], payments: [{ methodCode: 'efectivo', amountPyg: 100000 }, { methodCode: 'tarjeta', amountPyg: 150000 }] });
    const sid = r.json().id; const before = await snapshot(); const exp0 = (await cashNow()).session.expectedCashPyg;
    assert.equal((await api(noDisc, 'POST', `/api/v1/sales/${sid}/void`, { reason: 'Error de carga' })).statusCode, 403, 'sin ventas.cancel');
    assert.equal((await api(vend, 'POST', `/api/v1/sales/${sid}/void`, { reason: 'x' })).statusCode, 400, 'motivo obligatorio');
    const v = await api(vend, 'POST', `/api/v1/sales/${sid}/void`, { reason: 'El cliente se arrepintió' });
    assert.equal(v.statusCode, 200, v.body); assert.equal(v.json().refundedPyg, 250000);
    const after = await snapshot();
    assert.equal(after.rosa - before.rosa, 12); assert.equal(after.euc - before.euc, 3); assert.equal(after.papel - before.papel, 1);
    assert.equal((await cashNow()).session.expectedCashPyg, exp0 - 100000, 'solo el efectivo sale del cajón');
    const d = (await api(admin, 'GET', `/api/v1/sales/${sid}`)).json(); assert.equal(d.status, 'anulada'); assert.equal(d.voidReason, 'El cliente se arrepintió'); assert.equal(d.refunds.length, 2); assert.equal(d.balancePyg, 0);
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM inventory_movements WHERE type = 'devolucion' AND reference_type = 'sale_void' AND reference_id = $1`, [sid])).rows[0].n, 5);
    assert.equal((await api(vend, 'POST', `/api/v1/sales/${sid}/void`, { reason: 'otra vez' })).json().error.code, 'ALREADY_VOIDED');
    assert.equal((await api(vend, 'POST', `/api/v1/sales/${sid}/payments`, { methodCode: 'efectivo', amountPyg: 1 })).json().error.code, 'SALE_VOIDED');
    assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
    assert.equal((await api(admin, 'GET', `/api/v1/customers/${customer}`)).json().purchases, 2, 'la venta anulada no cuenta');
  });

  test('anular con la caja cerrada (venta en efectivo) falla completo y no deja nada a medias', async () => {
    const r = await sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], payments: [{ methodCode: 'efectivo', amountPyg: 250000 }] });
    const exp = (await cashNow()).session.expectedCashPyg;
    await api(admin, 'POST', '/api/v1/cash/close', { countedCashPyg: exp });
    const before = await snapshot();
    const v = await api(vend, 'POST', `/api/v1/sales/${r.json().id}/void`, { reason: 'Prueba caja cerrada' });
    assert.equal(v.statusCode, 409); assert.equal(v.json().error.code, 'CASH_CLOSED');
    assert.deepEqual(await snapshot(), before); assert.equal((await api(admin, 'GET', `/api/v1/sales/${r.json().id}`)).json().status, 'confirmada');
    await api(admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 600000 });
    assert.equal((await api(vend, 'POST', `/api/v1/sales/${r.json().id}/void`, { reason: 'Ahora con caja abierta' })).statusCode, 200);
  });

  test('producto no disponible para la venta (borrador, archivado o variante inactiva) → 409', async () => {
    await api(admin, 'PATCH', `/api/v1/products/${F.productId}`, { active: false });
    assert.equal((await sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], payments: [] , customerId: customer, creditDueDate: '2099-01-01' })).json().error.code, 'NOT_SELLABLE');
    assert.equal((await api(vend, 'GET', '/api/v1/pos/catalog')).json().data.length, 0);
    await api(admin, 'PATCH', `/api/v1/products/${F.productId}`, { active: true });
  });

  test('sin receta ni stock propio la venta se registra pero el costo queda como "desconocido" (no se inventa margen)', async () => {
    const p = (await api(admin, 'POST', '/api/v1/products', { name: 'Servicio de decoración', categoryId: F.cat, variants: [{ label: 'Único', pricePyg: 100000 }], mediaIds: [F.img], publish: true })).json();
    const r = await sale(vend, { items: [{ variantId: p.variants[0].id, qty: 1 }], payments: [{ methodCode: 'tarjeta', amountPyg: 100000 }] });
    assert.equal(r.statusCode, 201, r.body);
    const d = (await api(admin, 'GET', `/api/v1/sales/${r.json().id}`)).json(); assert.equal(d.items[0].costKnown, false); assert.equal(d.items[0].marginPyg, null); assert.equal(d.marginPyg, null); assert.equal(d.costComplete, false);
  });

  test('desactivar la receta: el producto ya no descuenta componentes (y se marca costo desconocido)', async () => {
    const before = await snapshot();
    await api(admin, 'PUT', `/api/v1/variants/${F.variantId}/recipe`, { enabled: false, components: [{ productId: F.rosa, qty: 12 }, { productId: F.euc, qty: 3 }, { productId: F.papel, qty: 1 }, { productId: F.cinta, qty: 1 }, { productId: F.tarjeta, qty: 1 }], extras: [{ concept: 'Mano de obra', amountPyg: 15000 }] });
    const r = await sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], payments: [{ methodCode: 'tarjeta', amountPyg: 250000 }] }); assert.equal(r.statusCode, 201);
    assert.equal((await snapshot()).rosa, before.rosa, 'no descontó rosas'); assert.equal((await api(admin, 'GET', `/api/v1/sales/${r.json().id}`)).json().items[0].costKnown, false);
    await api(admin, 'PUT', `/api/v1/variants/${F.variantId}/recipe`, { enabled: true, components: [{ productId: F.rosa, qty: 12 }, { productId: F.euc, qty: 3 }, { productId: F.papel, qty: 1 }, { productId: F.cinta, qty: 1 }, { productId: F.tarjeta, qty: 1 }], extras: [{ concept: 'Mano de obra', amountPyg: 15000 }] });
  });

  test('CONCURRENCIA: 6 ventas simultáneas compitiendo por el último ramo → solo una pasa, sin stock negativo', async () => {
    // dejar stock para exactamente 1 ramo
    const lv = async (pid) => (await level(pid)).onHand;
    for (const [pid, keep] of [[F.rosa, 12], [F.euc, 3], [F.papel, 1], [F.cinta, 1], [F.tarjeta, 1]]) { const cur = await lv(pid); if (cur > keep) await api(admin, 'POST', '/api/v1/inventory/adjustments', { productId: pid, direction: 'out', qty: cur - keep, reason: 'Preparar prueba de concurrencia' }); }
    const res = await Promise.all(Array.from({ length: 6 }, () => sale(vend, { items: [{ variantId: F.variantId, qty: 1 }], payments: [{ methodCode: 'tarjeta', amountPyg: 250000 }] })));
    assert.equal(res.filter((r) => r.statusCode === 201).length, 1, res.map((r) => r.statusCode).join(','));
    assert.equal(res.filter((r) => r.statusCode === 409).length, 5);
    assert.equal(await lv(F.rosa), 0); assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
    const numbers = (await app.pool.query('SELECT number FROM sales ORDER BY id')).rows.map((r) => r.number); assert.equal(new Set(numbers).size, numbers.length, 'numeración sin duplicados');
  });

  test('listados y filtros; costo/margen solo se ven con permiso financiero', async () => {
    const all = (await api(vend, 'GET', '/api/v1/sales')).json();
    assert.ok(all.summary.salesCount >= 6); assert.equal(all.summary.averageTicketPyg, Math.round(all.summary.totalPyg / all.summary.salesCount));
    assert.equal((await api(vend, 'GET', '/api/v1/sales?status=anulada')).json().data.every((s) => s.status === 'anulada'), true);
    assert.equal((await api(vend, 'GET', `/api/v1/sales?customerId=${customer}`)).json().data.every((s) => s.customer.id === customer), true);
    assert.equal((await api(vend, 'GET', '/api/v1/sales?payment=credit')).json().data.length, 0);
    assert.equal((await api(vend, 'GET', `/api/v1/sales?q=${all.data[0].number}`)).json().data.length, 1);
    assert.equal((await api(vend, 'GET', '/api/v1/sales?sort=x;DROP')).statusCode, 200, 'parámetros desconocidos se ignoran');
    const sid = all.data.find((s) => s.status === 'confirmada').id;
    const asSeller = (await api(vend, 'GET', `/api/v1/sales/${sid}`)).json(); assert.equal('costPyg' in asSeller, false); assert.equal('costPyg' in asSeller.items[0], false);
    const asAcc = (await api(cont, 'GET', `/api/v1/sales/${sid}`)).json(); assert.equal(typeof asAcc.costPyg, 'number');
    assert.equal((await api(noDisc, 'POST', '/api/v1/sales/1/void', { reason: 'abc' })).statusCode, 403);
  });

  test('INVARIANTES finales: pagos = pagado, caja = movimientos, auditoría completa, dashboard real', async () => {
    const bad = await app.pool.query(`SELECT s.id FROM sales s WHERE s.paid_pyg <> COALESCE((SELECT sum(amount_pyg) FROM payments p WHERE p.sale_id = s.id), 0)`);
    assert.equal(bad.rowCount, 0, 'paid_pyg == Σ payments en todas las ventas');
    const cashBad = await app.pool.query(`SELECT p.id FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE m.affects_cash AND p.cash_movement_id IS NULL`);
    assert.equal(cashBad.rowCount, 0, 'todo pago en efectivo tiene su movimiento de caja');
    assert.equal((await app.pool.query(`SELECT 1 FROM sale_items WHERE cost_known AND cost_total_pyg = 0`)).rowCount, 0);
    const acts = new Set((await app.pool.query('SELECT action FROM audit_logs')).rows.map((r) => r.action)); for (const a of ['sale.confirmed', 'sale.voided', 'sale.payment_added', 'cash.opened', 'cash.closed']) assert.ok(acts.has(a), a);
    await assert.rejects(app.pool.query('UPDATE payments SET amount_pyg = 1'), /append-only/); await assert.rejects(app.pool.query('DELETE FROM sale_refunds'), /append-only/);
    const dash = (await api(admin, 'GET', '/api/v1/dashboard/summary')).json();
    assert.ok(dash.sales.today_count >= 6); assert.equal(dash.cash.open, true); assert.ok(dash.sales.today_total > 0);
    assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
  });
});
