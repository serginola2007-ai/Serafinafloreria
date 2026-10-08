'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');
const { mediaUrl } = require('../media/urls');
const S = require('./service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const price = { type: 'integer', minimum: 0, maximum: 1000000000000 }; // Guaraníes enteros
const text = (max, min = 1) => ({ type: 'string', minLength: min, maxLength: max });
const KINDS = ['finished', 'raw_flower', 'foliage', 'supply', 'accessory', 'packaging'];

module.exports = async function catalogAdminRoutes(app) {
  const { pool } = app;
  const url = (m) => (m.storage_key ? mediaUrl(app, m) : null);

  async function productDetail(db, pid) {
    const p = await S.loadProduct(db, pid);
    const variants = (await db.query('SELECT id, label, sku, price_pyg, active, sort_order FROM product_variants WHERE product_id = $1 ORDER BY sort_order, id', [pid])).rows;
    const images = (await db.query(
      `SELECT m.id, m.storage, m.storage_key, m.alt_text FROM product_media pm JOIN media m ON m.id = pm.media_id WHERE pm.product_id = $1 AND m.archived_at IS NULL ORDER BY pm.sort_order, m.id`, [pid])).rows;
    return {
      id: p.id, legacyId: p.legacy_id, slug: p.slug, sku: p.sku, name: p.name, description: p.description, kind: p.kind,
      status: S.statusOf(p), active: p.active, needsReview: p.needs_review, reviewNote: p.review_note, archived: !!p.archived_at, sortOrder: p.sort_order,
      category: p.category_id ? { id: p.category_id, name: p.category_name } : null,
      variants: variants.map((v) => ({ id: v.id, label: v.label, sku: v.sku, pricePyg: v.price_pyg, active: v.active, sortOrder: v.sort_order })),
      images: images.map((m) => ({ mediaId: m.id, url: url(m), altText: m.alt_text })),
      createdAt: p.created_at, updatedAt: p.updated_at,
    };
  }
  const snapshot = (d) => ({ name: d.name, description: d.description, kind: d.kind, status: d.status, categoryId: d.category?.id ?? null, sortOrder: d.sortOrder });

  /* ───────── Categorías ───────── */
  app.get('/api/v1/categories', { config: access.perm('productos.view') }, async () => {
    const { rows } = await pool.query(
      `SELECT c.id, c.slug, c.name, c.description, c.sort_order, c.active, c.archived_at, c.cover_media_id, m.storage, m.storage_key,
              (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.archived_at IS NULL)::int AS products
         FROM product_categories c LEFT JOIN media m ON m.id = c.cover_media_id ORDER BY c.archived_at NULLS FIRST, c.sort_order, c.id`);
    return { data: rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description, sortOrder: c.sort_order, active: c.active,
      archived: !!c.archived_at, coverMediaId: c.cover_media_id, coverUrl: url(c), products: c.products })) };
  });

  const catBody = { name: text(80), description: { type: ['string', 'null'], maxLength: 500 }, coverMediaId: { type: ['integer', 'null'], minimum: 1 }, sortOrder: { type: 'integer', minimum: 0, maximum: 100000 } };
  app.post('/api/v1/categories', { config: access.perm('productos.create'),
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: catBody } } }, async (req, reply) => {
    const b = req.body;
    const row = await withTransaction(pool, async (tx) => {
      if (b.coverMediaId) await S.assertMedia(tx, [b.coverMediaId]);
      const slug = await S.uniqueSlug(tx, 'product_categories', b.name);
      const { rows } = await tx.query(
        `INSERT INTO product_categories(slug, name, description, cover_media_id, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id, slug, name`,
        [slug, b.name.trim(), b.description ?? null, b.coverMediaId ?? null, b.sortOrder ?? 0]);
      await audit(tx, req, { action: 'category.created', entity: 'category', entityId: rows[0].id, after: b });
      return rows[0];
    });
    reply.code(201); return row;
  });
  app.patch('/api/v1/categories/:id', { config: access.perm('productos.edit'),
    schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { ...catBody, active: { type: 'boolean' } } } } }, async (req) => {
    const b = req.body; const cid = req.params.id;
    return withTransaction(pool, async (tx) => {
      const { rows: cur } = await tx.query('SELECT * FROM product_categories WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [cid]);
      if (!cur.length) throw notFound('Categoría no encontrada');
      if (b.coverMediaId) await S.assertMedia(tx, [b.coverMediaId]);
      const map = { name: 'name', description: 'description', coverMediaId: 'cover_media_id', sortOrder: 'sort_order', active: 'active' };
      const sets = []; const args = [cid];
      for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { args.push(typeof b[k] === 'string' ? b[k].trim() : b[k]); sets.push(`${col} = $${args.length}`); }
      await tx.query(`UPDATE product_categories SET ${sets.join(', ')} WHERE id = $1`, args);
      await audit(tx, req, { action: 'category.updated', entity: 'category', entityId: cid,
        before: { name: cur[0].name, description: cur[0].description, active: cur[0].active, sortOrder: cur[0].sort_order, coverMediaId: cur[0].cover_media_id }, after: b });
      return { ok: true };
    });
  });
  app.delete('/api/v1/categories/:id', { config: access.perm('productos.delete'), schema: { params: idParams } }, async (req) => {
    const cid = req.params.id;
    return withTransaction(pool, async (tx) => {
      const { rows } = await tx.query('SELECT name FROM product_categories WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [cid]);
      if (!rows.length) throw notFound('Categoría no encontrada');
      const n = (await tx.query('SELECT count(*)::int AS n FROM products WHERE category_id = $1 AND archived_at IS NULL', [cid])).rows[0].n;
      if (n) throw conflict(`La categoría tiene ${n} producto(s). Movelos o archivalos antes.`, 'CATEGORY_NOT_EMPTY', { products: n });
      await tx.query('UPDATE product_categories SET archived_at = now(), active = false WHERE id = $1', [cid]);
      await audit(tx, req, { action: 'category.archived', entity: 'category', entityId: cid, before: { name: rows[0].name } });
      return { ok: true };
    });
  });

  /* ───────── Productos ───────── */
  const SORTS = { name: 'p.name', created: 'p.created_at', updated: 'p.updated_at', order: 'p.sort_order' };
  app.get('/api/v1/products', { config: access.perm('productos.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    categoryId: id, stockable: { type: 'boolean' }, kind: { type: 'string', enum: KINDS }, status: { type: 'string', enum: ['all', 'published', 'inactive', 'review', 'archived'], default: 'all' },
    sort: { type: 'string', enum: Object.keys(SORTS), default: 'order' }, dir: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    const add = (sql, v) => { args.push(v); conds.push(sql.replace('?', `$${args.length}`)); };
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); const n = args.length; conds.push(`(p.name ILIKE $${n} OR p.legacy_id ILIKE $${n} OR p.sku ILIKE $${n})`); }
    if (q.categoryId) add('p.category_id = ?', q.categoryId);
    if (q.stockable !== undefined) add('p.is_stockable = ?', q.stockable);
    if (q.kind) add('p.kind = ?', q.kind);
    const st = { published: 'p.archived_at IS NULL AND NOT p.needs_review AND p.active', inactive: 'p.archived_at IS NULL AND NOT p.needs_review AND NOT p.active',
      review: 'p.archived_at IS NULL AND p.needs_review', archived: 'p.archived_at IS NOT NULL' }[q.status];
    if (st) conds.push(st); else if (q.status === 'all') conds.push('p.archived_at IS NULL');
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS n FROM products p ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(
      `SELECT p.id, p.legacy_id, p.name, p.kind, p.unit, p.is_stockable, p.active, p.needs_review, p.archived_at, p.sort_order, p.updated_at, c.id AS cat_id, c.name AS cat_name,
              (SELECT count(*) FROM product_variants v WHERE v.product_id = p.id AND v.active)::int AS variants,
              (SELECT min(price_pyg) FROM product_variants v WHERE v.product_id = p.id AND v.active) AS price_from,
              (SELECT max(price_pyg) FROM product_variants v WHERE v.product_id = p.id AND v.active) AS price_to,
              t.storage, t.storage_key
         FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
         LEFT JOIN LATERAL (SELECT m.storage, m.storage_key FROM product_media pm JOIN media m ON m.id = pm.media_id AND m.archived_at IS NULL WHERE pm.product_id = p.id ORDER BY pm.sort_order, m.id LIMIT 1) t ON true
         ${where} ORDER BY ${SORTS[q.sort]} ${q.dir === 'desc' ? 'DESC' : 'ASC'}, p.id LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((p) => ({ id: p.id, legacyId: p.legacy_id, name: p.name, kind: p.kind, unit: p.unit, stockable: p.is_stockable, status: S.statusOf(p), category: p.cat_id ? { id: p.cat_id, name: p.cat_name } : null,
      variants: p.variants, priceFrom: p.price_from, priceTo: p.price_to, thumbUrl: url(p), updatedAt: p.updated_at })), meta: meta(q, total) };
  });

  app.get('/api/v1/products/:id', { config: access.perm('productos.view'), schema: { params: idParams } }, async (req) => productDetail(pool, req.params.id));

  app.post('/api/v1/products', { config: access.perm('productos.create'), schema: { body: { type: 'object', required: ['name', 'categoryId'], additionalProperties: false, properties: {
    name: text(120), description: { type: ['string', 'null'], maxLength: 2000 }, categoryId: id, kind: { type: 'string', enum: KINDS, default: 'finished' }, sku: { type: ['string', 'null'], maxLength: 60 },
    variants: { type: 'array', minItems: 0, maxItems: 20, default: [], items: { type: 'object', required: ['label', 'pricePyg'], additionalProperties: false, properties: { label: text(60), pricePyg: price, sku: { type: ['string', 'null'], maxLength: 60 } } } },
    mediaIds: { type: 'array', maxItems: 12, uniqueItems: true, items: id, default: [] }, publish: { type: 'boolean', default: false } } } } }, async (req, reply) => {
    const b = req.body;
    if (b.kind === 'finished' && !b.variants.length) throw badRequest('Un producto terminado necesita al menos una variante con precio', undefined, 'VARIANT_REQUIRED');
    if (new Set(b.variants.map((v) => v.label.trim().toLowerCase())).size !== b.variants.length) throw badRequest('Hay variantes con el mismo nombre', undefined, 'DUPLICATE_VARIANT');
    const out = await withTransaction(pool, async (tx) => {
      await S.assertCategory(tx, b.categoryId); await S.assertMedia(tx, b.mediaIds);
      const slug = await S.uniqueSlug(tx, 'products', b.name);
      const { rows } = await tx.query(
        `INSERT INTO products(slug, name, description, category_id, kind, sku, is_sellable, active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(max(sort_order),0)+1 FROM products)) RETURNING id`,
        [slug, b.name.trim(), b.description ?? null, b.categoryId, b.kind, b.sku || null, b.kind === 'finished', b.kind !== 'finished']);
      const pid = rows[0].id;
      for (const [i, v] of b.variants.entries()) {
        const vr = await tx.query('INSERT INTO product_variants(product_id, label, sku, price_pyg, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id', [pid, v.label.trim(), v.sku || null, v.pricePyg, i]);
        await tx.query(`INSERT INTO variant_price_history(variant_id, price_pyg, changed_by, reason) VALUES ($1,$2,$3,'precio inicial')`, [vr.rows[0].id, v.pricePyg, req.user.id]);
      }
      for (const [i, m] of b.mediaIds.entries()) await tx.query('INSERT INTO product_media(product_id, media_id, sort_order) VALUES ($1,$2,$3)', [pid, m, i]);
      if (b.publish) { await S.assertPublishable(tx, pid); await tx.query('UPDATE products SET active = true WHERE id = $1', [pid]); }
      const d = await productDetail(tx, pid);
      await audit(tx, req, { action: 'product.created', entity: 'product', entityId: pid, after: { ...snapshot(d), variants: d.variants.map((v) => ({ label: v.label, pricePyg: v.pricePyg })) } });
      return d;
    });
    reply.code(201); return out;
  });

  app.patch('/api/v1/products/:id', { config: access.perm('productos.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: {
    name: text(120), description: { type: ['string', 'null'], maxLength: 2000 }, categoryId: id, kind: { type: 'string', enum: KINDS }, sku: { type: ['string', 'null'], maxLength: 60 },
    sortOrder: { type: 'integer', minimum: 0, maximum: 1000000 }, active: { type: 'boolean' }, resolveReview: { type: 'boolean' } } } } }, async (req) => {
    const b = req.body; const pid = req.params.id;
    return withTransaction(pool, async (tx) => {
      const cur = await S.loadProduct(tx, pid, { lock: true });
      if (cur.archived_at) throw conflict('El producto está archivado. Restauralo primero.', 'ARCHIVED');
      const before = snapshot(await productDetail(tx, pid));
      if (b.categoryId !== undefined) await S.assertCategory(tx, b.categoryId);
      const map = { name: 'name', description: 'description', categoryId: 'category_id', kind: 'kind', sku: 'sku', sortOrder: 'sort_order' };
      const sets = []; const args = [pid];
      for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { args.push(typeof b[k] === 'string' ? (k === 'sku' ? b[k].trim() || null : b[k].trim()) : b[k]); sets.push(`${col} = $${args.length}`); }
      if (b.kind !== undefined) sets.push(`is_sellable = ${b.kind === 'finished'}`);
      if (b.resolveReview) sets.push('needs_review = false', 'review_note = NULL');
      if (sets.length) await tx.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $1`, args);
      if (b.active === true) { await S.assertPublishable(tx, pid); await tx.query('UPDATE products SET active = true WHERE id = $1', [pid]); }
      else if (b.active === false) await tx.query('UPDATE products SET active = false WHERE id = $1', [pid]);
      else if (b.categoryId === undefined && cur.active && b.kind !== undefined) await S.assertPublishable(tx, pid);
      const d = await productDetail(tx, pid);
      await audit(tx, req, { action: b.active !== undefined && Object.keys(b).length === 1 ? (b.active ? 'product.published' : 'product.unpublished') : 'product.updated',
        entity: 'product', entityId: pid, before, after: { ...snapshot(d), ...(b.resolveReview ? { reviewResolved: true } : {}) } });
      return d;
    });
  });

  // Los productos no se borran: se archivan (conservan historial de precios y futuras ventas).
  app.delete('/api/v1/products/:id', { config: access.perm('productos.delete'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const cur = await S.loadProduct(tx, req.params.id, { lock: true });
    if (cur.archived_at) throw conflict('El producto ya está archivado', 'ARCHIVED');
    await tx.query('UPDATE products SET archived_at = now(), active = false WHERE id = $1', [cur.id]);
    await audit(tx, req, { action: 'product.archived', entity: 'product', entityId: cur.id, before: { name: cur.name, status: S.statusOf(cur) } });
    return { ok: true };
  }));
  app.post('/api/v1/products/:id/restore', { config: access.perm('productos.edit'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const cur = await S.loadProduct(tx, req.params.id, { lock: true });
    if (!cur.archived_at) throw conflict('El producto no está archivado', 'NOT_ARCHIVED');
    await tx.query('UPDATE products SET archived_at = NULL, active = false WHERE id = $1', [cur.id]); // vuelve como borrador
    await audit(tx, req, { action: 'product.restored', entity: 'product', entityId: cur.id });
    return productDetail(tx, cur.id);
  }));

  /* ───────── Variantes y precios ───────── */
  app.post('/api/v1/products/:id/variants', { config: access.perm('productos.edit'), schema: { params: idParams,
    body: { type: 'object', required: ['label', 'pricePyg'], additionalProperties: false, properties: { label: text(60), pricePyg: price, sku: { type: ['string', 'null'], maxLength: 60 } } } } }, async (req, reply) => {
    const b = req.body; const pid = req.params.id;
    const out = await withTransaction(pool, async (tx) => {
      const p = await S.loadProduct(tx, pid, { lock: true });
      if (p.archived_at) throw conflict('El producto está archivado', 'ARCHIVED');
      const { rows } = await tx.query(
        `INSERT INTO product_variants(product_id, label, sku, price_pyg, sort_order) VALUES ($1,$2,$3,$4,(SELECT COALESCE(max(sort_order),-1)+1 FROM product_variants WHERE product_id=$1)) RETURNING id`,
        [pid, b.label.trim(), b.sku || null, b.pricePyg]);
      await tx.query(`INSERT INTO variant_price_history(variant_id, price_pyg, changed_by, reason) VALUES ($1,$2,$3,'precio inicial')`, [rows[0].id, b.pricePyg, req.user.id]);
      await audit(tx, req, { action: 'variant.created', entity: 'variant', entityId: rows[0].id, after: { productId: pid, label: b.label.trim(), pricePyg: b.pricePyg } });
      return productDetail(tx, pid);
    });
    reply.code(201); return out;
  });

  app.patch('/api/v1/variants/:id', { config: access.perm('productos.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: {
    label: text(60), pricePyg: price, sku: { type: ['string', 'null'], maxLength: 60 }, active: { type: 'boolean' }, sortOrder: { type: 'integer', minimum: 0, maximum: 1000 }, reason: { type: 'string', maxLength: 200 } } } } }, async (req) => {
    const b = req.body; const vid = req.params.id;
    return withTransaction(pool, async (tx) => {
      const { rows } = await tx.query(
        `SELECT v.*, p.archived_at, p.active AS product_active FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1 FOR UPDATE OF v`, [vid]);
      if (!rows.length) throw notFound('Variante no encontrada');
      const v = rows[0];
      if (v.archived_at) throw conflict('El producto está archivado', 'ARCHIVED');
      const map = { label: 'label', pricePyg: 'price_pyg', sku: 'sku', active: 'active', sortOrder: 'sort_order' };
      const sets = []; const args = [vid];
      for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { args.push(k === 'label' ? b[k].trim() : k === 'sku' ? (b[k] || null) : b[k]); sets.push(`${col} = $${args.length}`); }
      if (sets.length) await tx.query(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = $1`, args);
      if (v.product_active && (b.active === false)) {
        const left = (await tx.query('SELECT count(*)::int AS n FROM product_variants WHERE product_id = $1 AND active', [v.product_id])).rows[0].n;
        if (!left) throw conflict('Un producto publicado necesita al menos una variante activa. Despublicá el producto primero.', 'LAST_VARIANT');
      }
      const priceChanged = b.pricePyg !== undefined && b.pricePyg !== v.price_pyg;
      if (priceChanged) await tx.query('INSERT INTO variant_price_history(variant_id, price_pyg, changed_by, reason) VALUES ($1,$2,$3,$4)', [vid, b.pricePyg, req.user.id, b.reason || null]);
      await audit(tx, req, { action: priceChanged ? 'variant.price_changed' : 'variant.updated', entity: 'variant', entityId: vid,
        before: { label: v.label, pricePyg: v.price_pyg, active: v.active }, after: { ...b } });
      return productDetail(tx, v.product_id);
    });
  });

  app.get('/api/v1/variants/:id/price-history', { config: access.perm('productos.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(
      `SELECT h.id, h.price_pyg, h.valid_from, h.reason, u.full_name FROM variant_price_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.variant_id = $1 ORDER BY h.valid_from DESC, h.id DESC`, [req.params.id]);
    return { data: rows.map((r) => ({ id: r.id, pricePyg: r.price_pyg, validFrom: r.valid_from, reason: r.reason, changedBy: r.full_name })) };
  });

  /* ───────── Imágenes del producto (orden = orden de la lista) ───────── */
  app.put('/api/v1/products/:id/media', { config: access.perm('productos.edit'), schema: { params: idParams,
    body: { type: 'object', required: ['mediaIds'], additionalProperties: false, properties: { mediaIds: { type: 'array', maxItems: 12, uniqueItems: true, items: id } } } } }, async (req) => {
    const pid = req.params.id; const ids = req.body.mediaIds;
    return withTransaction(pool, async (tx) => {
      const p = await S.loadProduct(tx, pid, { lock: true });
      if (p.archived_at) throw conflict('El producto está archivado', 'ARCHIVED');
      await S.assertMedia(tx, ids);
      if (p.active && !ids.length) throw conflict('Un producto publicado necesita al menos una imagen', 'PRODUCT_INCOMPLETE', { missing: ['al menos una imagen'] });
      const before = (await tx.query('SELECT media_id FROM product_media WHERE product_id = $1 ORDER BY sort_order', [pid])).rows.map((r) => r.media_id);
      await tx.query('DELETE FROM product_media WHERE product_id = $1', [pid]);
      for (const [i, m] of ids.entries()) await tx.query('INSERT INTO product_media(product_id, media_id, sort_order) VALUES ($1,$2,$3)', [pid, m, i]);
      await audit(tx, req, { action: 'product.media_set', entity: 'product', entityId: pid, before: { mediaIds: before }, after: { mediaIds: ids } });
      return productDetail(tx, pid);
    });
  });
};
