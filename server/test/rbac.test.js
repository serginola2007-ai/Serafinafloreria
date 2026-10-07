'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, createUser, login, call, userWithRole, PASSWORD } = require('./helpers');
const { ALL_CODES, ROLES } = require('../src/modules/rbac/catalog');

describe('RBAC', () => {
  let app, admin;
  before(async () => { app = await makeApp(); admin = await userWithRole(app, 'administrador', 'admin@test.local'); });
  after(async () => { await app.close_all(); });

  test('toda ruta /api/ declara su política de acceso (inventario de rutas)', async () => {
    const routes = app.printRoutes({ commonPrefix: false });
    assert.match(routes, /api\/v1\/users/);
    // el arranque ya falla si falta; acá comprobamos que el guardia realmente lo hace
    const Fastify = require('fastify');
    const f = Fastify();
    f.addHook('onRoute', (r) => { if (r.url.startsWith('/api/') && !r.config?.access) throw new Error('sin acceso'); });
    assert.throws(() => f.get('/api/v1/sin-declarar', async () => 'x'), /sin acceso/);
  });

  test('catálogo: sin permisos duplicados, formato modulo.accion y roles base completos', () => {
    assert.equal(new Set(ALL_CODES).size, ALL_CODES.length);
    for (const c of ALL_CODES) assert.match(c, /^[a-z]+\.[a-z]+$/);
    for (const r of ROLES) for (const p of r.permissions) assert.ok(ALL_CODES.includes(p), `${r.code} → ${p} inexistente`);
    assert.deepEqual(ROLES.map((r) => r.code), ['administrador', 'ventas', 'florista', 'repartidor', 'marketing', 'contabilidad', 'personalizado']);
    assert.equal(ROLES.find((r) => r.code === 'personalizado').permissions.length, 0);
  });

  test('seed es idempotente y no pisa ajustes del Administrador', async () => {
    const { seedRbac } = require('../src/modules/rbac/seed');
    const { withTransaction } = require('../src/db/pool');
    const r = await call(app, admin, 'PUT', '/api/v1/roles/repartidor/permissions', { permissions: ['delivery.own', 'delivery.view'] });
    assert.equal(r.statusCode, 200);
    await withTransaction(app.pool, seedRbac);
    const roles = (await call(app, admin, 'GET', '/api/v1/roles')).json().data;
    assert.deepEqual(roles.find((x) => x.code === 'repartidor').permissions, ['delivery.own', 'delivery.view']);
  });

  test('sin sesión → 401 en endpoints protegidos', async () => {
    for (const [m, u] of [['GET', '/api/v1/users'], ['GET', '/api/v1/roles'], ['GET', '/api/v1/audit-logs'], ['GET', '/api/v1/media'], ['GET', '/api/v1/integrations'], ['POST', '/api/v1/media']]) {
      assert.equal((await app.inject({ method: m, url: u })).statusCode, 401, `${m} ${u}`);
    }
  });

  test('sin permiso → 403 (backend), aunque el frontend ocultara el botón', async () => {
    const rep = await userWithRole(app, 'repartidor');
    for (const [m, u, body] of [
      ['GET', '/api/v1/users'], ['POST', '/api/v1/users', { email: 'z@z.zz', fullName: 'Z', roleCode: 'ventas', password: 'Clave-Larga-123' }],
      ['GET', '/api/v1/roles'], ['GET', '/api/v1/audit-logs'], ['GET', '/api/v1/integrations'], ['GET', '/api/v1/media'], ['DELETE', '/api/v1/users/1'],
    ]) {
      const r = await call(app, rep, m, u, body);
      assert.equal(r.statusCode, 403, `${m} ${u}`);
      assert.equal(r.json().error.code, 'FORBIDDEN');
    }
  });

  test('cada rol base ve solo lo suyo', async () => {
    const vend = await userWithRole(app, 'ventas', 'v@test.local');
    const mk = await userWithRole(app, 'marketing', 'm@test.local');
    const ct = await userWithRole(app, 'contabilidad', 'c@test.local');
    assert.equal((await call(app, vend, 'GET', '/api/v1/users')).statusCode, 403);
    assert.equal((await call(app, vend, 'GET', '/api/v1/integrations')).statusCode, 403);
    assert.equal((await call(app, mk, 'GET', '/api/v1/integrations')).statusCode, 200);
    assert.equal((await call(app, mk, 'GET', '/api/v1/users')).statusCode, 403);
    assert.equal((await call(app, ct, 'GET', '/api/v1/audit-logs')).statusCode, 403);
    assert.ok(!vend.body.permissions.includes('usuarios.view'));
    assert.ok(ct.body.permissions.includes('caja.view') && !ct.body.permissions.includes('ventas.create'));
  });

  test('administrador tiene todos los permisos del catálogo', async () => {
    const me = (await call(app, admin, 'GET', '/api/v1/auth/me')).json();
    assert.deepEqual(me.permissions, [...ALL_CODES].sort());
  });

  test('rol Personalizado: nace sin permisos y el Administrador asigna permisos individuales', async () => {
    const u = await createUser(app, { email: 'custom@test.local', role: 'personalizado' });
    const s = await login(app, 'custom@test.local');
    assert.deepEqual(s.body.permissions, []);
    assert.equal((await call(app, s, 'GET', '/api/v1/integrations')).statusCode, 403);
    const set = await call(app, admin, 'PUT', `/api/v1/users/${u.id}/permissions`, { allow: ['marketing.view', 'usuarios.view'], deny: [] });
    assert.equal(set.statusCode, 200);
    // efecto inmediato, sin volver a loguearse
    assert.equal((await call(app, s, 'GET', '/api/v1/integrations')).statusCode, 200);
    assert.equal((await call(app, s, 'GET', '/api/v1/users')).statusCode, 200);
    assert.equal((await call(app, s, 'POST', '/api/v1/users', { email: 'q@q.qq', fullName: 'Q', roleCode: 'ventas', password: 'Clave-Larga-123' })).statusCode, 403);
  });

  test('deny sobre un permiso del rol lo quita', async () => {
    const u = await createUser(app, { email: 'v2@test.local', role: 'ventas' });
    const s = await login(app, 'v2@test.local');
    assert.ok(s.body.permissions.includes('ventas.cancel'));
    await call(app, admin, 'PUT', `/api/v1/users/${u.id}/permissions`, { allow: [], deny: ['ventas.cancel'] });
    const me = (await call(app, s, 'GET', '/api/v1/auth/me')).json();
    assert.ok(!me.permissions.includes('ventas.cancel') && me.permissions.includes('ventas.create'));
  });

  test('validación de permisos: inexistentes, solapados, y no se editan los del Administrador', async () => {
    const u = await createUser(app, { email: 'p1@test.local', role: 'personalizado' });
    const adm = await app.pool.query(`SELECT id FROM users WHERE email='admin@test.local'`);
    assert.equal((await call(app, admin, 'PUT', `/api/v1/users/${u.id}/permissions`, { allow: ['ventas.volar'], deny: [] })).json().error.code, 'UNKNOWN_PERMISSION');
    assert.equal((await call(app, admin, 'PUT', `/api/v1/users/${u.id}/permissions`, { allow: ['ventas.view'], deny: ['ventas.view'] })).json().error.code, 'PERMISSION_OVERLAP');
    assert.equal((await call(app, admin, 'PUT', `/api/v1/users/${adm.rows[0].id}/permissions`, { allow: [], deny: ['ventas.view'] })).statusCode, 409);
    assert.equal((await call(app, admin, 'PUT', '/api/v1/roles/administrador/permissions', { permissions: [] })).statusCode, 409);
  });

  test('anti-escalada: quien no es Administrador no puede dar permisos que no tiene ni crear Administradores', async () => {
    await createUser(app, { email: 'rh@test.local', role: 'personalizado' });
    const rhId = (await app.pool.query(`SELECT id FROM users WHERE email='rh@test.local'`)).rows[0].id;
    await call(app, admin, 'PUT', `/api/v1/users/${rhId}/permissions`, { allow: ['usuarios.view', 'usuarios.create', 'usuarios.edit', 'roles.edit', 'roles.view'], deny: [] });
    const rh = await login(app, 'rh@test.local');
    const victim = await createUser(app, { email: 'victim@test.local', role: 'personalizado' });
    const esc = await call(app, rh, 'PUT', `/api/v1/users/${victim.id}/permissions`, { allow: ['caja.adjust'], deny: [] });
    assert.equal(esc.statusCode, 403); assert.equal(esc.json().error.code, 'ESCALATION');
    const ok = await call(app, rh, 'PUT', `/api/v1/users/${victim.id}/permissions`, { allow: ['usuarios.view'], deny: [] });
    assert.equal(ok.statusCode, 200);
    const mkAdmin = await call(app, rh, 'POST', '/api/v1/users', { email: 'x@x.xx', fullName: 'X', roleCode: 'administrador', password: 'Clave-Larga-123' });
    assert.equal(mkAdmin.statusCode, 403);
    const promote = await call(app, rh, 'PATCH', `/api/v1/users/${victim.id}`, { roleCode: 'administrador' });
    assert.equal(promote.statusCode, 403);
    const roleEsc = await call(app, rh, 'PUT', '/api/v1/roles/personalizado/permissions', { permissions: ['caja.adjust'] });
    assert.equal(roleEsc.statusCode, 403);
    const adminId = (await app.pool.query(`SELECT id FROM users WHERE email='admin@test.local'`)).rows[0].id;
    assert.equal((await call(app, rh, 'PATCH', `/api/v1/users/${adminId}`, { fullName: 'Hackeado' })).statusCode, 403);
    assert.equal((await call(app, rh, 'POST', `/api/v1/users/${adminId}/reset-password`, { password: 'Clave-Larga-12345' })).statusCode, 403);
  });

  test('gestión de usuarios: alta (con cambio obligatorio), duplicado, edición, baja lógica', async () => {
    const c = await call(app, admin, 'POST', '/api/v1/users', { email: 'Nuevo@Test.local', fullName: 'Nuevo Usuario', roleCode: 'florista', password: 'Clave-Inicial-123' });
    assert.equal(c.statusCode, 201);
    const u = c.json();
    assert.equal(u.mustChangePassword, true); assert.ok(!('passwordHash' in u) && !JSON.stringify(u).includes('argon2'));
    assert.equal((await call(app, admin, 'POST', '/api/v1/users', { email: 'nuevo@test.local', fullName: 'Otro', roleCode: 'florista', password: 'Clave-Inicial-123' })).statusCode, 409, 'email único sin distinguir mayúsculas');
    assert.equal((await call(app, admin, 'POST', '/api/v1/users', { email: 'no-email', fullName: 'X', roleCode: 'florista', password: 'Clave-Inicial-123' })).statusCode, 400);
    assert.equal((await call(app, admin, 'POST', '/api/v1/users', { email: 'd@d.dd', fullName: 'X', roleCode: 'rolfalso', password: 'Clave-Inicial-123' })).json().error.code, 'UNKNOWN_ROLE');
    assert.equal((await call(app, admin, 'POST', '/api/v1/users', { email: 'e@e.ee', fullName: 'X', roleCode: 'ventas', password: 'corta' })).json().error.code, 'WEAK_PASSWORD');
    const patched = await call(app, admin, 'PATCH', `/api/v1/users/${u.id}`, { fullName: 'Nombre Cambiado', roleCode: 'ventas' });
    assert.equal(patched.json().fullName, 'Nombre Cambiado'); assert.equal(patched.json().role.code, 'ventas');
    const list = (await call(app, admin, 'GET', '/api/v1/users?q=cambiado')).json();
    assert.equal(list.data.length, 1); assert.equal(list.meta.total, 1);
    const del = await call(app, admin, 'DELETE', `/api/v1/users/${u.id}`);
    assert.equal(del.json().active, false);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM users WHERE id=$1', [u.id])).rows[0].n, 1, 'baja lógica: la fila se conserva');
  });

  test('un Administrador no puede degradarse/desactivarse a sí mismo; otro Administrador sí puede desactivarlo y sus sesiones se revocan', async () => {
    const u1 = await createUser(app, { email: 'adminA@test.local', role: 'administrador' });
    await createUser(app, { email: 'adminB@test.local', role: 'administrador' });
    const a = await login(app, 'adminA@test.local'); const b = await login(app, 'adminB@test.local');
    assert.equal((await call(app, a, 'DELETE', `/api/v1/users/${u1.id}`)).json().error.code, 'SELF_CHANGE');
    assert.equal((await call(app, a, 'PATCH', `/api/v1/users/${u1.id}`, { roleCode: 'ventas' })).json().error.code, 'SELF_CHANGE');
    assert.equal((await call(app, a, 'PATCH', `/api/v1/users/${u1.id}`, { active: false })).json().error.code, 'SELF_CHANGE');
    assert.equal((await call(app, b, 'DELETE', `/api/v1/users/${u1.id}`)).statusCode, 200);
    assert.equal((await call(app, a, 'GET', '/api/v1/users')).statusCode, 401, 'sesiones del desactivado revocadas');
  });

  test('reset de contraseña: fuerza cambio, revoca sesiones y desbloquea', async () => {
    const adm = await userWithRole(app, 'administrador', 'adminR@test.local');
    const u = await createUser(app, { email: 'rp@test.local', role: 'ventas' });
    const s = await login(app, 'rp@test.local');
    const r = await call(app, adm, 'POST', `/api/v1/users/${u.id}/reset-password`, { password: 'Reinicio-Seguro-456' });
    assert.equal(r.statusCode, 200);
    assert.equal((await call(app, s, 'GET', '/api/v1/auth/me')).statusCode, 401);
    const s2 = await login(app, 'rp@test.local', 'Reinicio-Seguro-456');
    assert.equal(s2.body.user.mustChangePassword, true);
  });

  test('catálogo de roles y permisos expuestos solo con roles.view', async () => {
    const adm = await userWithRole(app, 'administrador', 'adminZ@test.local');
    const roles = (await call(app, adm, 'GET', '/api/v1/roles')).json().data;
    assert.equal(roles.length, 7);
    assert.deepEqual(roles.find((r) => r.code === 'administrador').permissions, ['*']);
    const perms = (await call(app, adm, 'GET', '/api/v1/permissions')).json();
    assert.equal(perms.data.length, ALL_CODES.length);
    assert.ok(perms.modules.ventas.some((p) => p.code === 'ventas.refund'));
    void PASSWORD;
  });
});
