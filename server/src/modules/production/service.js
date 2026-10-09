'use strict';
const { conflict, notFound, badRequest } = require('../../lib/errors');
const inv = require('../inventory/service');
const { audit } = require('../audit/audit');
const orders = require('../orders/service');

async function loadProd(tx, id) {
  const { rows } = await tx.query('SELECT p.*, o.status AS order_status, o.number AS order_number FROM production_orders p JOIN orders o ON o.id = p.order_id WHERE p.id = $1 FOR UPDATE OF p', [id]);
  if (!rows.length) throw notFound('Orden de producción no encontrada');
  return rows[0];
}
async function checklist(tx, id) { return (await tx.query('SELECT code, step, done, done_at, done_by FROM production_checklist WHERE production_order_id = $1 ORDER BY position', [id])).rows; }

/** Qué materiales consume una orden de producción (según receta o stock propio). */
async function materialsFor(tx, p) {
  const { rows: v } = await tx.query('SELECT v.recipe_enabled, pr.id AS product_id, pr.is_stockable FROM product_variants v JOIN products pr ON pr.id = v.product_id WHERE v.id = $1', [p.variant_id]);
  const { rows: comps } = v[0].recipe_enabled ? await tx.query('SELECT component_product_id AS product_id, qty FROM recipe_components WHERE variant_id = $1', [p.variant_id]) : { rows: [] };
  let needs = []; let extras = 0; let kind = 'none';
  if (comps.length) {
    kind = 'recipe'; needs = comps.map((c) => ({ productId: c.product_id, milli: inv.toMilli(c.qty) * p.qty }));
    extras = Number((await tx.query('SELECT COALESCE(sum(amount_pyg), 0)::bigint AS s FROM recipe_extra_costs WHERE variant_id = $1', [p.variant_id])).rows[0].s) * p.qty;
  } else if (v[0].is_stockable) { kind = 'stock'; needs = [{ productId: v[0].product_id, milli: p.qty * 1000 }]; }
  return { kind, needs: needs.sort((a, b) => a.productId - b.productId), extrasPyg: extras };
}

/** pendiente → en_preparación: consume las reservas (stock físico baja, reserva se libera) y congela el costo real. */
async function startProduction(tx, req, id) {
  const p = await loadProd(tx, id);
  if (p.status !== 'pendiente') throw conflict('La producción ya fue iniciada', 'INVALID_STATE', { status: p.status });
  if (!orders.RESERVED.includes(p.order_status)) throw conflict('El pedido todavía no está confirmado', 'ORDER_NOT_CONFIRMED', { status: p.order_status });
  const locationId = await inv.defaultLocationId(tx);
  const m = await materialsFor(tx, p); let cost = m.extrasPyg; let known = m.kind !== 'none';
  for (const n of m.needs) {
    const r = await inv.consumeStock(tx, { productId: n.productId, locationId, qty: n.milli / 1000, type: 'produccion', reason: `Pedido ${p.order_number}`, referenceType: 'production_order', referenceId: p.id, userId: req.user.id, useReserved: true });
    cost += r.totalCostPyg; if (r.movements.some((x) => x.unitCostPyg === 0)) known = false;
    await tx.query(`UPDATE stock_reservations SET qty = qty - $3,
                      status = CASE WHEN qty - $3 <= 0 THEN 'consumed' ELSE status END, closed_at = CASE WHEN qty - $3 <= 0 THEN now() ELSE NULL END
                    WHERE order_id = $1 AND product_id = $2 AND status = 'active'`, [p.order_id, n.productId, inv.fromMilli(n.milli)]);
  }
  await tx.query(`UPDATE production_orders SET status = 'en_preparacion', started_at = now(), cost_total_pyg = $2, cost_known = $3 WHERE id = $1`, [id, cost, known]);
  const o = await orders.loadOrder(tx, p.order_id);
  if (['confirmado', 'pendiente_pago', 'pagado'].includes(o.status)) await orders.setStatus(tx, o, 'en_preparacion', req.user.id, `Producción de ${p.description}`);
  await audit(tx, req, { action: 'production.started', entity: 'production_order', entityId: id, after: { order: p.order_number, costPyg: cost, costKnown: known, materials: m.needs.length } });
}

