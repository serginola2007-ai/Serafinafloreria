'use strict';
const { Pool, types } = require('pg');

// BIGINT (OID 20) llega como string por defecto. Los importes PYG caben en Number.MAX_SAFE_INTEGER
// (9.007.199.254.740.991 Gs), así que se parsean como Number y se rechaza cualquier valor inseguro.
types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('BIGINT fuera de rango seguro: ' + v);
  return n;
});

function createPool(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: 'serafina-server',
  });
  pool.on('error', () => { /* errores de clientes inactivos: se reportan en /ready */ });
  return pool;
}

/**
 * Ejecuta fn(client) dentro de una transacción. COMMIT si resuelve, ROLLBACK si lanza.
 * Reintenta ante serialization_failure (40001) y deadlock (40P01).
 */
async function withTransaction(pool, fn, { isolation = 'READ COMMITTED', retries = 2 } = {}) {
  if (!['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].includes(isolation)) throw new Error('isolation inválido');
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL ' + isolation);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* conexión rota */ }
      if ((err.code === '40001' || err.code === '40P01') && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = { createPool, withTransaction };
