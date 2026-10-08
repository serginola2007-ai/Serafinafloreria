'use strict';
const { conflict, notFound, badRequest } = require('../../lib/errors');

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';

/** Slug único dentro de la tabla (agrega -2, -3… si ya existe). */
async function uniqueSlug(db, table, base) {
  const slug0 = slugify(base);
  for (let i = 1; ; i++) {
    const slug = i === 1 ? slug0 : `${slug0}-${i}`;
    if (!(await db.query(`SELECT 1 FROM ${table} WHERE slug = $1`, [slug])).rowCount) return slug; // table viene de constantes del código
  }
}

const statusOf = (p) => (p.archived_at ? 'archived' : p.needs_review ? 'review' : p.active ? 'published' : 'inactive');

/** Un producto solo se publica si está completo. Devuelve la lista de faltantes. */
async function publishProblems(db, productId) {
  const { rows } = await db.query(
    `SELECT p.category_id, p.needs_review, p.kind,
            (SELECT count(*) FROM product_variants v WHERE v.product_id = p.id AND v.active)::int AS variants,
            (SELECT count(*) FROM product_media pm JOIN media m ON m.id = pm.media_id AND m.archived_at IS NULL AND m.is_public WHERE pm.product_id = p.id)::int AS images
       FROM products p WHERE p.id = $1`, [productId]);
  const p = rows[0]; const missing = [];
  if (p.kind !== 'finished') return missing; // insumos/flores no se publican en la web: solo existen para inventario y recetas
  if (!p.category_id) missing.push('categoría');
  if (!p.variants) missing.push('al menos una variante con precio activa');
  if (!p.images) missing.push('al menos una imagen');
  if (p.needs_review) missing.push('resolver la revisión pendiente');
  return missing;
}
async function assertPublishable(db, productId) {
  const missing = await publishProblems(db, productId);
  if (missing.length) throw conflict(`El producto no se puede publicar. Falta: ${missing.join(', ')}`, 'PRODUCT_INCOMPLETE', { missing });
}

async function loadProduct(db, id, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN product_categories c ON c.id = p.category_id WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`, [id]);
  if (!rows.length) throw notFound('Producto no encontrado');
  return rows[0];
}

async function assertCategory(db, id) {
  if (id == null) return;
  const { rowCount } = await db.query('SELECT 1 FROM product_categories WHERE id = $1 AND archived_at IS NULL', [id]);
  if (!rowCount) throw badRequest('La categoría no existe o está archivada', { categoryId: id }, 'UNKNOWN_CATEGORY');
}
async function assertMedia(db, ids) {
  if (!ids.length) return;
  const { rows } = await db.query('SELECT id FROM media WHERE id = ANY($1::bigint[]) AND archived_at IS NULL AND is_public', [ids]);
  const ok = new Set(rows.map((r) => r.id));
  const bad = ids.filter((i) => !ok.has(i));
  if (bad.length) throw badRequest('Hay imágenes inexistentes, archivadas o privadas', { mediaIds: bad }, 'UNKNOWN_MEDIA');
}

module.exports = { slugify, uniqueSlug, statusOf, publishProblems, assertPublishable, loadProduct, assertCategory, assertMedia };
