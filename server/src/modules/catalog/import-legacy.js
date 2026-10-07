'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePrice } = require('./legacy-parser');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Registra un archivo del repositorio como media 'legacy'. Devuelve {id} o {missing:true}. */
async function registerLegacyFile(db, repoRoot, relFromHtml) {
  const abs = path.resolve(repoRoot, 'HTML', relFromHtml);
  const key = path.relative(repoRoot, abs).split(path.sep).join('/');
  if (!key.startsWith('IMAGENES/') || !fs.existsSync(abs)) return { missing: true, key };
  const buf = fs.readFileSync(abs);
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) return { missing: true, key };
  const { rows } = await db.query(
    `INSERT INTO media(storage, storage_key, mime, size_bytes, sha256, original_name)
     VALUES ('legacy',$1,$2,$3,$4,$5)
     ON CONFLICT (storage, storage_key) DO UPDATE SET storage_key = EXCLUDED.storage_key RETURNING id`,
    [key, mime, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), path.basename(abs)]);
  return { id: rows[0].id, key };
}

/**
 * Importa el catálogo hardcodeado (window.SERAFINA_CATALOGO) a PostgreSQL. IDEMPOTENTE y NO destructivo:
 * lo que ya existe (por legacy_id / slug) se deja intacto, así no se pisan ediciones hechas luego desde el panel.
 */
async function importLegacyCatalog(db, legacy, { repoRoot, userId = null } = {}) {
  const report = { categories: { created: 0, existing: 0 }, products: { created: 0, existing: 0 }, variants: 0, media: 0, review: [] };

  const catIds = new Map();
  for (const [i, s] of legacy.secciones.entries()) {
    const cover = s.foto ? await registerLegacyFile(db, repoRoot, s.foto) : { missing: true };
    const ins = await db.query(
      `INSERT INTO product_categories(slug, name, description, cover_media_id, sort_order) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slug) DO NOTHING RETURNING id`, [s.id, s.titulo, s.descripcion || null, cover.missing ? null : cover.id, i]);
    if (ins.rowCount) { report.categories.created++; catIds.set(s.id, ins.rows[0].id); if (!cover.missing) report.media++; }
    else { report.categories.existing++; catIds.set(s.id, (await db.query('SELECT id FROM product_categories WHERE slug=$1', [s.id])).rows[0].id); }
    if (cover.missing) report.review.push({ type: 'category', id: s.id, problem: `portada no encontrada: ${cover.key ?? s.foto}` });
  }

  for (const [i, p] of legacy.productos.entries()) {
    if ((await db.query('SELECT 1 FROM products WHERE legacy_id=$1', [p.id])).rowCount) { report.products.existing++; continue; }
    const problems = [];
    const variants = parsePrice(p.precio);
    if (!variants) problems.push(`precio no convertible automáticamente: "${p.precio}"`);
    if (!catIds.has(p.seccion)) problems.push(`sección inexistente: ${p.seccion}`);
    const photos = [];
    for (const f of p.fotos || []) {
      const r = await registerLegacyFile(db, repoRoot, f);
      if (r.missing) problems.push(`imagen no encontrada: ${f}`); else photos.push(r.id);
    }
    if (!photos.length) problems.push('sin imágenes válidas');

    let slug = slugify(p.nombre) || slugify(p.id);
    if ((await db.query('SELECT 1 FROM products WHERE slug=$1', [slug])).rowCount) slug = `${slug}-${slugify(p.id)}`;
    const review = problems.length > 0;
    const { rows } = await db.query(
      `INSERT INTO products(legacy_id, slug, name, description, category_id, kind, is_sellable, active, needs_review, review_note, sort_order)
       VALUES ($1,$2,$3,$4,$5,'finished',true,$6,$7,$8,$9) RETURNING id`,
      [p.id, slug, p.nombre, p.descripcion || null, catIds.get(p.seccion) ?? null, !review, review, review ? problems.join('; ') : null, i]);
    const productId = rows[0].id;
    for (const [j, v] of (variants || []).entries()) {
      const vr = await db.query('INSERT INTO product_variants(product_id, label, price_pyg, sort_order) VALUES ($1,$2,$3,$4) RETURNING id', [productId, v.label, v.pricePyg, j]);
      await db.query(`INSERT INTO variant_price_history(variant_id, price_pyg, changed_by, reason) VALUES ($1,$2,$3,'importación del catálogo original')`, [vr.rows[0].id, v.pricePyg, userId]);
      report.variants++;
    }
    for (const [j, mid] of photos.entries()) { await db.query('INSERT INTO product_media(product_id, media_id, sort_order) VALUES ($1,$2,$3)', [productId, mid, j]); }
    report.media += photos.length;
    report.products.created++;
    if (review) report.review.push({ type: 'product', id: p.id, name: p.nombre, problem: problems.join('; ') });
  }
  return report;
}

/** Carga JAVA/catalogo-datos.js tal cual está (sin modificarlo) en un sandbox. */
function loadLegacyCatalog(file) {
  const vm = require('node:vm');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 2000 });
  if (!sandbox.window.SERAFINA_CATALOGO) throw new Error('catalogo-datos.js no define SERAFINA_CATALOGO');
  return JSON.parse(JSON.stringify(sandbox.window.SERAFINA_CATALOGO)); // copia limpia (fuera del contexto vm)
}
module.exports = { importLegacyCatalog, loadLegacyCatalog };
