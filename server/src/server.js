'use strict';
const { parseEnv } = require('./config/env');
const { createPool } = require('./db/pool');
const { createStorage } = require('./storage');
const { buildApp } = require('./app');

(async () => {
  let config;
  try { config = parseEnv(); } catch (e) { console.error(e.message); process.exit(1); }
  const pool = createPool(config);
  const app = await buildApp({ config, pool, storage: createStorage(config) });
  const shutdown = async (sig) => {
    app.log.info({ sig }, 'cerrando');
    try { await app.close(); await pool.end(); } finally { process.exit(0); }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  try { await app.listen({ host: config.host, port: config.port }); }
  catch (e) { app.log.error(e); process.exit(1); }
})();
