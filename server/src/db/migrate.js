'use strict';
/**
 * Runner de migraciones versionadas.
 *   migrations/NNNN_nombre.up.sql   (obligatorio)
 *   migrations/NNNN_nombre.down.sql (obligatorio: si una migración es irreversible, el down debe lanzar un error explícito)
 * Cada migración corre en su propia transacción, con advisory lock para evitar corridas concurrentes.
 * Se guarda el checksum del .up.sql: modificar una migración ya aplicada se detecta y aborta.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 727001; // arbitrario, único para este proyecto

function load(dir = DIR) {
  const files = fs.readdirSync(dir);
  const byVersion = new Map();
  for (const f of files) {
    const m = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/.exec(f);
    if (!m) { if (f.endsWith('.sql')) throw new Error('Nombre de migración inválido: ' + f); continue; }
    const [, version, name, dir_] = m;
    const e = byVersion.get(version) || { version, name };
    if (e.name !== name) throw new Error('Versión duplicada: ' + version);
    e[dir_] = fs.readFileSync(path.join(dir, f), 'utf8');
    byVersion.set(version, e);
  }
  const list = [...byVersion.values()].sort((a, b) => a.version.localeCompare(b.version));
  for (const m of list) {
    if (!m.up || !m.down) throw new Error(`La migración ${m.version}_${m.name} necesita .up.sql y .down.sql`);
    m.checksum = crypto.createHash('sha256').update(m.up).digest('hex');
  }
  return list;
}

async function ensureTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
}

async function withLock(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTable(client);
    return await fn(client);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } finally { client.release(); }
  }
}

async function applied(client) {
  const { rows } = await client.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
  return rows;
}

async function up(pool, { dir, log = () => {} } = {}) {
  const migrations = load(dir);
  return withLock(pool, async (client) => {
    const done = new Map((await applied(client)).map((r) => [r.version, r]));
    for (const [v, r] of done) {
      const m = migrations.find((x) => x.version === v);
      if (!m) throw new Error(`La base tiene la migración ${v}_${r.name} que no existe en el código`);
      if (m.checksum !== r.checksum) throw new Error(`La migración ${v}_${m.name} fue modificada después de aplicarse`);
    }
    const ran = [];
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      try {
        await client.query('BEGIN');
        await client.query(m.up);
        await client.query('INSERT INTO schema_migrations(version,name,checksum) VALUES ($1,$2,$3)', [m.version, m.name, m.checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        err.message = `Falló la migración ${m.version}_${m.name}: ${err.message}`;
        throw err;
      }
      log(`aplicada ${m.version}_${m.name}`);
      ran.push(m.version);
    }
    return ran;
  });
}

async function down(pool, { steps = 1, dir, log = () => {} } = {}) {
  const migrations = load(dir);
  return withLock(pool, async (client) => {
    const done = await applied(client);
    const reverted = [];
    for (const r of done.reverse().slice(0, steps)) {
      const m = migrations.find((x) => x.version === r.version);
      if (!m) throw new Error('No se encuentra el archivo de la migración ' + r.version);
      try {
        await client.query('BEGIN');
        await client.query(m.down);
        await client.query('DELETE FROM schema_migrations WHERE version=$1', [m.version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        err.message = `Falló el rollback de ${m.version}_${m.name}: ${err.message}`;
        throw err;
      }
      log(`revertida ${m.version}_${m.name}`);
      reverted.push(m.version);
    }
    return reverted;
  });
}

async function status(pool, { dir } = {}) {
  const migrations = load(dir);
  return withLock(pool, async (client) => {
    const done = new Set((await applied(client)).map((r) => r.version));
    return migrations.map((m) => ({ version: m.version, name: m.name, applied: done.has(m.version) }));
  });
}

module.exports = { up, down, status, load };
