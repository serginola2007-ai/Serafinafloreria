'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const inv = require('../inventory/service');
const { loadRecipe } = require('./service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const recipeBody = { type: 'object', required: ['components'], additionalProperties: false, properties: {
  enabled: { type: 'boolean' },
  components: { type: 'array', maxItems: 60, items: { type: 'object', required: ['productId', 'qty'], additionalProperties: false, properties: { productId: id, qty: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 } } } },
  extras: { type: 'array', maxItems: 20, default: [], items: { type: 'object', required: ['concept', 'amountPyg'], additionalProperties: false, properties: { concept: { type: 'string', minLength: 1, maxLength: 80 }, amountPyg: { type: 'integer', minimum: 0, maximum: 1000000000000 } } } } } };

module.exports = async function recipesRoutes(app) {
  const { pool } = app;

  async function writeRecipe(tx, variantId, b) {
    const { rows } = await tx.query('SELECT v.id, v.product_id, v.recipe_enabled FROM product_variants v WHERE v.id = $1 FOR UPDATE', [variantId]);
    if (!rows.length) throw notFound('Variante no encontrada');
    const v = rows[0];
    if (new Set(b.components.map((c) => c.productId)).size !== b.components.length) throw badRequest('Un componente aparece más de una vez', undefined, 'DUPLICATE_COMPONENT');
    for (const c of b.components) inv.assertQty(c.qty, 'cantidad del componente');
    if (b.components.length) {
      const { rows: ps } = await tx.query('SELECT id, name, kind, is_stockable, archived_at FROM products WHERE id = ANY($1::bigint[])', [b.components.map((c) => c.productId)]);
      const by = new Map(ps.map((p) => [p.id, p]));
      for (const c of b.components) {
        const p = by.get(c.productId);
        if (!p || p.archived_at) throw badRequest('Hay componentes inexistentes o archivados', { productId: c.productId }, 'UNKNOWN_COMPONENT');
        if (p.id === v.product_id) throw badRequest('Un producto no puede ser componente de sí mismo', { productId: p.id }, 'SELF_COMPONENT');
        if (p.kind === 'finished') throw badRequest(`“${p.name}” es un producto terminado y no puede ser componente`, { productId: p.id }, 'INVALID_COMPONENT');
        if (!p.is_stockable) throw conflict(`“${p.name}” no está en inventario. Incorporalo primero para poder descontarlo.`, 'NOT_STOCKABLE', { productId: p.id });
      }
    }
    await tx.query('DELETE FROM recipe_components WHERE variant_id = $1', [variantId]);
    for (const c of [...b.components].sort((a, z) => a.productId - z.productId)) {
      await tx.query('INSERT INTO recipe_components(variant_id, component_product_id, qty) VALUES ($1,$2,$3)', [variantId, c.productId, inv.fromMilli(inv.toMilli(c.qty))]);
    }
    await tx.query('DELETE FROM recipe_extra_costs WHERE variant_id = $1', [variantId]);
    for (const e of b.extras ?? []) await tx.query('INSERT INTO recipe_extra_costs(variant_id, concept, amount_pyg) VALUES ($1,$2,$3)', [variantId, e.concept.trim(), e.amountPyg]);
    if (b.enabled !== undefined) await tx.query('UPDATE product_variants SET recipe_enabled = $2 WHERE id = $1', [variantId, b.enabled]);
    await tx.query(`UPDATE products SET is_composite = EXISTS (SELECT 1 FROM recipe_components rc JOIN product_variants pv ON pv.id = rc.variant_id WHERE pv.product_id = $1) WHERE id = $1`, [v.product_id]);
  }
  const snap = (r) => ({ enabled: r.enabled, components: r.components.map((c) => ({ productId: c.productId, qty: c.qty })), extras: r.extras.map((e) => ({ concept: e.concept, amountPyg: e.amountPyg })), totalCostPyg: r.totalCostPyg });

  app.get('/api/v1/variants/:id/recipe', { config: access.perm('productos.view'), schema: { params: idParams } }, async (req) => loadRecipe(pool, req.params.id));

  app.put('/api/v1/variants/:id/recipe', { config: access.perm('productos.edit'), schema: { params: idParams, body: recipeBody } }, async (req) => withTransaction(pool, async (tx) => {
    const before = await loadRecipe(tx, req.params.id);
    await writeRecipe(tx, req.params.id, req.body);
    const after = await loadRecipe(tx, req.params.id);
    await audit(tx, req, { action: 'recipe.updated', entity: 'variant', entityId: req.params.id, before: snap(before), after: snap(after) });
    return after;
  }));

  // Duplicar: copia la receta de otra variante (útil para tamaños M/G o arreglos parecidos).
  app.post('/api/v1/variants/:id/recipe/copy-from', { config: access.perm('productos.edit'), schema: { params: idParams, body: { type: 'object', required: ['sourceVariantId'], additionalProperties: false,
    properties: { sourceVariantId: id, factor: { type: 'number', exclusiveMinimum: 0, maximum: 100, default: 1 } } } } }, async (req) => withTransaction(pool, async (tx) => {
    const src = await loadRecipe(tx, req.body.sourceVariantId);
    if (!src.hasRecipe) throw conflict('La variante de origen no tiene receta', 'EMPTY_SOURCE');
    const f = req.body.factor;
    const before = await loadRecipe(tx, req.params.id);
    await writeRecipe(tx, req.params.id, { components: src.components.map((c) => ({ productId: c.productId, qty: Math.round(c.qty * f * 1000) / 1000 })), extras: src.extras.map((e) => ({ concept: e.concept, amountPyg: Math.round(e.amountPyg * f) })) });
    const after = await loadRecipe(tx, req.params.id);
    await audit(tx, req, { action: 'recipe.copied', entity: 'variant', entityId: req.params.id, before: snap(before), after: { ...snap(after), sourceVariantId: req.body.sourceVariantId, factor: f } });
    return after;
  }));

  // Costo y margen de todas las variantes de un producto (rentabilidad por arreglo).
  app.get('/api/v1/products/:id/costing', { config: access.perm('productos.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query('SELECT id FROM product_variants WHERE product_id = $1 ORDER BY sort_order, id', [req.params.id]);
    const data = [];
    for (const r of rows) { const x = await loadRecipe(pool, r.id); data.push({ variantId: x.variantId, label: x.label, pricePyg: x.pricePyg, hasRecipe: x.hasRecipe, enabled: x.enabled, totalCostPyg: x.totalCostPyg, marginPyg: x.marginPyg, marginPct: x.marginPct, costComplete: x.costComplete, buildable: x.buildable }); }
    return { data };
  });
};
