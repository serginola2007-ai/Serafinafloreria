'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, createUser, login, call, userWithRole, PASSWORD } = require('./helpers');
const { scrub } = require('../src/modules/audit/audit');
const { withTransaction } = require('../src/db/pool');
const { audit } = require('../src/modules/audit/audit');

describe('auditoría', () => {
  let app, admin;
  before(async () => { app = await makeApp(); admin = await userWithRole(app, 'administrador', 'admin@test.local'); });
  after(async () => { await app.close_all(); });

  test('registra login, login fallido, alta/edición/baja de usuarios y cambios de permisos con antes/después', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@test.local', password: 'mala-mala-mala-12' } });
    const c = await call(app, admin, 'POST', '/api/v1/users', { email: 'aud@test.local', fullName: 'Auditado', roleCode: 'personalizado', password: 'Clave-Auditada-1' });
    const id = c.json().id;
    await call(app, admin, 'PATCH', `/api/v1/users/${id}`, { roleCode: 'ventas' });
    await call(app, admin, 'PUT', `/api/v1/users/${id}/permissions`, { allow: ['caja.view'], deny: ['ventas.cancel'] });
    await call(app, admin, 'DELETE', `/api/v1/users/${id}`);
    const { rows } = await app.pool.query('SELECT action, entity_id, before, after, user_id, ip, request_id FROM audit_logs ORDER BY id');
    const actions = rows.map((r) => r.action);
    for (const a of ['auth.login', 'auth.login_failed', 'user.created', 'user.updated', 'user.permissions_set', 'user.deactivated']) assert.ok(actions.includes(a), a);
    const upd = rows.find((r) => r.action === 'user.updated');
    assert.equal(upd.before.role.code, 'personalizado'); assert.equal(upd.after.role.code, 'ventas');
    assert.ok(upd.user_id && upd.request_id);
    const perm = rows.find((r) => r.action === 'user.permissions_set');
    assert.deepEqual(perm.after, { allow: ['caja.view'], deny: ['ventas.cancel'] });
  });

  test('nunca guarda contraseñas ni tokens', async () => {
    const all = JSON.stringify((await app.pool.query('SELECT before, after FROM audit_logs')).rows);
    assert.ok(!all.includes('Clave-Auditada-1') && !all.includes(PASSWORD) && !all.includes('argon2') && !all.includes('mala-mala'));
    assert.deepEqual(scrub({ password: 'x', nested: { apiToken: 'y', ok: 1 }, csrfToken: 'z' }), { password: '[REDACTED]', nested: { apiToken: '[REDACTED]', ok: 1 }, csrfToken: '[REDACTED]' });
  });

  test('es inmutable: UPDATE, DELETE y TRUNCATE son rechazados por la base', async () => {
    await assert.rejects(app.pool.query(`UPDATE audit_logs SET action='x'`), /append-only/);
    await assert.rejects(app.pool.query('DELETE FROM audit_logs'), /append-only/);
    await assert.rejects(app.pool.query('TRUNCATE audit_logs'), /append-only/);
  });

  test('es atómica con el cambio: si la transacción falla, no queda ni el cambio ni el registro', async () => {
    const before = (await app.pool.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n;
    await assert.rejects(withTransaction(app.pool, async (tx) => {
      await audit(tx, { ip: 'x' }, { action: 'test.rolled_back', userId: null });
      throw new Error('falla posterior');
    }));
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n, before);
  });

  test('consulta de auditoría: requiere permiso, filtra y pagina', async () => {
    const vend = await userWithRole(app, 'ventas', 'v@test.local');
    assert.equal((await call(app, vend, 'GET', '/api/v1/audit-logs')).statusCode, 403);
    const r = (await call(app, admin, 'GET', '/api/v1/audit-logs?action=user.created&limit=5')).json();
    assert.ok(r.data.length >= 1 && r.data.every((x) => x.action === 'user.created'));
    assert.equal(r.meta.limit, 5);
    assert.equal((await call(app, admin, 'GET', '/api/v1/audit-logs?limit=1000')).statusCode, 400);
  });
});

describe('manejo de errores', () => {
  let app;
  before(async () => {
    app = await makeApp({}, { beforeReady: async (a) => {
      const access = require('../src/lib/access');
      a.get('/api/v1/__boom', { config: access.public }, async () => { throw new Error('secreto interno: postgres://user:pw@host/db'); });
      a.get('/api/v1/__pg', { config: access.public }, async () => a.pool.query('SELECT * FROM tabla_que_no_existe'));
    } });
  });
  after(async () => { await app.close_all(); });

  test('500 genérico: sin stack ni mensajes internos, con requestId', async () => {
    for (const url of ['/api/v1/__boom', '/api/v1/__pg']) {
      const r = await app.inject(url);
      assert.equal(r.statusCode, 500);
      assert.equal(r.json().error.code, 'INTERNAL');
      assert.ok(r.json().error.requestId);
      assert.ok(!/postgres:|tabla_que_no_existe|at .*\.js|stack/i.test(r.body));
    }
  });
  test('JSON malformado → 400; método no permitido por CORS preflight desde origen ajeno no se habilita', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: '{"email":', headers: { 'content-type': 'application/json' } });
    assert.equal(bad.statusCode, 400);
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/v1/users', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    assert.ok(!pre.headers['access-control-allow-origin']);
    const okPre = await app.inject({ method: 'OPTIONS', url: '/api/v1/users', headers: { origin: 'https://public.test', 'access-control-request-method': 'GET' } });
    assert.equal(okPre.headers['access-control-allow-origin'], 'https://public.test');
  });
  test('payload demasiado grande → 413', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@b.cc', password: 'x'.repeat(2 * 1024 * 1024) } });
    assert.equal(r.statusCode, 413);
  });
  test('id de request propagado si es válido', async () => {
    const r = await app.inject({ url: '/health', headers: { 'x-request-id': 'req-12345678' } });
    assert.equal(r.headers['x-request-id'], 'req-12345678');
    const r2 = await app.inject({ url: '/health', headers: { 'x-request-id': 'mal id \n inyectado' } });
    assert.match(r2.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    void createUser; void login;
  });
});
