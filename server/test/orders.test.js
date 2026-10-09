'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call } = require('./helpers');
const { setupFlowers } = require('./fixtures');
const inv = require('../src/modules/inventory/service');

const FUTURE = '2099-06-01';
describe('pedidos: reserva de stock, producción, delivery y cierre a venta', () => {
  let app, admin, vend, flor, rep, cont, F, customer; const api = (s, m, u, b) => call(app, s, m, u, b);
  const lvl = async (pid) => (await api(admin, 'GET', `/api/v1/inventory/items/${pid}`)).json();
  const mk = async (over = {}, who = vend) => api(who, 'POST', '/api/v1/orders', { customerId: customer, items: [{ variantId: F.variantId, qty: 1 }], deliveryType: 'delivery', requestedDate: FUTURE,
    shipping: { name: 'María', phone: '0982 000 111', address: 'Av. Mcal. López 123', zone: 'Centro' }, deliveryFeePyg: 20000, status: 'pendiente', ...over });
  const confirm = (id, who = vend) => api(who, 'POST', `/api/v1/orders/${id}/confirm`);
  const detail = async (id) => (await api(admin, 'GET', `/api/v1/orders/${id}`)).json();
  const prodOf = async (oid) => (await detail(oid)).production[0].id;
  const runProduction = async (pid) => {
    assert.equal((await api(flor, 'POST', `/api/v1/production/${pid}/start`)).statusCode, 200);
    for (const c of ['materiales', 'flores', 'armado', 'envoltorio', 'tarjeta']) assert.equal((await api(flor, 'PUT', `/api/v1/production/${pid}/checklist/${c}`, { done: true })).statusCode, 200);
    assert.equal((await api(flor, 'POST', `/api/v1/production/${pid}/quality`)).statusCode, 200);
    const r = await api(flor, 'POST', `/api/v1/production/${pid}/approve`); assert.equal(r.statusCode, 200, r.body);
  };

  before(async () => {
    app = await makeApp();
    admin = await userWithRole(app, 'administrador', 'admin@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local'); flor = await userWithRole(app, 'florista', 'f@test.local');
    rep = await userWithRole(app, 'repartidor', 'r@test.local'); cont = await userWithRole(app, 'contabilidad', 'c@test.local');
    F = await setupFlowers(app, admin);
    customer = (await api(admin, 'POST', '/api/v1/customers', { name: 'Ana Gómez', phone: '0981 555 666' })).json().id;
    await api(admin, 'POST', '/api/v1/cash/open', { openingAmountPyg: 0 });
  });
  after(async () => { await app.close_all(); });

  test('crear pedido: precios del servidor, número, validaciones y SIN reservar todavía', async () => {
    assert.equal((await mk({ requestedDate: '2000-01-01' })).statusCode, 400);
    assert.equal((await mk({ customerId: undefined })).statusCode, 400, 'sin cliente no se puede pasar a pendiente');
    assert.equal((await mk({ items: [{ variantId: F.variantId, qty: 1, unitPricePyg: 1 }] })).statusCode, 400);
    const before = (await lvl(F.rosa)).onHand;
    const r = await mk(); assert.equal(r.statusCode, 201, r.body);
    assert.match(r.json().number, /^P-\d{6}$/); assert.equal(r.json().totalPyg, 270000);
    assert.equal((await lvl(F.rosa)).onHand, before);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM stock_reservations')).rows[0].n, 0);
  });

  test('confirmar RESERVA stock (físico intacto, disponible baja) y abre producción + entrega', async () => {
    const o = (await mk()).json(); const r = await confirm(o.id); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().status, 'confirmado');
    const l = await lvl(F.rosa); assert.equal(l.reserved, 12); assert.equal(l.available, l.onHand - 12);
    const d = await detail(o.id); assert.equal(d.production.length, 1); assert.equal(d.delivery.status, 'pendiente');
    assert.ok(d.reservations.find((x) => x.name === 'Rosa roja' && x.qty === 12));
    assert.equal((await confirm(o.id)).statusCode, 409, 'no se confirma dos veces');
    // limpieza para no contaminar: cancelar libera
    assert.equal((await api(vend, 'POST', `/api/v1/orders/${o.id}/cancel`, { reason: 'prueba' })).statusCode, 200);
    assert.equal((await lvl(F.rosa)).reserved, 0);
  });

  test('FLUJO COMPLETO: reserva → producción consume → delivery → entrega genera la venta con costo congelado', async () => {
    const o = (await mk()).json(); await confirm(o.id);
    assert.equal((await api(vend, 'POST', `/api/v1/orders/${o.id}/payments`, { methodCode: 'efectivo', amountPyg: 100000 })).statusCode, 201);
    const pid = await prodOf(o.id);
    // no se puede aprobar sin pasar por el checklist
    assert.equal((await api(flor, 'POST', `/api/v1/production/${pid}/approve`)).statusCode, 409);
    const rosaBefore = (await lvl(F.rosa)).onHand;
    await runProduction(pid);
    const l = await lvl(F.rosa); assert.equal(rosaBefore - l.onHand, 12); assert.equal(l.reserved, 0, 'la producción consume la reserva');
    const d = await detail(o.id); assert.equal(d.status, 'listo'); assert.equal(d.delivery.status, 'listo');
    // un repartidor solo opera lo suyo
    const del = d.delivery.id;
    assert.equal((await api(rep, 'POST', `/api/v1/deliveries/${del}/start`)).statusCode, 403);
    assert.equal((await api(vend, 'POST', `/api/v1/deliveries/${del}/assign`, { courierId: 1 })).statusCode, 403, 'ventas no asigna');
    const repId = (await app.pool.query(`SELECT id FROM users WHERE email='r@test.local'`)).rows[0].id;
    assert.equal((await api(admin, 'POST', `/api/v1/deliveries/${del}/assign`, { courierId: repId })).statusCode, 200);
    assert.equal((await api(admin, 'POST', `/api/v1/deliveries/${del}/assign`, { courierId: (await app.pool.query(`SELECT id FROM users WHERE email='c@test.local'`)).rows[0].id })).statusCode, 400, 'contabilidad no es repartidor');
    assert.equal((await api(rep, 'GET', '/api/v1/deliveries')).json().data.length, 1);
    assert.equal((await api(rep, 'GET', '/api/v1/orders')).statusCode, 403);
    assert.equal((await api(rep, 'POST', `/api/v1/deliveries/${del}/start`)).statusCode, 200);
    // saldo pendiente: no se cierra sin cobrar o sin vencimiento
    const bad = await api(rep, 'POST', `/api/v1/deliveries/${del}/deliver`, {}); assert.equal(bad.statusCode, 409); assert.equal(bad.json().error.code, 'BALANCE_PENDING');
    assert.equal((await api(vend, 'POST', `/api/v1/orders/${o.id}/payments`, { methodCode: 'efectivo', amountPyg: 170000 })).statusCode, 201);
    const ok = await api(rep, 'POST', `/api/v1/deliveries/${del}/deliver`, {}); assert.equal(ok.statusCode, 200, ok.body);
    const fin = await detail(o.id); assert.equal(fin.status, 'entregado'); assert.ok(fin.sale);
    const sale = (await api(admin, 'GET', `/api/v1/sales/${fin.sale.id}`)).json();
    assert.equal(sale.totalPyg, 270000); assert.equal(sale.paymentState, 'paid'); assert.equal(sale.items[0].costPyg, 29200); assert.equal(sale.items[0].costKnown, true);
    assert.equal(sale.payments.length, 2, 'los cobros del pedido pasan a la venta');
    assert.equal((await api(admin, 'POST', `/api/v1/deliveries/${del}/deliver`, {})).statusCode, 409, 'no se entrega dos veces');
    // el stock no se descuenta de nuevo al entregar
    assert.equal((await lvl(F.rosa)).onHand, rosaBefore - 12);
  });

  test('FALTANTE: no se confirma lo que no alcanza; el stock reservado no se puede vender en otro lado', async () => {
    const big = await mk({ items: [{ variantId: F.variantId, qty: 50 }] }); assert.equal(big.statusCode, 201);
    const r = await confirm(big.json().id); assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'INSUFFICIENT_STOCK');
    assert.equal((await detail(big.json().id)).status, 'pendiente');
    const d = (await api(vend, 'GET', '/api/v1/orders/demand')).json();
    assert.ok(d.data.some((x) => x.name === 'Rosa roja' && /solo hay/.test(x.message)), JSON.stringify(d));
    // reservar casi todo y verificar que una venta de mostrador respeta lo reservado
    const avail = Math.floor((await lvl(F.rosa)).available / 12);
    const hold = (await mk({ items: [{ variantId: F.variantId, qty: avail - 1 }], deliveryType: 'retiro', shipping: undefined })).json();
    assert.equal((await confirm(hold.id)).statusCode, 200);
    const s = await api(vend, 'POST', '/api/v1/sales', { items: [{ variantId: F.variantId, qty: 2 }], payments: [{ methodCode: 'efectivo', amountPyg: 500000 }] });
    assert.equal(s.statusCode, 409); assert.equal(s.json().error.code, 'INSUFFICIENT_STOCK');
    assert.equal((await api(vend, 'POST', `/api/v1/orders/${hold.id}/cancel`, { reason: 'liberar' })).statusCode, 200);
  });

  test('CANCELAR: antes de producir libera la reserva y reembolsa; tras producir exige decidir qué pasa con el material', async () => {
    const a = (await mk()).json(); await confirm(a.id); await api(vend, 'POST', `/api/v1/orders/${a.id}/payments`, { methodCode: 'efectivo', amountPyg: 50000 });
    assert.equal((await api(vend, 'POST', `/api/v1/orders/${a.id}/cancel`, { reason: 'x' })).statusCode, 400, 'motivo mínimo');
    const c = await api(vend, 'POST', `/api/v1/orders/${a.id}/cancel`, { reason: 'El cliente se arrepintió' }); assert.equal(c.statusCode, 200, c.body);
    const d = await detail(a.id); assert.equal(d.status, 'cancelado'); assert.equal(d.balancePyg, 0);
    const refunds = (await app.pool.query('SELECT sum(amount_pyg)::int AS s FROM sale_refunds WHERE order_id = $1', [a.id])).rows[0].s; assert.equal(refunds, 50000);
    assert.equal((await lvl(F.rosa)).reserved, 0);
    // tras producir
    const b = (await mk()).json(); await confirm(b.id); await runProduction(await prodOf(b.id));
    const before = (await lvl(F.rosa)).onHand;
    const nr = await api(vend, 'POST', `/api/v1/orders/${b.id}/cancel`, { reason: 'Cancelado por el cliente' }); assert.equal(nr.statusCode, 400, 'debe indicar restock');
    const ok = await api(vend, 'POST', `/api/v1/orders/${b.id}/cancel`, { reason: 'Cancelado por el cliente', restock: true }); assert.equal(ok.statusCode, 200, ok.body);
    assert.equal((await lvl(F.rosa)).onHand - before, 12, 'los insumos vuelven al stock');
    assert.equal((await api(vend, 'POST', `/api/v1/orders/${b.id}/cancel`, { reason: 'otra vez' })).statusCode, 409);
  });

  test('EDITAR: re-reserva y recalcula; bloqueado una vez iniciada la producción', async () => {
    const o = (await mk()).json(); await confirm(o.id);
    const e = await api(vend, 'PUT', `/api/v1/orders/${o.id}`, { items: [{ variantId: F.variantId, qty: 2 }] }); assert.equal(e.statusCode, 200, e.body);
    assert.equal((await lvl(F.rosa)).reserved, 24); assert.equal((await detail(o.id)).totalPyg, 520000);
    await api(flor, 'POST', `/api/v1/production/${(await detail(o.id)).production[0].id}/start`);
    assert.equal((await api(vend, 'PUT', `/api/v1/orders/${o.id}`, { items: [{ variantId: F.variantId, qty: 1 }] })).statusCode, 409);
  });

  test('pedido web público: validación, precios del servidor, cliente por teléfono, trampa anti-bot y sin filtrar datos', async () => {
    const body = { customer: { name: 'Lucía Web', phone: '0991 777 888' }, recipient: { name: 'Pedro', address: 'Calle 1', zone: 'Centro' }, requestedDate: FUTURE, items: [{ variantId: F.variantId, qty: 1 }], attribution: { source: 'instagram', campaign: 'madre' } };
    const r = await api(null, 'POST', '/api/v1/public/orders', body); assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(Object.keys(r.json()).sort(), ['number', 'totalPyg']); assert.equal(r.json().totalPyg, 250000);
    const o = (await app.pool.query('SELECT * FROM orders WHERE number = $1', [r.json().number])).rows[0];
    assert.equal(o.channel, 'web'); assert.equal(o.status, 'pendiente'); assert.equal(o.attribution_source, 'instagram');
    const again = await api(null, 'POST', '/api/v1/public/orders', body);
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM customers WHERE phone LIKE '%777 888%'`)).rows[0].n, 1, 'mismo teléfono = mismo cliente');
    assert.equal(again.statusCode, 201);
    for (const bad of [{ ...body, items: [{ variantId: F.variantId, qty: 1, unitPricePyg: 1 }] }, { ...body, website: 'http://spam' }, { ...body, requestedDate: '2000-01-01' }, { ...body, recipient: { name: 'x' } }, { ...body, items: [{ variantId: 999999, qty: 1 }] }])
      assert.ok((await api(null, 'POST', '/api/v1/public/orders', bad)).statusCode >= 400);
    assert.equal((await api(null, 'GET', '/api/v1/orders')).statusCode, 401);
  });

  test('permisos: ventas no produce, florista no crea pedidos, contabilidad no ve entregas', async () => {
    const o = (await mk()).json(); await confirm(o.id); const pid = await prodOf(o.id);
    assert.equal((await api(vend, 'POST', `/api/v1/production/${pid}/start`)).statusCode, 403);
    assert.equal((await api(flor, 'POST', '/api/v1/orders', {})).statusCode, 403);
    assert.equal((await api(cont, 'GET', '/api/v1/deliveries')).statusCode, 403);
    assert.equal((await api(vend, 'POST', '/api/v1/delivery-zones', { name: 'Z', feePyg: 1 })).statusCode, 403);
    assert.equal((await api(admin, 'POST', '/api/v1/delivery-zones', { name: 'Centro', feePyg: 15000 })).statusCode, 201);
    await api(vend, 'POST', `/api/v1/orders/${o.id}/cancel`, { reason: 'fin de prueba' });
  });

  test('CONCURRENCIA: dos pedidos compiten por el último stock → solo uno reserva', async () => {
    const left = Math.floor((await lvl(F.rosa)).available / 12);
    const ids = []; for (let i = 0; i < 3; i++) ids.push((await mk({ items: [{ variantId: F.variantId, qty: left }] })).json().id);
    const rs = await Promise.all(ids.map((id) => confirm(id)));
    assert.equal(rs.filter((r) => r.statusCode === 200).length, 1, rs.map((r) => r.statusCode).join());
    for (const id of ids) await api(vend, 'POST', `/api/v1/orders/${id}/cancel`, { reason: 'fin concurrencia' });
  });

  test('INVARIANTES: inventario íntegro, reservas = niveles, pagos y auditoría consistentes', async () => {
    assert.deepEqual(await inv.verifyIntegrity(app.pool), []);
    const bad = await app.pool.query(`SELECT l.product_id FROM inventory_levels l WHERE l.reserved <> COALESCE((SELECT sum(r.qty) FROM stock_reservations r WHERE r.product_id = l.product_id AND r.status = 'active'), 0)`);
    assert.equal(bad.rowCount, 0, 'reserved coincide con las reservas activas');
    const orphan = await app.pool.query(`SELECT 1 FROM payments WHERE sale_id IS NULL AND order_id IN (SELECT id FROM orders WHERE status = 'entregado')`);
    assert.equal(orphan.rowCount, 0, 'los cobros de pedidos entregados quedan ligados a su venta');
    assert.ok((await app.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'order.%'`)).rows[0].n > 5);
  });
});
