'use strict';
const crypto = require('node:crypto');
const access = require('../../lib/access');
const { priceText } = require('../../lib/money');
const { legacyPath } = require('../media/urls');

/**
 * API pública del catálogo. Devuelve la MISMA forma que `window.SERAFINA_CATALOGO` (secciones/productos) para que
 * el sitio actual pueda consumirla sin reescribirse, más los datos numéricos (variantes) que el sitio viejo no tiene.
 */
module.exports = async function catalogRoutes(app) {
  const { pool } = app;

  async function buildCatalog() {
    const cats = (await pool.query(
      `SELECT c.slug, c.name, c.description, m.storage, m.storage_key
         FROM product_categories c LEFT JOIN media m ON m.id = c.cover_media_id AND m.archived_at IS NULL
        WHERE c.active AND c.archived_at IS NULL ORDER BY c.sort_order, c.id`)).rows;
    const prods = (await pool.query(
      `SELECT p.id, p.legacy_id, p.slug, p.name, p.description, c.slug AS category
         FROM products p JOIN product_categories c ON c.id = p.category_id AND c.active AND c.archived_at IS NULL
        WHERE p.active AND p.archived_at IS NULL AND NOT p.needs_review AND p.is_sellable
        ORDER BY c.sort_order, c.id, p.sort_order, p.id`)).rows;
    const ids = prods.map((p) => p.id);
    const vars = (await pool.query(
      `SELECT id, product_id, label, price_pyg FROM product_variants WHERE active AND product_id = ANY($1::bigint[]) ORDER BY product_id, sort_order, id`, [ids])).rows;
    const photos = (await pool.query(
      `SELECT pm.product_id, m.storage, m.storage_key FROM product_media pm JOIN media m ON m.id = pm.media_id AND m.archived_at IS NULL AND m.is_public
        WHERE pm.product_id = ANY($1::bigint[]) ORDER BY pm.product_id, pm.sort_order`, [ids])).rows;

    const vBy = new Map(); for (const v of vars) (vBy.get(v.product_id) || vBy.set(v.product_id, []).get(v.product_id)).push({ id: v.id, label: v.label, pricePyg: v.price_pyg });
    const fBy = new Map(); for (const f of photos) (fBy.get(f.product_id) || fBy.set(f.product_id, []).get(f.product_id)).push(legacyPath(app, f));

    return {
      secciones: cats.map((c) => ({ id: c.slug, titulo: c.name, descripcion: c.description || '', foto: c.storage_key ? legacyPath(app, c) : '' })),
      productos: prods.filter((p) => vBy.has(p.id)).map((p) => {
        const variantes = vBy.get(p.id);
        return { id: p.legacy_id || String(p.id), slug: p.slug, seccion: p.category, nombre: p.name, precio: priceText(variantes),
          descripcion: p.description || '', fotos: fBy.get(p.id) || [], variantes };
      }),
    };
  }

  app.get('/api/v1/public/catalog', { config: access.public }, async (req, reply) => {
    const body = JSON.stringify(await buildCatalog());
    const etag = '"' + crypto.createHash('sha1').update(body).digest('base64url') + '"';
    reply.header('Cache-Control', 'public, max-age=60').header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(body);
  });
};
