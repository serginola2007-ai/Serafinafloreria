'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, call } = require('./helpers');

describe('clientes, destinatarios y direcciones', () => {
  let app, admin, vend, flor, juan, maria;
  const api = (s, m, u, b) => call(app, s, m, u, b);
  before(async () => { app = await makeApp(); admin = await userWithRole(app, 'administrador', 'admin@test.local'); vend = await userWithRole(app, 'ventas', 'v@test.local'); flor = await userWithRole(app, 'florista', 'f@test.local'); });
  after(async () => { await app.close_all(); });

  test('permisos: ventas gestiona clientes; florista no ve; exportar solo con permiso', async () => {
    assert.equal((await api(flor, 'GET', '/api/v1/customers')).statusCode, 403);
    assert.equal((await api(vend, 'GET', '/api/v1/customers')).statusCode, 200);
    assert.equal((await api(vend, 'GET', '/api/v1/customers/export.csv')).statusCode, 403, 'ventas no exporta');
    assert.equal((await api(vend, 'DELETE', '/api/v1/customers/1')).statusCode, 403, 'ventas no archiva clientes');
    assert.equal((await app.inject('/api/v1/customers')).statusCode, 401);
  });

  test('alta, validación y búsqueda por nombre/teléfono/RUC', async () => {
    assert.equal((await api(vend, 'POST', '/api/v1/customers', { name: '' })).statusCode, 400);
    assert.equal((await api(vend, 'POST', '/api/v1/customers', { name: 'X', email: 'no' })).statusCode, 400);
    assert.equal((await api(vend, 'POST', '/api/v1/customers', { name: 'X', kind: 'vip' })).statusCode, 400);
    const r = await api(vend, 'POST', '/api/v1/customers', { name: 'Juan Pérez', phone: '0981 111 222', email: 'juan@example.com', taxId: '1234567-8', preferences: 'Le gustan las rosas rojas' });
    assert.equal(r.statusCode, 201); juan = r.json().id;
    await api(vend, 'POST', '/api/v1/customers', { name: '=HYPERLINK("http://evil")', kind: 'empresa' });
    assert.equal((await api(vend, 'GET', '/api/v1/customers?q=0981')).json().data.length, 1);
    assert.equal((await api(vend, 'GET', '/api/v1/customers?q=1234567')).json().data[0].name, 'Juan Pérez');
    assert.equal((await api(vend, 'GET', '/api/v1/customers?kind=empresa')).json().data.length, 1);
    assert.equal((await api(vend, 'GET', "/api/v1/customers?q=%25_'--")).statusCode, 200);
    assert.equal((await api(vend, 'GET', '/api/v1/customers?sort=password')).statusCode, 400);
    const u = await api(vend, 'PATCH', `/api/v1/customers/${juan}`, { notes: 'Cliente frecuente' });
    assert.equal(u.json().notes, 'Cliente frecuente');
  });

  test('cliente y destinatario son personas distintas e independientes', async () => {
    const r = await api(vend, 'POST', '/api/v1/recipients', { name: 'María González', phone: '0982 333 444', address: 'Villa Morra, Av. Mcal. López 1234', zone: 'Villa Morra', customerId: juan });
    assert.equal(r.statusCode, 201); maria = r.json().id;
    assert.equal(r.json().name, 'María González'); assert.equal(r.json().customerId, juan);
    const c = (await api(vend, 'GET', `/api/v1/customers/${juan}`)).json();
    assert.equal(c.name, 'Juan Pérez'); assert.deepEqual(c.recipients.map((x) => x.name), ['María González']);
    // un destinatario existe sin cliente asociado y se puede reutilizar
    const solo = await api(vend, 'POST', '/api/v1/recipients', { name: 'Ana Gómez', address: 'Luque' });
    assert.equal(solo.json().customerId, null);
    assert.equal((await api(vend, 'GET', '/api/v1/recipients?q=gonz')).json().data.length, 1);
    assert.equal((await api(vend, 'GET', `/api/v1/recipients?customerId=${juan}`)).json().data.length, 1);
    assert.equal((await api(vend, 'POST', '/api/v1/recipients', { name: 'Z', customerId: 99999 })).statusCode, 404);
    // editar al destinatario no toca al cliente
    await api(vend, 'PATCH', `/api/v1/recipients/${maria}`, { phone: '0983 000 000' });
    assert.equal((await api(vend, 'GET', `/api/v1/customers/${juan}`)).json().phone, '0981 111 222');
  });

  test('direcciones: una sola por defecto, edición y baja lógica', async () => {
    const a1 = (await api(vend, 'POST', `/api/v1/customers/${juan}/addresses`, { label: 'Casa', address: 'Av. España 100', isDefault: true })).json();
    const a2 = (await api(vend, 'POST', `/api/v1/customers/${juan}/addresses`, { label: 'Oficina', address: 'Palma 500', zone: 'Centro', isDefault: true })).json();
    let c = (await api(vend, 'GET', `/api/v1/customers/${juan}`)).json();
    assert.equal(c.addresses.filter((a) => a.isDefault).length, 1); assert.equal(c.addresses.find((a) => a.isDefault).id, a2.id);
    await api(vend, 'PATCH', `/api/v1/customer-addresses/${a1.id}`, { reference: 'Portón verde' });
    assert.equal((await api(vend, 'DELETE', `/api/v1/customer-addresses/${a2.id}`)).statusCode, 200);
    c = (await api(vend, 'GET', `/api/v1/customers/${juan}`)).json();
    assert.deepEqual(c.addresses.map((a) => a.id), [a1.id]); assert.equal(c.addresses[0].reference, 'Portón verde');
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM customer_addresses')).rows[0].n, 2, 'archivada, no borrada');
    assert.equal((await api(vend, 'POST', `/api/v1/customers/99999/addresses`, { address: 'x' })).statusCode, 404);
  });

  test('fechas importantes: validación de calendario y próximas fechas', async () => {
    assert.equal((await api(vend, 'POST', `/api/v1/customers/${juan}/dates`, { label: 'Aniversario', month: 2, day: 30 })).json().error.code, 'INVALID_DATE');
    assert.equal((await api(vend, 'POST', `/api/v1/customers/${juan}/dates`, { label: 'X', month: 13, day: 1 })).statusCode, 400);
    const t = new Date(Date.now() + 5 * 86400000);
    const d = await api(vend, 'POST', `/api/v1/customers/${juan}/dates`, { label: 'Cumpleaños de su esposa', month: t.getMonth() + 1, day: t.getDate() });
    assert.equal(d.statusCode, 201);
    await api(vend, 'POST', `/api/v1/customers/${juan}/dates`, { label: 'Lejano', month: ((t.getMonth() + 6) % 12) + 1, day: 10 });
    const up = (await api(vend, 'GET', '/api/v1/customers/upcoming-dates?days=15')).json().data;
    assert.equal(up.length, 1); assert.equal(up[0].label, 'Cumpleaños de su esposa'); assert.equal(up[0].customer, 'Juan Pérez');
    assert.equal((await api(vend, 'DELETE', `/api/v1/customer-dates/${d.json().id}`)).statusCode, 200);
  });

  test('exportación CSV: con permiso, auditada y protegida contra inyección de fórmulas', async () => {
    const r = await api(admin, 'GET', '/api/v1/customers/export.csv');
    assert.equal(r.statusCode, 200); assert.match(r.headers['content-type'], /text\/csv/); assert.match(r.headers['content-disposition'], /clientes\.csv/);
    assert.match(r.body, /Juan Pérez/); assert.doesNotMatch(r.body, /,=HYPERLINK/); assert.match(r.body, /'=HYPERLINK/);
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'customers.exported'`)).rows[0].n, 1);
  });

  test('archivar cliente: baja lógica; con saldo pendiente no se puede', async () => {
    await app.pool.query(`INSERT INTO sales(number, customer_id, subtotal_pyg, total_pyg, paid_pyg, credit_due_date) VALUES ('T-1', $1, 100000, 100000, 20000, CURRENT_DATE + 5)`, [juan]);
    const r = await api(admin, 'DELETE', `/api/v1/customers/${juan}`);
    assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'CUSTOMER_HAS_BALANCE'); assert.equal(r.json().error.details.balancePyg, 80000);
    const c = (await api(admin, 'GET', `/api/v1/customers/${juan}`)).json();
    assert.equal(c.totalSpentPyg, 100000); assert.equal(c.purchases, 1); assert.equal(c.averageTicketPyg, 100000); assert.equal(c.balancePyg, 80000);
    const other = (await api(admin, 'POST', '/api/v1/customers', { name: 'Sin movimientos' })).json().id;
    assert.equal((await api(admin, 'DELETE', `/api/v1/customers/${other}`)).statusCode, 200);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM customers WHERE id=$1', [other])).rows[0].n, 1);
    assert.equal((await api(admin, 'GET', '/api/v1/customers?archived=true')).json().data.length, 1);
    assert.equal((await api(admin, 'PATCH', `/api/v1/customers/${other}`, { name: 'x' })).statusCode, 404);
  });
});
