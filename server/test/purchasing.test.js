'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call } = require('./helpers');
const inv = require('../src/modules/inventory/service');

describe('proveedores, órdenes de compra, recepción y cuentas por pagar', () => {
  let app, admin, vend, cont, catId, sup, P = {};
  const api = (s, m, u, b) => call(app, s, m, u, b);
  const stock = async (pid) => (await api(admin, 'GET', `/api/v1/inventory/items/${pid}`)).json();
  const mkProduct = async (name) => {
    const r = await api(admin, 'POST', '/api/v1/products', { name, categoryId: catId, kind: 'raw_flower' });
    await api(admin, 'POST', '/api/v1/inventory/items', { productId: r.json().id, unit: 'tallo' }); return r.json().id;
  };
  const newPO = async (items, extra = {}) => { const r = await api(admin, 'POST', '/api/v1/purchase-orders', { supplierId: sup, items, ...extra }); assert.equal(r.statusCode, 201, r.body); return r.json(); };

  before(async () => {
    app = await makeApp();
    admin = await userWithRole(app, 'administrador', 'admin@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local'); cont = await userWithRole(app, 'contabilidad', 'c@test.local');
    catId = (await api(admin, 'POST', '/api/v1/categories', { name: 'Flores' })).json().id;
    P.rosa = await mkProduct('Rosa roja'); P.euc = await mkProduct('Eucalipto'); P.cinta = await mkProduct('Cinta');
    sup = (await api(admin, 'POST', '/api/v1/suppliers', { name: 'Flores del Sol', taxId: '80012345-6', phone: '0981 000 000', paymentTermsDays: 15 })).json().id;
  });
  after(async () => { await app.close_all(); });

  test('proveedores: alta, RUC único, edición, búsqueda y permisos', async () => {
    assert.equal((await api(admin, 'POST', '/api/v1/suppliers', { name: 'Otro', taxId: '80012345-6' })).statusCode, 409);
    assert.equal((await api(admin, 'POST', '/api/v1/suppliers', { name: '' })).statusCode, 400);
    assert.equal((await api(admin, 'POST', '/api/v1/suppliers', { name: 'X', email: 'no-es-email' })).statusCode, 400);
    const u = await api(admin, 'PATCH', `/api/v1/suppliers/${sup}`, { contactName: 'Marta', paymentTermsDays: 15 });
    assert.equal(u.json().contactName, 'Marta');
    assert.equal((await api(admin, 'GET', '/api/v1/suppliers?q=sol')).json().data.length, 1);
    assert.equal((await api(vend, 'GET', '/api/v1/suppliers')).statusCode, 403);
    assert.equal((await api(cont, 'GET', '/api/v1/suppliers')).statusCode, 200);
    assert.equal((await api(cont, 'POST', '/api/v1/suppliers', { name: 'Z' })).statusCode, 403);
  });

  test('orden de compra: validaciones (producto fuera de inventario, duplicados, cantidades, proveedor)', async () => {
    const noStock = (await api(admin, 'POST', '/api/v1/products', { name: 'No inventariado', categoryId: catId, kind: 'supply' })).json().id;
    const base = { supplierId: sup };
    assert.equal((await api(admin, 'POST', '/api/v1/purchase-orders', { ...base, items: [{ productId: noStock, qty: 1, unitCostPyg: 1 }] })).json().error.code, 'NOT_STOCKABLE');
    assert.equal((await api(admin, 'POST', '/api/v1/purchase-orders', { ...base, items: [{ productId: P.rosa, qty: 1, unitCostPyg: 1 }, { productId: P.rosa, qty: 2, unitCostPyg: 1 }] })).json().error.code, 'DUPLICATE_ITEM');
    for (const bad of [0, -3, 1.2345]) assert.equal((await api(admin, 'POST', '/api/v1/purchase-orders', { ...base, items: [{ productId: P.rosa, qty: bad, unitCostPyg: 1 }] })).statusCode >= 400, true);
    assert.equal((await api(admin, 'POST', '/api/v1/purchase-orders', { ...base, items: [{ productId: P.rosa, qty: 1, unitCostPyg: 12.5 }] })).statusCode, 400, 'costos solo enteros');
    assert.equal((await api(admin, 'POST', '/api/v1/purchase-orders', { supplierId: 99999, items: [{ productId: P.rosa, qty: 1, unitCostPyg: 1 }] })).json().error.code, 'UNKNOWN_SUPPLIER');
    assert.equal((await api(admin, 'POST', '/api/v1/purchase-orders', { ...base, items: [] })).statusCode, 400);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM purchase_orders')).rows[0].n, 0, 'nada a medias');
  });

  let po, itemRosa, itemEuc;
  test('flujo: borrador → edición → enviada; solo el borrador se edita; numeración correlativa', async () => {
    po = await newPO([{ productId: P.rosa, qty: 100, unitCostPyg: 1000 }, { productId: P.euc, qty: 50, unitCostPyg: 400 }], { notes: 'Pedido semanal' });
    assert.match(po.number, /^OC-\d{6}$/); assert.equal(po.status, 'borrador'); assert.equal(po.totalPyg, 120000);
    const ed = await api(admin, 'PUT', `/api/v1/purchase-orders/${po.id}`, { supplierId: sup, items: [{ productId: P.rosa, qty: 100, unitCostPyg: 1000 }, { productId: P.euc, qty: 50, unitCostPyg: 400 }, { productId: P.cinta, qty: 10, unitCostPyg: 5000 }] });
    assert.equal(ed.json().items.length, 3); assert.equal(ed.json().totalPyg, 170000);
    assert.equal((await newPO([{ productId: P.cinta, qty: 1, unitCostPyg: 1 }])).number, 'OC-000002');
    // no se puede recibir un borrador
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { items: [{ poItemId: ed.json().items[0].id, qty: 1 }] })).json().error.code, 'INVALID_STATE');
    const sent = await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/send`);
    assert.equal(sent.json().status, 'enviada');
    assert.equal((await api(admin, 'PUT', `/api/v1/purchase-orders/${po.id}`, { supplierId: sup, items: [{ productId: P.rosa, qty: 1, unitCostPyg: 1 }] })).json().error.code, 'NOT_EDITABLE');
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/send`)).statusCode, 409);
    po = sent.json(); itemRosa = po.items.find((i) => i.productId === P.rosa).id; itemEuc = po.items.find((i) => i.productId === P.euc).id;
  });

  test('permisos: ventas no ve compras; contabilidad ve pero no recibe ni crea', async () => {
    assert.equal((await api(vend, 'GET', '/api/v1/purchase-orders')).statusCode, 403);
    assert.equal((await api(cont, 'GET', '/api/v1/purchase-orders')).statusCode, 200);
    assert.equal((await api(cont, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { items: [{ poItemId: itemRosa, qty: 1 }] })).statusCode, 403);
    assert.equal((await api(cont, 'POST', '/api/v1/purchase-orders', { supplierId: sup, items: [{ productId: P.rosa, qty: 1, unitCostPyg: 1 }] })).statusCode, 403);
  });

  let payableId;
  test('recepción parcial: stock + lote + costo promedio + precio del proveedor + cuenta por pagar, todo junto', async () => {
    const r = await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { supplierInvoiceNo: '001-001-0000123', invoiceDate: '2026-10-01',
      items: [{ poItemId: itemRosa, qty: 60, unitCostPyg: 1100, expiresAt: '2099-01-10' }, { poItemId: itemEuc, qty: 50 }] });
    assert.equal(r.statusCode, 201, r.body);
    assert.match(r.json().number, /^RC-\d{6}$/); assert.equal(r.json().status, 'parcial');
    assert.equal(r.json().totalPyg, 60 * 1100 + 50 * 400);
    payableId = r.json().payableId; assert.ok(payableId);
    const rosa = await stock(P.rosa);
    assert.equal(rosa.onHand, 60); assert.equal(rosa.avgCostPyg, 1100); assert.equal(rosa.lots[0].expiresAt, '2099-01-10'); assert.equal(rosa.lots[0].supplier, 'Flores del Sol');
    assert.equal((await stock(P.euc)).onHand, 50);
    const d = (await api(admin, 'GET', `/api/v1/purchase-orders/${po.id}`)).json();
    assert.equal(d.status, 'parcial'); assert.equal(d.items.find((i) => i.id === itemRosa).qtyPending, 40); assert.equal(d.receipts.length, 1);
    const mv = (await api(admin, 'GET', `/api/v1/inventory/movements?productId=${P.rosa}`)).json().data[0];
    assert.equal(mv.type, 'compra'); assert.equal(mv.referenceType, 'purchase_receipt'); assert.equal(mv.qty, 60);
    // cuenta por pagar: vencimiento = fecha de factura + condición de pago (15 días)
    const pa = (await api(cont, 'GET', `/api/v1/payables/${payableId}`)).json();
    assert.equal(pa.totalPyg, 86000); assert.equal(pa.dueDate, '2026-10-16'); assert.equal(pa.invoiceNo, '001-001-0000123'); assert.equal(pa.supplier.name, 'Flores del Sol');
    // historial de precios del proveedor
    const h = (await api(admin, 'GET', `/api/v1/suppliers/${sup}/price-history?productId=${P.rosa}`)).json().data;
    assert.equal(h.length, 1); assert.equal(h[0].pricePyg, 1100);
    const sd = (await api(admin, 'GET', `/api/v1/suppliers/${sup}`)).json();
    assert.equal(sd.balancePyg, 86000); assert.equal(sd.products.find((p) => p.productId === P.rosa).lastPricePyg, 1100);
  });

  test('no se puede recibir más de lo pendiente ni líneas ajenas; nada cambia si falla', async () => {
    const before = await stock(P.rosa);
    const over = await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { items: [{ poItemId: itemRosa, qty: 40.001 }] });
    assert.equal(over.statusCode, 409); assert.equal(over.json().error.code, 'OVER_RECEIPT');
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { items: [{ poItemId: 999999, qty: 1 }] })).json().error.code, 'UNKNOWN_ITEM');
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { items: [{ poItemId: itemRosa, qty: 1 }, { poItemId: itemRosa, qty: 1 }] })).json().error.code, 'DUPLICATE_ITEM');
    assert.equal((await stock(P.rosa)).onHand, before.onHand);
  });

  test('recepción ATÓMICA: si una línea falla, no se guarda nada (ni stock, ni recibo, ni deuda)', async () => {
    const cinta = (await api(admin, 'GET', `/api/v1/purchase-orders/${po.id}`)).json().items.find((i) => i.productId === P.cinta).id;
    await app.pool.query('UPDATE products SET archived_at = now() WHERE id = $1', [P.cinta]);     // la 2ª línea (cinta) fallará dentro de la transacción
    const receiptsBefore = (await app.pool.query('SELECT count(*)::int AS n FROM purchase_receipts')).rows[0].n;
    const payBefore = (await app.pool.query('SELECT count(*)::int AS n FROM payables')).rows[0].n;
    const rosaBefore = (await stock(P.rosa)).onHand;
    const r = await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { items: [{ poItemId: itemRosa, qty: 10 }, { poItemId: cinta, qty: 5 }] });
    assert.equal(r.statusCode, 409);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM purchase_receipts')).rows[0].n, receiptsBefore);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM payables')).rows[0].n, payBefore);
    assert.equal((await stock(P.rosa)).onHand, rosaBefore);
    assert.equal((await api(admin, 'GET', `/api/v1/purchase-orders/${po.id}`)).json().items.find((i) => i.id === itemRosa).qtyReceived, 60);
    await app.pool.query('UPDATE products SET archived_at = NULL WHERE id = $1', [P.cinta]);
  });

  test('segunda recepción completa la orden → recibida; costo promedio ponderado entre compras', async () => {
    const d0 = (await api(admin, 'GET', `/api/v1/purchase-orders/${po.id}`)).json();
    const cinta = d0.items.find((i) => i.productId === P.cinta).id;
    const r = await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { dueDate: '2026-12-31', items: [{ poItemId: itemRosa, qty: 40, unitCostPyg: 1500 }, { poItemId: cinta, qty: 10 }] });
    assert.equal(r.statusCode, 201, r.body); assert.equal(r.json().status, 'recibida');
    const rosa = await stock(P.rosa);
    assert.equal(rosa.onHand, 100); assert.equal(rosa.avgCostPyg, Math.round((60 * 1100 + 40 * 1500) / 100));
    assert.equal((await api(admin, 'GET', `/api/v1/payables/${r.json().payableId}`)).json().dueDate, '2026-12-31');
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/receive`, { items: [{ poItemId: itemRosa, qty: 1 }] })).json().error.code, 'INVALID_STATE');
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${po.id}/cancel`)).statusCode, 409);
  });

  test('cancelar (sin recepciones) y cerrar una orden parcial', async () => {
    const o = await newPO([{ productId: P.euc, qty: 5, unitCostPyg: 100 }]);
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${o.id}/cancel`, { reason: 'Ya no hace falta' })).json().status, 'cancelada');
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${o.id}/send`)).statusCode, 409);
    const o2 = await newPO([{ productId: P.euc, qty: 10, unitCostPyg: 100 }]); await api(admin, 'POST', `/api/v1/purchase-orders/${o2.id}/send`);
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${o2.id}/close`)).statusCode, 409, 'solo se cierra una parcial');
    await api(admin, 'POST', `/api/v1/purchase-orders/${o2.id}/receive`, { items: [{ poItemId: o2.items[0].id, qty: 4 }] });
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${o2.id}/cancel`)).statusCode, 409, 'con recepciones ya no se cancela');
    assert.equal((await api(admin, 'POST', `/api/v1/purchase-orders/${o2.id}/close`)).json().status, 'recibida');
    assert.equal((await api(admin, 'GET', '/api/v1/purchase-orders?status=open')).json().data.every((x) => ['borrador', 'enviada', 'parcial'].includes(x.status)), true);
  });

  test('concurrencia: dos recepciones simultáneas de la misma línea no pueden exceder lo pedido', async () => {
    const o = await newPO([{ productId: P.euc, qty: 10, unitCostPyg: 100 }]); await api(admin, 'POST', `/api/v1/purchase-orders/${o.id}/send`);
    const stockBefore = (await stock(P.euc)).onHand;
    const res = await Promise.all([1, 2, 3].map(() => api(admin, 'POST', `/api/v1/purchase-orders/${o.id}/receive`, { items: [{ poItemId: o.items[0].id, qty: 6 }] })));
    assert.equal(res.filter((r) => r.statusCode === 201).length, 1); assert.equal(res.filter((r) => r.statusCode === 409).length, 2);
    assert.equal((await stock(P.euc)).onHand, stockBefore + 6);
  });

  test('cuentas por pagar: pagos parciales y totales, sobrepago bloqueado, estados vencido/pagado, permisos', async () => {
    assert.equal((await api(vend, 'GET', '/api/v1/payables')).statusCode, 403);
    assert.equal((await api(admin, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 86001, methodCode: 'efectivo' })).json().error.code, 'OVERPAYMENT');
    assert.equal((await api(admin, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 1000, methodCode: 'bitcoin' })).json().error.code, 'UNKNOWN_METHOD');
    assert.equal((await api(admin, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 10.5, methodCode: 'efectivo' })).statusCode, 400);
    const p1 = await api(cont, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 36000, methodCode: 'transferencia', reference: 'TRF 998877' });
    assert.equal(p1.statusCode, 201); assert.equal(p1.json().balancePyg, 50000); assert.equal(p1.json().status, 'partial');
    assert.equal((await api(vend, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 1, methodCode: 'efectivo' })).statusCode, 403);
    // vencida (due_date 2026-10-16 y hoy es posterior al correr la prueba en 2026-10-08? forzamos fecha pasada)
    await app.pool.query(`UPDATE payables SET due_date = CURRENT_DATE - 3 WHERE id = $1`, [payableId]);
    const od = (await api(admin, 'GET', '/api/v1/payables?status=overdue')).json();
    assert.equal(od.data.length, 1); assert.equal(od.data[0].status, 'overdue'); assert.equal(od.balancePyg, 50000);
    // el efectivo sale de la caja: sin caja abierta no se puede; con caja abierta queda como movimiento
    assert.equal((await api(admin, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 50000, methodCode: 'efectivo' })).json().error.code, 'CASH_CLOSED');
    await api(admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 30000 });
    assert.equal((await api(admin, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 50000, methodCode: 'efectivo' })).json().error.code, 'INSUFFICIENT_CASH', 'no se puede pagar más efectivo del que hay en caja');
    await api(admin, 'POST', '/api/v1/cash/movements', { type: 'ingreso', amountPyg: 70000, concept: 'Aporte para pagar proveedor' });
    const p2 = await api(admin, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 50000, methodCode: 'efectivo' });
    assert.equal(p2.json().status, 'paid');
    assert.equal((await api(admin, 'GET', '/api/v1/cash/current')).json().session.expectedCashPyg, 50000, '30.000 + 70.000 − 50.000');
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM payable_payments WHERE cash_movement_id IS NOT NULL`)).rows[0].n, 1);
    const pa = (await api(admin, 'GET', `/api/v1/payables/${payableId}`)).json();
    assert.equal(pa.status, 'paid'); assert.equal(pa.payments.length, 2); assert.equal(pa.balancePyg, 0);
    assert.equal((await api(admin, 'POST', `/api/v1/payables/${payableId}/payments`, { amountPyg: 1, methodCode: 'efectivo' })).json().error.code, 'OVERPAYMENT');
    await assert.rejects(app.pool.query('DELETE FROM payable_payments'), /append-only/);
    assert.equal((await api(admin, 'GET', '/api/v1/payment-methods')).json().data.some((m) => m.code === 'efectivo' && m.affectsCash), true);
  });

  test('proveedor: no se archiva con deuda u órdenes abiertas; sí cuando está limpio', async () => {
    const r = await api(admin, 'DELETE', `/api/v1/suppliers/${sup}`);
    assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'SUPPLIER_IN_USE');
    const clean = (await api(admin, 'POST', '/api/v1/suppliers', { name: 'Proveedor sin movimientos' })).json().id;
    assert.equal((await api(admin, 'DELETE', `/api/v1/suppliers/${clean}`)).statusCode, 200);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM suppliers WHERE id=$1', [clean])).rows[0].n, 1, 'archivado, no borrado');
    assert.equal((await api(admin, 'GET', '/api/v1/suppliers?archived=true')).json().data.length, 1);
    assert.equal((await api(admin, 'POST', '/api/v1/purchase-orders', { supplierId: clean, items: [{ productId: P.rosa, qty: 1, unitCostPyg: 1 }] })).json().error.code, 'UNKNOWN_SUPPLIER');
  });

  test('INTEGRIDAD tras todo el flujo de compras e inventario + auditoría completa', async () => {
    assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
    const acts = new Set((await app.pool.query('SELECT action FROM audit_logs')).rows.map((r) => r.action));
    for (const a of ['supplier.created', 'supplier.updated', 'supplier.archived', 'purchase_order.created', 'purchase_order.updated', 'purchase_order.sent', 'purchase_order.cancelled', 'purchase_order.closed', 'purchase.received', 'payable.payment']) assert.ok(acts.has(a), a);
    // todo ingreso de stock por compra tiene recibo, lote y movimiento enlazados
    const { rows } = await app.pool.query(`SELECT count(*)::int AS n FROM inventory_movements m WHERE m.type = 'compra' AND (m.reference_id IS NULL OR m.lot_id IS NULL)`);
    assert.equal(rows[0].n, 0);
    const dash = (await api(cont, 'GET', '/api/v1/dashboard/summary')).json();
    assert.ok(dash.purchasing && Number.isInteger(dash.purchasing.payable));
  });
});
