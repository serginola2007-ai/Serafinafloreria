'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, userWithRole, createUser, call } = require('./helpers');

describe('API de soporte del panel', () => {
  let app, admin;
  before(async () => {
    app = await makeApp(); admin = await userWithRole(app, 'administrador', 'admin@test.local');
    await createUser(app, { email: 'zeta@test.local', fullName: 'Zeta Zapata', role: 'ventas' });
    await createUser(app, { email: 'alfa@test.local', fullName: 'Alfa Aguirre', role: 'florista', active: false });
  });
  after(async () => { await app.close_all(); });

  test('usuarios: orden por columna (lista blanca), filtro de estado y paginación', async () => {
    const asc = (await call(app, admin, 'GET', '/api/v1/users?sort=name&dir=asc')).json().data.map((u) => u.fullName);
    assert.deepEqual(asc, [...asc].sort((a, b) => a.localeCompare(b)));
    const desc = (await call(app, admin, 'GET', '/api/v1/users?sort=email&dir=desc')).json().data.map((u) => u.email);
    assert.deepEqual(desc, [...desc].sort().reverse());
    assert.equal((await call(app, admin, 'GET', '/api/v1/users?active=false')).json().data.length, 1);
    assert.equal((await call(app, admin, 'GET', '/api/v1/users?active=true&q=zeta')).json().data.length, 1);
    assert.equal((await call(app, admin, 'GET', '/api/v1/users?sort=password_hash')).statusCode, 400, 'no se puede ordenar por columnas fuera de la lista');
    assert.equal((await call(app, admin, 'GET', "/api/v1/users?sort=name;DROP TABLE users")).statusCode, 400);
    assert.equal((await call(app, admin, 'GET', '/api/v1/users?limit=1&page=2')).json().meta.pages, 3);
  });

  test('roles/options: lo ven quienes pueden gestionar usuarios; no expone permisos', async () => {
    const r = (await call(app, admin, 'GET', '/api/v1/roles/options')).json().data;
    assert.equal(r.length, 7); assert.ok(r.every((x) => !('permissions' in x)));
    const vend = await userWithRole(app, 'ventas', 'v@test.local');
    assert.equal((await call(app, vend, 'GET', '/api/v1/roles/options')).statusCode, 403);
  });

  test('dashboard: solo muestra secciones permitidas y datos reales', async () => {
    const a = (await call(app, admin, 'GET', '/api/v1/dashboard/summary')).json();
    assert.deepEqual(Object.keys(a).sort(), ['cash', 'catalog', 'integrations', 'inventory', 'purchasing', 'recentActivity', 'sales', 'users']);
    assert.equal(a.users.active, 3); assert.equal(a.users.inactive, 1);
    assert.equal(a.integrations.withCredentials, 0);
    const rep = await userWithRole(app, 'repartidor', 'r@test.local');
    assert.deepEqual((await call(app, rep, 'GET', '/api/v1/dashboard/summary')).json(), {}, 'sin permisos de lectura → nada');
    const vend = await userWithRole(app, 'ventas', 'v2@test.local');
    const v = (await call(app, vend, 'GET', '/api/v1/dashboard/summary')).json();
    assert.ok(v.catalog && !v.users && !v.recentActivity);
    assert.equal((await app.inject('/api/v1/dashboard/summary')).statusCode, 401);
  });

  test('el panel se sirve en /admin/ con CSP estricta (sin scripts inline) y sin indexar', async () => {
    const r = await app.inject('/admin/');
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.doesNotMatch(r.headers['content-security-policy'], /script-src[^;]*unsafe-inline/);
    assert.match(r.body, /noindex/);
    assert.doesNotMatch(r.body, /<script(?![^>]*\bsrc=)[^>]*>/, 'ningún <script> inline');
    assert.equal((await app.inject('/admin/assets/js/core/main.js')).statusCode, 200);
    assert.equal((await app.inject('/admin/assets/js/../../../../package.json')).statusCode, 404, 'sin path traversal');
    assert.equal((await app.inject('/admin')).statusCode, 302);
  });

  test('ningún archivo del panel usa innerHTML / eval / document.write (anti-XSS)', () => {
    const fs = require('node:fs'); const path = require('node:path');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
    for (const f of walk(path.join(__dirname, '../../admin/assets/js'))) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(src, /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, f);
    }
  });
});
