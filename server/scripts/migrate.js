'use strict';
const { parseEnv } = require('../src/config/env');
const { createPool } = require('../src/db/pool');
const migrate = require('../src/db/migrate');

(async () => {
  const [cmd = 'up', arg] = process.argv.slice(2);
  const config = parseEnv();
  const pool = createPool(config);
  const log = (m) => console.log('[migrate]', m);
  try {
    if (cmd === 'up') { const r = await migrate.up(pool, { log }); log(r.length ? `${r.length} migración(es) aplicada(s)` : 'base al día'); }
    else if (cmd === 'down') {
      if (config.isProd && !process.argv.includes('--allow-production')) throw new Error('Rollback bloqueado en producción (usar --allow-production tras revisar un backup)');
      const steps = Number(arg && !arg.startsWith('--') ? arg : 1);
      await migrate.down(pool, { steps, log });
    } else if (cmd === 'status') { for (const m of await migrate.status(pool)) console.log(m.applied ? '✔' : '·', m.version, m.name); }
    else throw new Error('Comando desconocido: ' + cmd);
  } catch (e) { console.error('[migrate] ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
