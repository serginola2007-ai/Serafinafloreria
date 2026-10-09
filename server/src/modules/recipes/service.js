'use strict';
const { notFound } = require('../../lib/errors');

const lineCost = (qty, avg) => Number((BigInt(Math.round(qty * 1000)) * BigInt(avg) + 500n) / 1000n);

/** Receta de una variante con costos, margen y cuántas unidades se pueden armar con el stock disponible. */
async function loadRecipe(db, variantId) {
  const { rows: vr } = await db.query(
    `SELECT v.id, v.label, v.price_pyg, v.recipe_enabled, p.id AS product_id, p.name AS product_name
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [variantId]);
  if (!vr.length) throw notFound('Variante no encontrada');
  const v = vr[0];
  const { rows: comps } = await db.query(
    `SELECT rc.component_product_id AS product_id, p.name, p.unit, p.avg_cost_pyg, p.is_stockable, rc.qty,
            COALESCE((SELECT sum(on_hand - reserved) FROM inventory_levels l WHERE l.product_id = p.id), 0) AS available
       FROM recipe_components rc JOIN products p ON p.id = rc.component_product_id WHERE rc.variant_id = $1 ORDER BY p.name`, [variantId]);
  const { rows: extras } = await db.query('SELECT id, concept, amount_pyg FROM recipe_extra_costs WHERE variant_id = $1 ORDER BY id', [variantId]);
  const components = comps.map((c) => ({ productId: c.product_id, name: c.name, unit: c.unit, qty: c.qty, avgCostPyg: c.avg_cost_pyg, lineCostPyg: lineCost(c.qty, c.avg_cost_pyg),
    available: Number(c.available), costKnown: c.avg_cost_pyg > 0 }));
  const componentCostPyg = components.reduce((a, c) => a + c.lineCostPyg, 0);
  const extrasPyg = extras.reduce((a, e) => a + e.amount_pyg, 0);
  const totalCostPyg = componentCostPyg + extrasPyg;
  const hasRecipe = components.length > 0;
  return {
    variantId: v.id, label: v.label, productId: v.product_id, productName: v.product_name, enabled: v.recipe_enabled, hasRecipe,
    components, extras: extras.map((e) => ({ id: e.id, concept: e.concept, amountPyg: e.amount_pyg })),
    componentCostPyg, extrasPyg, totalCostPyg, pricePyg: v.price_pyg,
    marginPyg: hasRecipe ? v.price_pyg - totalCostPyg : null,
    marginPct: hasRecipe && v.price_pyg > 0 ? Math.round(((v.price_pyg - totalCostPyg) / v.price_pyg) * 1000) / 10 : null,
    costComplete: hasRecipe && components.every((c) => c.costKnown),
    buildable: hasRecipe ? Math.max(0, Math.min(...comps.map((c) => Math.floor(Number((c.available / c.qty).toFixed(6)))))) : null,
  };
}

module.exports = { loadRecipe, lineCost };
