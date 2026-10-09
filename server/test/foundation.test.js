'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { TEST_ENV, makeApp, resetDb } = require('./helpers');
const { parseEnv, EnvError } = require('../src/config/env');
const { createPool, withTransaction } = require('../src/db/pool');
const migrate = require('../src/db/migrate');

describe('configuración (variables de entorno)', () => {
  test('falla sin DATABASE_URL', () => {
    assert.throws(() => parseEnv({ NODE_ENV: 'test' }), (e) => e instanceof EnvError && /DATABASE_URL/.test(e.message));
  });
  test('producción exige URLs https y no admite storage memory', () => {
    assert.throws(() => parseEnv({ NODE_ENV: 'production', DATABASE_URL: 'x' }), (e) => /PUBLIC_URL/.test(e.message) && /API_URL/.test(e.message) && /ADMIN_URL/.test(e.message));
    assert.throws(() => parseEnv({ NODE_ENV: 'production', DATABASE_URL: 'x', PUBLIC_URL: 'http://a.com', API_URL: 'https://b.com', ADMIN_URL: 'https://b.com/admin' }), /https/);
    assert.throws(() => parseEnv({ NODE_ENV: 'production', DATABASE_URL: 'x', PUBLIC_URL: 'https://a.com', API_URL: 'https://b.com', ADMIN_URL: 'https://b.com/admin', STORAGE_DRIVER: 'memory' }), /memory/);
  });
  test('s3 exige credenciales; hashing mínimo en producción', () => {
    assert.throws(() => parseEnv({ ...TEST_ENV, STORAGE_DRIVER: 's3' }), /S3_BUCKET/);
    assert.throws(() => parseEnv({ NODE_ENV: 'production', DATABASE_URL: 'x', PUBLIC_URL: 'https://a.com', API_URL: 'https://b.com', ADMIN_URL: 'https://b.com/admin', ARGON_MEMORY_KIB: '2048' }), /ARGON_MEMORY_KIB/);
  });
  test('derivados: orígenes permitidos salen de las URLs, sin dominios hardcodeados', () => {
    const c = parseEnv(TEST_ENV);
    assert.deepEqual([...c.allowedOrigins].sort(), ['https://api.test', 'https://public.test']);
  });
});

describe('PostgreSQL: migraciones y transacciones', () => {
  let pool;
  before(async () => { pool = createPool(parseEnv(TEST_ENV)); });
  after(async () => { await pool.end(); });

  test('conexión y esquema desde cero; segunda corrida no aplica nada', async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const first = await migrate.up(pool);
    assert.ok(first.length >= 2);
    assert.deepEqual(await migrate.up(pool), []);
    const st = await migrate.status(pool);
    assert.ok(st.every((s) => s.applied));
  });

  test('rollback total y re-aplicación (down/up) sin errores', async () => {
    await resetDb(pool);
    const all = (await migrate.status(pool)).length;
    const reverted = await migrate.down(pool, { steps: all });
    assert.equal(reverted.length, all);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'schema_migrations'`);
    assert.equal(rows[0].n, 0, 'el rollback debe dejar el esquema vacío');
    assert.equal((await migrate.up(pool)).length, all);
  });

  test('detecta migraciones modificadas después de aplicarse', async () => {
    await resetDb(pool);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of fs.readdirSync(path.join(__dirname, '../src/db/migrations'))) fs.copyFileSync(path.join(__dirname, '../src/db/migrations', f), path.join(dir, f));
    fs.appendFileSync(path.join(dir, '0001_identity.up.sql'), '\n-- cambio\n');
    await assert.rejects(migrate.up(pool, { dir }), /fue modificada/);
  });

  test('una migración que falla hace rollback completo', async () => {
    await resetDb(pool);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of fs.readdirSync(path.join(__dirname, '../src/db/migrations'))) fs.copyFileSync(path.join(__dirname, '../src/db/migrations', f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, '9999_rota.up.sql'), 'CREATE TABLE x_ok(id int); SELECT 1/0;');
    fs.writeFileSync(path.join(dir, '9999_rota.down.sql'), 'DROP TABLE x_ok;');
    await assert.rejects(migrate.up(pool, { dir }), /9999_rota/);
    const { rows } = await pool.query(`SELECT to_regclass('x_ok') AS t`);
    assert.equal(rows[0].t, null, 'la tabla no debe quedar creada');
  });

  test('withTransaction: COMMIT si resuelve, ROLLBACK si lanza', async () => {
    await resetDb(pool);
    await withTransaction(pool, (c) => c.query(`INSERT INTO settings(key,value) VALUES ('t.ok','1')`));
    await assert.rejects(withTransaction(pool, async (c) => {
      await c.query(`INSERT INTO settings(key,value) VALUES ('t.rolled','1')`);
      throw new Error('boom');
    }), /boom/);
    const { rows } = await pool.query(`SELECT key FROM settings ORDER BY key`);
    assert.deepEqual(rows.map((r) => r.key), ['t.ok']);
  });

  test('withTransaction: dos operaciones atómicas, la segunda falla → ninguna persiste', async () => {
    await resetDb(pool);
    await assert.rejects(withTransaction(pool, async (c) => {
      await c.query(`INSERT INTO settings(key,value) VALUES ('a.uno','1')`);
      await c.query(`INSERT INTO settings(key,value) VALUES ('CLAVE INVALIDA','1')`); // viola CHECK
    }), (e) => e.code === '23514');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM settings')).rows[0].n, 0);
  });

  test('BIGINT se devuelve como Number y los importes son enteros no negativos', async () => {
    await resetDb(pool);
    const { rows } = await pool.query(`SELECT 9007199254740991::bigint AS n`);
    assert.equal(typeof rows[0].n, 'number');
    await assert.rejects(pool.query(`SELECT 9007199254740993::bigint AS n`), /fuera de rango/);
    await pool.query(`INSERT INTO product_categories(slug,name) VALUES ('c','C')`);
    const p = await pool.query(`INSERT INTO products(slug,name,category_id) VALUES ('p','P',1) RETURNING id`);
    await assert.rejects(pool.query(`INSERT INTO product_variants(product_id,label,price_pyg) VALUES ($1,'x',-1)`, [p.rows[0].id]), (e) => e.code === '23514');
  });
});

describe('health', () => {
  let app;
  before(async () => { app = await makeApp(); });
  after(async () => { await app.close_all(); });
  test('/health y /ready', async () => {
    assert.equal((await app.inject('/health')).statusCode, 200);
    const r = await app.inject('/ready');
    assert.equal(r.statusCode, 200); assert.equal(r.json().status, 'ready');
  });
  test('/ready = 503 si el esquema está atrasado', async () => {
    await app.pool.query(`DELETE FROM schema_migrations WHERE version = (SELECT max(version) FROM schema_migrations)`);
    const r = await app.inject('/ready');
    assert.equal(r.statusCode, 503); assert.equal(r.json().status, 'schema_outdated');
  });
  test('cabeceras de seguridad, request-id y 404 JSON', async () => {
    const r = await app.inject('/api/v1/nada');
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().error.code, 'NOT_FOUND');
    assert.ok(r.headers['x-request-id']);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(r.headers['x-powered-by'], undefined);
  });
});
