'use strict';
const { parseEnv } = require('../src/config/env');
const { createPool, withTransaction } = require('../src/db/pool');
const { seedRbac } = require('../src/modules/rbac/seed');

(async () => {
  const pool = createPool(parseEnv());
  try { await withTransaction(pool, seedRbac); console.log('[seed] roles y permisos sincronizados'); }
  catch (e) { console.error('[seed] ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
