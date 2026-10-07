'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { makeApp, TEST_ENV, login } = require('./helpers');
const { passwordProblem } = require('../src/lib/passwords');

const run = (args, env) => new Promise((resolve) => execFile(process.execPath, [path.join(__dirname, '../scripts/create-admin.js'), ...args],
  { env: { ...process.env, ...TEST_ENV, ...env }, timeout: 30000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));

describe('bootstrap del primer Administrador', () => {
  let app;
  before(async () => { app = await makeApp(); });
  after(async () => { await app.close_all(); });

  test('sin credenciales por defecto: la base nueva no tiene ningún usuario', async () => {
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0);
  });
  test('rechaza contraseñas débiles y falta de datos', async () => {
    assert.equal((await run(['--email', 'a@b.cc', '--name', 'Dueña Uno'], { BOOTSTRAP_ADMIN_PASSWORD: 'corta' })).code, 1);
    assert.equal((await run([], {})).code, 2);
    assert.equal((await run(['--email', 'a@b.cc', '--name', 'Dueña Uno'], { BOOTSTRAP_ADMIN_PASSWORD: '' })).code, 1, 'sin TTY ni variable');
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 0);
  });
  test('crea el Administrador (con cambio de contraseña obligatorio) y audita', async () => {
    const r = await run(['--email', 'duena@serafina.test', '--name', 'Dueña Serafina'], { BOOTSTRAP_ADMIN_PASSWORD: 'Inicio-Seguro-2026!' });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes('Inicio-Seguro'), 'no imprime la contraseña');
    const s = await login(app, 'duena@serafina.test', 'Inicio-Seguro-2026!');
    assert.equal(s.body.user.mustChangePassword, true); assert.equal(s.body.user.role.code, 'administrador');
    assert.equal((await app.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='user.bootstrap_admin'`)).rows[0].n, 1);
  });
  test('se niega a crear otro si ya hay un Administrador activo (salvo --allow-additional)', async () => {
    const again = await run(['--email', 'otro@serafina.test', '--name', 'Otro Admin'], { BOOTSTRAP_ADMIN_PASSWORD: 'Inicio-Seguro-2026!' });
    assert.equal(again.code, 1); assert.match(again.stderr, /Ya existe un Administrador/);
    const ok = await run(['--email', 'otro@serafina.test', '--name', 'Otro Admin', '--allow-additional'], { BOOTSTRAP_ADMIN_PASSWORD: 'Inicio-Seguro-2026!' });
    assert.equal(ok.code, 0, ok.stderr);
  });
});

describe('política de contraseñas', () => {
  test('reglas', () => {
    assert.ok(passwordProblem('corta1')); assert.ok(passwordProblem('a'.repeat(129)));
    assert.ok(passwordProblem('aaaaaaaaaaaaaaaa')); assert.ok(passwordProblem('password1234'));
    assert.ok(passwordProblem('maria.lopez-2026!', { email: 'maria.lopez@x.com' }));
    assert.equal(passwordProblem('Una-Frase-Larga-y-Unica-9'), null);
    assert.ok(passwordProblem(undefined));
  });
  test('los hashes son argon2id y no reversibles', async () => {
    const { makeHasher } = require('../src/lib/passwords');
    const h = makeHasher(1024); const hash = await h.hash('Una-Frase-Larga-y-Unica-9');
    assert.match(hash, /^\$argon2id\$/); assert.ok(await h.verify(hash, 'Una-Frase-Larga-y-Unica-9')); assert.ok(!(await h.verify(hash, 'otra')));
    assert.equal(await h.verify('no-es-un-hash', 'x'), false);
  });
});
