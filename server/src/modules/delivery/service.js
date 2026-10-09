'use strict';
const { badRequest, conflict, notFound, forbidden } = require('../../lib/errors');
const { audit } = require('../audit/audit');
const { loadAccess } = require('../rbac/service');
const orders = require('../orders/service');

async function loadDelivery(tx, id) {
  const { rows } = await tx.query('SELECT * FROM deliveries WHERE id = $1 FOR UPDATE', [id]);
  if (!rows.length) throw notFound('Entrega no encontrada');
  return rows[0];
}
/** Un repartidor (solo delivery.own) solo opera sus propias entregas; delivery.edit opera todas. */
function assertCanOperate(req, d) {
  if (req.permissions.has('delivery.edit')) return;
  if (req.permissions.has('delivery.own') && d.courier_id === req.user.id) return;
  throw forbidden('Esta entrega no está asignada a vos');
}
async function setDeliveryStatus(tx, d, to, fields = {}) {
  const sets = ['status = $2']; const args = [d.id, to];
  for (const [k, v] of Object.entries(fields)) { args.push(v); sets.push(`${k} = $${args.length}`); }
  await tx.query(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = $1`, args);
}

async function assign(tx, req, id, courierId) {
  const d = await loadDelivery(tx, id);
  if (['entregado', 'cancelado'].includes(d.status)) throw conflict('La entrega ya está cerrada', 'INVALID_STATE');
  if (courierId !== null) {
    const acc = await loadAccess(tx, courierId);
    const { rows } = await tx.query('SELECT active FROM users WHERE id = $1', [courierId]);
    if (!acc || !rows[0]?.active || !(acc.permissions.has('delivery.own') || acc.permissions.has('delivery.edit'))) throw badRequest('El usuario no puede hacer entregas', undefined, 'NOT_A_COURIER');
  }
  const next = courierId === null ? (d.status === 'asignado' ? 'pendiente' : d.status) : (d.status === 'pendiente' ? 'asignado' : d.status);
  await setDeliveryStatus(tx, d, next, { courier_id: courierId });
  await audit(tx, req, { action: 'delivery.assigned', entity: 'delivery', entityId: id, before: { courierId: d.courier_id }, after: { courierId } });
}

async function start(tx, req, id) {
  const d = await loadDelivery(tx, id); assertCanOperate(req, d);
  const o = await orders.loadOrder(tx, d.order_id);
  if (o.status !== 'listo' && o.status !== 'reprogramado' && o.status !== 'no_entregado') throw conflict('El pedido todavía no está listo para salir', 'ORDER_NOT_READY', { status: o.status });
  if (!d.courier_id) throw conflict('Asigná un repartidor antes de salir', 'NO_COURIER');
  if (!['listo', 'asignado'].includes(d.status) && !['reprogramado', 'no_entregado'].includes(d.status)) throw conflict('La entrega no se puede iniciar en este estado', 'INVALID_STATE', { status: d.status });
  await setDeliveryStatus(tx, d, 'en_camino', { left_at: new Date(), failure_reason: null });
  await orders.setStatus(tx, o, 'en_reparto', req.user.id);
  await audit(tx, req, { action: 'delivery.started', entity: 'delivery', entityId: id });
}

/** Entregado: cierra el pedido y genera la venta (con costo congelado desde producción). */
async function deliver(tx, req, id, { proofMediaId, creditDueDate }) {
  const d = await loadDelivery(tx, id); assertCanOperate(req, d);
  if (d.status !== 'en_camino') throw conflict('La entrega no está en camino', 'INVALID_STATE', { status: d.status });
  if (proofMediaId) {
    const { rows } = await tx.query('SELECT 1 FROM media WHERE id = $1 AND archived_at IS NULL', [proofMediaId]);
    if (!rows.length) throw badRequest('La foto de comprobante no existe', undefined, 'INVALID_MEDIA');
    await tx.query('UPDATE deliveries SET proof_media_id = $2 WHERE id = $1', [id, proofMediaId]);
  }
  const r = await orders.completeOrder(tx, req, d.order_id, { creditDueDate });
  await audit(tx, req, { action: 'delivery.delivered', entity: 'delivery', entityId: id, after: { saleId: r.saleId } });
  return r;
}

async function fail(tx, req, id, reason) {
  const d = await loadDelivery(tx, id); assertCanOperate(req, d);
  if (d.status !== 'en_camino') throw conflict('La entrega no está en camino', 'INVALID_STATE', { status: d.status });
  const o = await orders.loadOrder(tx, d.order_id);
  await setDeliveryStatus(tx, d, 'no_entregado', { failure_reason: reason });
  await orders.setStatus(tx, o, 'no_entregado', req.user.id, reason);
  await audit(tx, req, { action: 'delivery.failed', entity: 'delivery', entityId: id, after: { reason } });
}

async function reschedule(tx, req, id, { date, timeSlot, reason }) {
  const d = await loadDelivery(tx, id); assertCanOperate(req, d);
  if (['entregado', 'cancelado'].includes(d.status)) throw conflict('La entrega ya está cerrada', 'INVALID_STATE');
  const o = await orders.loadOrder(tx, d.order_id);
  if (!['listo', 'en_reparto', 'no_entregado', 'reprogramado', 'en_preparacion', 'confirmado', 'pagado'].includes(o.status)) throw conflict('El pedido no se puede reprogramar en este estado', 'INVALID_STATE', { status: o.status });
  await tx.query('UPDATE orders SET requested_date = $2, time_slot = $3 WHERE id = $1', [o.id, date, timeSlot ?? null]);
  const wasReady = ['listo', 'en_reparto', 'no_entregado', 'reprogramado'].includes(o.status);
  await setDeliveryStatus(tx, d, wasReady ? 'reprogramado' : d.status, { scheduled_date: date, time_slot: timeSlot ?? null, route_id: null, route_position: null });
  if (wasReady) await orders.setStatus(tx, o, 'reprogramado', req.user.id, reason);
  await audit(tx, req, { action: 'delivery.rescheduled', entity: 'delivery', entityId: id, before: { date: d.scheduled_date }, after: { date, timeSlot, reason } });
}

module.exports = { loadDelivery, assign, start, deliver, fail, reschedule, assertCanOperate };
