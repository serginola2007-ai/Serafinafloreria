'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, createUser, login, call } = require('./helpers');
const { setupFlowers } = require('./fixtures');

const future = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
describe('eventos y cotizaciones', () => {
  let app, admin, vend, flor, F, cust; const api = (s, m, u, b) => call(app, s, m, u, b);
  const quote = (b, s = admin) => api(s, 'POST', '/api/v1/quotations', { customerId: cust, items: [{ variantId: F.variantId, qty: 2 }], validUntil: future(7), ...b });
  const detail = async (id) => (await api(admin, 'GET', `/api/v1/quotations/${id}`)).json();

  before(async () => {
    app = await makeApp();
    admin = await userWithRole(app, 'administrador', 'a@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local'); flor = await userWithRole(app, 'florista', 'f@test.local');
    F = await setupFlowers(app, admin); cust = (await api(admin, 'POST', '/api/v1/customers', { name: 'Empresa Eventos SA', phone: '021 555 000' })).json().id;
  });
  after(async () => { await app.close_all(); });

  test('evento: alta, edición, estados y permisos', async () => {
    const rep = await userWithRole(app, 'repartidor', 'r@test.local'); assert.equal((await api(rep, 'GET', '/api/v1/events')).statusCode, 403);
    assert.equal((await api(admin, 'POST', '/api/v1/events', { name: 'Boda', customerId: 99999 })).statusCode, 400);
    const e = await api(vend, 'POST', '/api/v1/events', { name: 'Boda Gómez', type: 'casamiento', customerId: cust, eventDate: future(60), venue: 'Quinta Los Pinos', guests: 120 }); assert.equal(e.statusCode, 201, e.body);
    assert.match(e.json().number, /^E-\d{6}$/);
    assert.equal((await api(vend, 'PATCH', `/api/v1/events/${e.json().id}`, { status: 'confirmado' })).statusCode, 200);
    assert.equal((await api(vend, 'PATCH', `/api/v1/events/${e.json().id}`, { status: 'inventado' })).statusCode, 400);
    const d = (await api(vend, 'GET', `/api/v1/events/${e.json().id}`)).json(); assert.equal(d.status, 'confirmado'); assert.equal(d.guests, 120);
  });

  test('cotización: precios del catálogo los fija el servidor; ítems libres con precio manual; descuentos con permiso', async () => {
    assert.equal((await quote({ items: [{ variantId: F.variantId, qty: 1, unitPricePyg: 1 }] })).statusCode, 400);
    assert.equal((await quote({ items: [{ description: 'Montaje', qty: 1 }] })).statusCode, 400, 'libre sin precio');
    const r = await quote({ items: [{ variantId: F.variantId, qty: 2 }, { description: 'Montaje y desmontaje', qty: 1, unitPricePyg: 300000 }] }); assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().totalPyg, 800000); assert.match(r.json().number, /^C-\d{6}$/);
    const noDisc = await createUser(app, { email: 'nd@test.local', role: 'personalizado' }); void noDisc;
    const nd = await login(app, 'nd@test.local'); const uid = (await app.pool.query(`SELECT id FROM users WHERE email='nd@test.local'`)).rows[0].id;
    await api(admin, 'PUT', `/api/v1/users/${uid}/permissions`, { allow: ['eventos.view', 'eventos.create', 'eventos.edit'], deny: [] });
    const dd = await quote({ items: [{ variantId: F.variantId, qty: 1, discountPyg: 10000 }] }, nd); assert.equal(dd.statusCode, 403);
    assert.equal((await quote({ items: [{ variantId: F.variantId, qty: 1, discountPyg: 10000 }] })).statusCode, 201);
    assert.equal((await quote({ items: [{ variantId: F.variantId, qty: 1, discountPyg: 999999 }] })).statusCode, 400);
  });

  test('flujo: borrador → enviada → aceptada; editar solo en borrador; vencida no se acepta', async () => {
    const q = (await quote()).json();
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${q.id}/accept`)).statusCode, 409, 'no se acepta un borrador');
    assert.equal((await quote({ validUntil: null })).statusCode, 201);
    const noValid = (await quote({ validUntil: null })).json(); assert.equal((await api(admin, 'POST', `/api/v1/quotations/${noValid.id}/send`)).json().error.code, 'VALIDITY_REQUIRED');
    assert.equal((await api(admin, 'PUT', `/api/v1/quotations/${q.id}`, { items: [{ variantId: F.variantId, qty: 3 }] })).statusCode, 200);
    assert.equal((await detail(q.id)).totalPyg, 750000);
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${q.id}/send`)).statusCode, 200);
    assert.equal((await api(admin, 'PUT', `/api/v1/quotations/${q.id}`, { items: [{ variantId: F.variantId, qty: 1 }] })).statusCode, 409);
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${q.id}/accept`)).statusCode, 200);
    assert.equal((await detail(q.id)).status, 'aceptada');
    // vencida
    const v = (await quote()).json(); await api(admin, 'POST', `/api/v1/quotations/${v.id}/send`);
    await app.pool.query(`UPDATE quotations SET valid_until = CURRENT_DATE - 1 WHERE id = $1`, [v.id]);
    assert.equal((await detail(v.id)).expired, true);
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${v.id}/accept`)).json().error.code, 'QUOTATION_EXPIRED');
    // rechazo con motivo
    const r = (await quote()).json(); assert.equal((await api(admin, 'POST', `/api/v1/quotations/${r.id}/reject`, {})).statusCode, 400);
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${r.id}/reject`, { reason: 'Presupuesto fuera de rango' })).statusCode, 200);
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${r.id}/send`)).statusCode, 409);
  });

  test('conversión a pedido: solo aceptadas y sin ítems libres; conserva descuento; no se convierte dos veces', async () => {
    const free = (await quote({ items: [{ variantId: F.variantId, qty: 1 }, { description: 'Decoración', qty: 1, unitPricePyg: 100000 }] })).json();
    await api(admin, 'POST', `/api/v1/quotations/${free.id}/send`); await api(admin, 'POST', `/api/v1/quotations/${free.id}/accept`);
    const body = { requestedDate: future(10), deliveryType: 'retiro' };
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${free.id}/convert`, body)).json().error.code, 'FREE_ITEMS');
    const q = (await quote({ items: [{ variantId: F.variantId, qty: 2, discountPyg: 20000 }] })).json();
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${q.id}/convert`, body)).statusCode, 409, 'borrador no se convierte');
    await api(admin, 'POST', `/api/v1/quotations/${q.id}/send`); await api(admin, 'POST', `/api/v1/quotations/${q.id}/accept`);
    assert.equal((await api(flor, 'POST', `/api/v1/quotations/${q.id}/convert`, body)).statusCode, 403);
    const c = await api(admin, 'POST', `/api/v1/quotations/${q.id}/convert`, body); assert.equal(c.statusCode, 201, c.body);
    assert.equal(c.json().totalPyg, 480000, '2 × 250.000 − 20.000');
    const o = (await api(admin, 'GET', `/api/v1/orders/${c.json().orderId}`)).json(); assert.equal(o.status, 'pendiente'); assert.equal(o.channel, 'evento'); assert.equal(o.discountPyg, 20000);
    const d = await detail(q.id); assert.equal(d.status, 'convertida'); assert.equal(d.order.number, o.number);
    assert.equal((await api(admin, 'POST', `/api/v1/quotations/${q.id}/convert`, body)).statusCode, 409);
  });

  test('auditoría de cada paso e integridad de totales', async () => {
    assert.ok((await app.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'quotation.%'`)).rows[0].n >= 8);
    const bad = await app.pool.query(`SELECT q.id FROM quotations q WHERE q.total_pyg <> (SELECT COALESCE(sum(line_total_pyg),0) FROM quotation_items i WHERE i.quotation_id = q.id)`); assert.equal(bad.rowCount, 0);
  });
});
