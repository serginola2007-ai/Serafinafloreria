'use strict';
/**
 * Importa JAVA/catalogo-datos.js (sin modificarlo) a PostgreSQL. Idempotente y no destructivo.
 *   npm run import-legacy-catalog -- --dry-run     # muestra el informe y revierte
 *   npm run import-legacy-catalog                  # aplica
 */
const path = require('node:path');
const fs = require('node:fs');
const { parseEnv } = require('../src/config/env');
const { createPool, withTransaction } = require('../src/db/pool');
const { importLegacyCatalog, loadLegacyCatalog } = require('../src/modules/catalog/import-legacy');
const { audit } = require('../src/modules/audit/audit');

const DRY = process.argv.includes('--dry-run');
class DryRun extends Error {}

(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const pool = createPool(parseEnv());
  try {
    const legacy = loadLegacyCatalog(path.join(repoRoot, 'JAVA', 'catalogo-datos.js'));
    console.log(`Origen: ${legacy.secciones.length} secciones, ${legacy.productos.length} productos`);
    let report;
    try {
      report = await withTransaction(pool, async (tx) => {
        const r = await importLegacyCatalog(tx, legacy, { repoRoot });
        await audit(tx, { ip: 'cli' }, { action: 'catalog.legacy_import', entity: 'catalog', userId: null, after: { ...r, dryRun: DRY } });
        if (DRY) throw Object.assign(new DryRun(), { report: r });
        return r;
      });
    } catch (e) { if (e instanceof DryRun) report = e.report; else throw e; }
    console.log(JSON.stringify(report, null, 2));
    const out = path.join(__dirname, '..', 'legacy-import-report.json');
    fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), dryRun: DRY, ...report }, null, 2));
    console.log(DRY ? '(dry-run: no se guardó nada)' : 'Importación aplicada.', 'Informe:', out);
    if (report.review.length) { console.log(`⚠ ${report.review.length} elemento(s) requieren revisión manual`); process.exitCode = 3; }
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { await pool.end(); }
})();
