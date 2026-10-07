'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, createUser, login, call, PASSWORD, cookieFrom } = require('./helpers');

describe('autenticación y sesiones', () => {
  let app;
  before(async () => { app = await makeApp({ LOGIN_MAX_ATTEMPTS: '3' }); await createUser(app, { email: 'ana@test.local', role: 'ventas' }); });
  after(async () => { await app.close_all(); });

  test('login correcto: cookie HttpOnly + SameSite, sin hash en la respuesta, permisos y csrf', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ana@test.local', password: PASSWORD } });
    assert.equal(r.statusCode, 200);
    const c = r.cookies.find((x) => x.name === 'sid');
    assert.ok(c && c.httpOnly && c.sameSite === 'Lax' && c.path === '/');
    const b = r.json();
    assert.ok(b.csrfToken && b.permissions.includes('ventas.create'));
    assert.ok(!JSON.stringify(b).includes('password') && !JSON.stringify(b).includes('argon2'));
    assert.ok(!r.body.includes(c.value), 'el token de sesión no viaja en el cuerpo');
  });

  test('el token de sesión se guarda solo como hash', async () => {
    const s = await login(app, 'ana@test.local');
    const token = s.cookie.split('=')[1];
    const { rows } = await app.pool.query('SELECT token_hash FROM sessions ORDER BY id DESC LIMIT 1');
    assert.notEqual(rows[0].token_hash.toString('utf8'), token);
    assert.equal(rows[0].token_hash.length, 32);
  });

  test('credenciales inválidas: mismo mensaje para usuario inexistente y contraseña errónea', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ana@test.local', password: 'incorrecta-incorrecta' } });
    const none = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'nadie@test.local', password: 'incorrecta-incorrecta' } });
    assert.equal(bad.statusCode, 401); assert.equal(none.statusCode, 401);
    assert.deepEqual(bad.json().error.message, none.json().error.message);
    assert.equal(bad.json().error.code, 'INVALID_CREDENTIALS');
    assert.equal(cookieFrom(bad), null);
  });

  test('bloqueo tras N intentos fallidos aun con la contraseña correcta; luego se libera', async () => {
    await createUser(app, { email: 'lock@test.local' });
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'lock@test.local', password: 'mala-mala-mala-1' } });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'lock@test.local', password: PASSWORD } });
    assert.equal(r.statusCode, 401);
    await app.pool.query(`UPDATE users SET locked_until = now() - interval '1 minute' WHERE email='lock@test.local'`);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'lock@test.local', password: PASSWORD } });
    assert.equal(ok.statusCode, 200);
  });

  test('usuario inactivo no puede ingresar', async () => {
    await createUser(app, { email: 'off@test.local', active: false });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'off@test.local', password: PASSWORD } });
    assert.equal(r.statusCode, 401);
  });

  test('sin cookie → 401; cookie falsa → 401', async () => {
    assert.equal((await app.inject('/api/v1/auth/me')).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'sid=' + 'x'.repeat(43) } })).statusCode, 401);
  });

  test('CSRF: POST autenticado sin token o con token incorrecto → 403; con token → ok', async () => {
    const s = await login(app, 'ana@test.local');
    const noTok = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: s.cookie } });
    assert.equal(noTok.statusCode, 403); assert.equal(noTok.json().error.code, 'CSRF');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: s.cookie, 'x-csrf-token': 'x'.repeat(s.csrf.length) } });
    assert.equal(bad.statusCode, 403);
    assert.equal((await call(app, s, 'POST', '/api/v1/auth/logout')).statusCode, 200);
  });

  test('Origin ajeno en métodos no seguros → 403 (también en login)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ana@test.local', password: PASSWORD }, headers: { origin: 'https://evil.example' } });
    assert.equal(r.statusCode, 403); assert.equal(r.json().error.code, 'BAD_ORIGIN');
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ana@test.local', password: PASSWORD }, headers: { origin: 'https://public.test' } });
    assert.equal(ok.statusCode, 200);
  });

  test('logout revoca la sesión en el servidor (la cookie vieja deja de servir)', async () => {
    const s = await login(app, 'ana@test.local');
    await call(app, s, 'POST', '/api/v1/auth/logout');
    assert.equal((await call(app, s, 'GET', '/api/v1/auth/me')).statusCode, 401);
  });

  test('expiración absoluta e inactividad', async () => {
    const s = await login(app, 'ana@test.local');
    await app.pool.query(`UPDATE sessions SET last_seen_at = now() - interval '3 hours' WHERE user_id = (SELECT id FROM users WHERE email='ana@test.local')`);
    assert.equal((await call(app, s, 'GET', '/api/v1/auth/me')).statusCode, 401, 'inactividad');
    const s2 = await login(app, 'ana@test.local');
    await app.pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email='ana@test.local')`);
    assert.equal((await call(app, s2, 'GET', '/api/v1/auth/me')).statusCode, 401, 'expiración');
  });

  test('desactivar al usuario invalida sus sesiones activas', async () => {
    const u = await createUser(app, { email: 'tmp@test.local' });
    const s = await login(app, 'tmp@test.local');
    await app.pool.query('UPDATE users SET active=false WHERE id=$1', [u.id]);
    assert.equal((await call(app, s, 'GET', '/api/v1/auth/me')).statusCode, 401);
  });

  test('cambio de contraseña: valida actual, política, revoca otras sesiones, la nueva funciona', async () => {
    await createUser(app, { email: 'cp@test.local' });
    const a = await login(app, 'cp@test.local'); const b = await login(app, 'cp@test.local');
    const wrong = await call(app, a, 'POST', '/api/v1/auth/change-password', { currentPassword: 'no-es-esa-123456', newPassword: 'Otra-Clave-Larga-99' });
    assert.equal(wrong.statusCode, 400);
    const weak = await call(app, a, 'POST', '/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'corta' });
    assert.equal(weak.statusCode, 400); assert.equal(weak.json().error.code, 'WEAK_PASSWORD');
    const ok = await call(app, a, 'POST', '/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Otra-Clave-Larga-99' });
    assert.equal(ok.statusCode, 200);
    assert.equal((await call(app, a, 'GET', '/api/v1/auth/me')).statusCode, 200, 'la sesión actual sigue');
    assert.equal((await call(app, b, 'GET', '/api/v1/auth/me')).statusCode, 401, 'las otras se revocan');
    await login(app, 'cp@test.local', 'Otra-Clave-Larga-99');
  });

  test('must_change_password: solo se permite me/logout/change-password hasta cambiarla', async () => {
    await createUser(app, { email: 'new@test.local', role: 'administrador', mustChange: true });
    const s = await login(app, 'new@test.local');
    const blocked = await call(app, s, 'GET', '/api/v1/users');
    assert.equal(blocked.statusCode, 403); assert.equal(blocked.json().error.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await call(app, s, 'GET', '/api/v1/auth/me')).statusCode, 200);
    await call(app, s, 'POST', '/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Nueva-Clave-Larga-77' });
    assert.equal((await call(app, s, 'GET', '/api/v1/users')).statusCode, 200);
  });

  test('validación: body inválido → 400 con detalle; propiedades extra rechazadas', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@b.c' } });
    assert.equal(r.statusCode, 400); assert.equal(r.json().error.code, 'VALIDATION_ERROR');
    assert.ok(r.json().error.details.some((d) => d.field === 'password'));
    const extra = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@b.c', password: 'x', isAdmin: true } });
    assert.equal(extra.statusCode, 400);
  });

  test('inyección SQL en login no rompe ni autentica', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: "' OR '1'='1' --", password: "' OR '1'='1" } });
    assert.equal(r.statusCode, 401);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n > 0, true);
  });
});

describe('rate limiting del login', () => {
  let app;
  before(async () => { app = await makeApp({ RATE_LIMIT_LOGIN_MAX: '4' }); });
  after(async () => { await app.close_all(); });
  test('excede el máximo por ventana → 429', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'x@y.zz', password: 'abc' } })).statusCode);
    assert.deepEqual(codes.slice(0, 4), [401, 401, 401, 401]);
    assert.equal(codes[5], 429);
  });
});
