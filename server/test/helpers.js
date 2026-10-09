'use strict';
process.env.NODE_ENV = 'test';
const { parseEnv } = require('../src/config/env');
const { createPool, withTransaction } = require('../src/db/pool');
const migrate = require('../src/db/migrate');
const { seedRbac } = require('../src/modules/rbac/seed');
const { createStorage } = require('../src/storage');
const { buildApp } = require('../src/app');

const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://serafina:serafina_dev@localhost/serafina_test',
  ARGON_MEMORY_KIB: '1024',
  STORAGE_DRIVER: 'memory',
  RATE_LIMIT_MAX: '10000',
  RATE_LIMIT_LOGIN_MAX: '1000',
  PUBLIC_URL: 'https://public.test',
  API_URL: 'https://api.test',
  ADMIN_URL: 'https://api.test/admin',
};
const PASSWORD = 'Contraseña-Segura-123';

async function resetDb(pool) {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate.up(pool);
  await withTransaction(pool, seedRbac);
}

async function makeApp(envOverrides = {}, { reset = true, beforeReady } = {}) {
  const config = parseEnv({ ...TEST_ENV, ...envOverrides });
  const pool = createPool(config);
  if (reset) await resetDb(pool);
  const app = await buildApp({ config, pool, storage: createStorage(config) });
  if (beforeReady) await beforeReady(app);
  await app.ready();
  app.close_all = async () => { await app.close(); await pool.end(); };
  return app;
}

async function createUser(app, { email, role = 'ventas', password = PASSWORD, fullName = 'Usuario Prueba', mustChange = false, active = true } = {}) {
  const hash = await app.hasher.hash(password);
  const { rows } = await app.pool.query(
    `INSERT INTO users(email, full_name, password_hash, role_id, must_change_password, active)
     VALUES ($1,$2,$3,(SELECT id FROM roles WHERE code=$4),$5,$6) RETURNING id`, [email, fullName, hash, role, mustChange, active]);
  return { id: rows[0].id, email, password };
}

function cookieFrom(res) {
  const c = res.cookies.find((x) => x.name === 'sid');
  return c ? `sid=${c.value}` : null;
}

async function login(app, email, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login falló (${res.statusCode}): ${res.body}`);
  return { cookie: cookieFrom(res), csrf: res.json().csrfToken, body: res.json(), res };
}

/** Atajo: request autenticado con cookie y CSRF. */
function call(app, session, method, url, payload, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (session) { headers.cookie = session.cookie; if (method !== 'GET') headers['x-csrf-token'] = session.csrf; }
  return app.inject({ method, url, payload, headers });
}

async function userWithRole(app, role, email = `${role}@test.local`) {
  await createUser(app, { email, role });
  return login(app, email);
}

/** multipart/form-data mínimo para app.inject */
function multipart({ filename = 'a.png', mime = 'image/png', content, fields = {} }) {
  const b = '----serafina' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), content, Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${b}` };
}
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

module.exports = { multipart, PNG_1PX, makeApp, createUser, login, call, userWithRole, resetDb, PASSWORD, TEST_ENV, cookieFrom };