async function setChecklist(tx, req, id, code, done) {
  const p = await loadProd(tx, id);
  if (!['en_preparacion', 'control_calidad'].includes(p.status)) throw conflict('El checklist se completa mientras se prepara el pedido', 'INVALID_STATE', { status: p.status });
  if (code === 'calidad' || code === 'listo') throw conflict('Control de calidad y “listo” se registran con sus propias acciones', 'RESERVED_STEP');
  const r = await tx.query('UPDATE production_checklist SET done = $3, done_by = CASE WHEN $3 THEN $4::bigint ELSE NULL END, done_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE production_order_id = $1 AND code = $2', [id, code, done, req.user.id]);
  if (!r.rowCount) throw notFound('Paso de checklist inexistente');
  await audit(tx, req, { action: 'production.checklist', entity: 'production_order', entityId: id, after: { step: code, done } });
}

const NEEDED_BEFORE_QC = ['materiales', 'flores', 'armado', 'envoltorio', 'tarjeta'];
async function toQuality(tx, req, id) {
  const p = await loadProd(tx, id);
  if (p.status !== 'en_preparacion') throw conflict('Solo se pasa a control de calidad desde “en preparación”', 'INVALID_STATE', { status: p.status });
  const missing = (await checklist(tx, id)).filter((c) => NEEDED_BEFORE_QC.includes(c.code) && !c.done).map((c) => c.step);
  if (missing.length) throw conflict(`Faltan pasos del checklist: ${missing.join(', ')}`, 'CHECKLIST_INCOMPLETE', { missing });
  await tx.query(`UPDATE production_orders SET status = 'control_calidad', quality_at = now() WHERE id = $1`, [id]);
  await audit(tx, req, { action: 'production.quality_check', entity: 'production_order', entityId: id });
}
async function approve(tx, req, id) {
  const p = await loadProd(tx, id);
  if (p.status !== 'control_calidad') throw conflict('Solo se aprueba desde control de calidad', 'INVALID_STATE', { status: p.status });
  await tx.query(`UPDATE production_checklist SET done = true, done_by = $2, done_at = now() WHERE production_order_id = $1 AND code IN ('calidad','listo')`, [id, req.user.id]);
  await tx.query(`UPDATE production_orders SET status = 'listo', ready_at = now() WHERE id = $1`, [id]);
  const { rows: pend } = await tx.query(`SELECT count(*)::int AS n FROM production_orders WHERE order_id = $1 AND status NOT IN ('listo','cancelado')`, [p.order_id]);
  let orderReady = false;
  if (pend[0].n === 0) {
    const o = await orders.loadOrder(tx, p.order_id);
    await orders.setStatus(tx, o, o.status === 'reprogramado' ? 'reprogramado' : 'listo', req.user.id, 'Producción terminada');
    await tx.query(`UPDATE deliveries SET status = 'listo' WHERE order_id = $1 AND status IN ('pendiente','asignado')`, [p.order_id]);
    orderReady = true;
  }
  await audit(tx, req, { action: 'production.ready', entity: 'production_order', entityId: id, after: { order: p.order_number, orderReady } });
  return { orderReady };
}
async function reject(tx, req, id, note) {
  const p = await loadProd(tx, id);
  if (p.status !== 'control_calidad') throw conflict('Solo se rechaza desde control de calidad', 'INVALID_STATE', { status: p.status });
  await tx.query(`UPDATE production_checklist SET done = false, done_by = NULL, done_at = NULL WHERE production_order_id = $1 AND code IN ('calidad','listo','armado')`, [id]);
  await tx.query(`UPDATE production_orders SET status = 'en_preparacion', notes = $2 WHERE id = $1`, [id, note]);
  await audit(tx, req, { action: 'production.rejected', entity: 'production_order', entityId: id, after: { note } });
}
async function assign(tx, req, id, userId) {
  const p = await loadProd(tx, id);
  if (userId) { const { rows } = await tx.query('SELECT id FROM users WHERE id = $1 AND active', [userId]); if (!rows.length) throw badRequest('Usuario inexistente o inactivo', undefined, 'UNKNOWN_USER'); }
  await tx.query('UPDATE production_orders SET assigned_to = $2 WHERE id = $1', [id, userId ?? null]);
  await audit(tx, req, { action: 'production.assigned', entity: 'production_order', entityId: id, before: { assignedTo: p.assigned_to }, after: { assignedTo: userId ?? null } });
}
module.exports = { loadProd, checklist, materialsFor, startProduction, setChecklist, toQuality, approve, reject, assign };
