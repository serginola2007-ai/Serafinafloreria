'use strict';
/**
 * Pedidos: ciclo de vida, reserva de stock, pagos, cancelación y cierre (entrega → venta).
 * Toda operación corre dentro de la transacción del llamador; las funciones nunca abren la suya.
 */
const { badRequest, conflict, notFound } = require('../../lib/errors');
const { nextNumber } = require('../../lib/sequences');
const inv = require('../inventory/service');
const cash = require('../cash/service');
const { audit } = require('../audit/audit');
const sales = require('../sales/service');

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const today = () => new Date().toISOString().slice(0, 10);

const CHECKLIST = [['materiales', 'Materiales preparados'], ['flores', 'Flores seleccionadas'], ['armado', 'Armado'], ['envoltorio', 'Envoltorio'], ['tarjeta', 'Tarjeta'], ['calidad', 'Control de calidad'], ['listo', 'Listo']];
/** Estados desde los que el pedido todavía admite cambios de contenido (antes de que empiece la producción). */
const EDITABLE = ['consulta', 'cotizacion', 'pendiente', 'confirmado', 'pendiente_pago', 'pagado'];
const RESERVED = ['confirmado', 'pendiente_pago', 'pagado', 'en_preparacion', 'listo', 'en_reparto', 'reprogramado', 'no_entregado'];

async function history(tx, orderId, from, to, userId, note = null) {
  await tx.query('INSERT INTO order_status_history(order_id, from_status, to_status, user_id, note) VALUES ($1,$2,$3,$4,$5)', [orderId, from, to, userId ?? null, note]);
}
async function setStatus(tx, order, to, userId, note) {
  if (order.status === to) return;
  await tx.query('UPDATE orders SET status = $2 WHERE id = $1', [order.id, to]);
  await history(tx, order.id, order.status, to, userId, note);
  order.status = to;
}
async function loadOrder(tx, id, { lock = true } = {}) {
  const { rows } = await tx.query(`SELECT * FROM orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows.length) throw notFound('Pedido no encontrado');
  return rows[0];
}
const paidOf = async (tx, orderId) => Number((await tx.query('SELECT COALESCE(sum(amount_pyg), 0)::bigint AS s FROM payments WHERE order_id = $1', [orderId])).rows[0].s);

/** Ítems del pedido con los datos de variante que necesita el plan de consumo. */
async function itemsForPlan(tx, orderId) {
  const { rows: items } = await tx.query('SELECT id, variant_id, product_id, qty, description FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  const { rows: vrows } = await tx.query(
    `SELECT v.id, v.recipe_enabled, p.id AS product_id, p.is_stockable FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::bigint[])`, [items.map((i) => i.variant_id)]);
  return { items: items.map((i) => ({ ...i, variantId: i.variant_id })), variants: new Map(vrows.map((v) => [v.id, v])) };
}

/* ───────── Reserva de stock ───────── */
async function reserveStock(tx, orderId) {
  const locationId = await inv.defaultLocationId(tx);
  const { items, variants } = await itemsForPlan(tx, orderId);
  const { totals } = await sales.planConsumption(tx, variants, items);
  await sales.lockAndCheckStock(tx, totals, locationId);   // falla con el detalle de lo que falta
  for (const [pid, milli] of [...totals].sort((a, b) => a[0] - b[0])) {
    await tx.query(
      `INSERT INTO stock_reservations(order_id, product_id, location_id, qty) VALUES ($1,$2,$3,$4)
       ON CONFLICT (order_id, product_id) DO UPDATE SET qty = EXCLUDED.qty, status = 'active', closed_at = NULL`, [orderId, pid, locationId, inv.fromMilli(milli)]);
    await tx.query('UPDATE inventory_levels SET reserved = reserved + $3, updated_at = now() WHERE product_id = $1 AND location_id = $2', [pid, locationId, inv.fromMilli(milli)]);
  }
  return totals;
}
async function releaseReservations(tx, orderId) {
  const { rows } = await tx.query(`SELECT id, product_id, location_id, qty FROM stock_reservations WHERE order_id = $1 AND status = 'active' ORDER BY product_id FOR UPDATE`, [orderId]);
  for (const r of rows) {
    await tx.query('UPDATE inventory_levels SET reserved = reserved - $3, updated_at = now() WHERE product_id = $1 AND location_id = $2', [r.product_id, r.location_id, r.qty.toFixed(3)]);
    await tx.query(`UPDATE stock_reservations SET status = 'released', closed_at = now() WHERE id = $1`, [r.id]);
  }
  return rows.length;
}

/* ───────── Alta / edición ───────── */
async function resolveShipping(tx, b) {
  const out = { recipientId: b.recipientId ?? null, name: null, phone: null, address: null, zone: null, reference: null, zoneFee: null };
  if (b.recipientId) {
    const { rows } = await tx.query('SELECT * FROM recipients WHERE id = $1 AND archived_at IS NULL', [b.recipientId]);
    if (!rows.length) throw badRequest('Destinatario inexistente', undefined, 'UNKNOWN_RECIPIENT');
    Object.assign(out, { name: rows[0].name, phone: rows[0].phone, address: rows[0].address, zone: rows[0].zone, reference: rows[0].reference });
  }
  const s = b.shipping ?? {};
  for (const k of ['name', 'phone', 'address', 'zone', 'reference']) if (s[k] !== undefined) out[k] = (typeof s[k] === 'string' ? s[k].trim() : s[k]) || null;
  if (b.zoneId) {
    const { rows } = await tx.query('SELECT name, fee_pyg FROM delivery_zones WHERE id = $1 AND active', [b.zoneId]);
    if (!rows.length) throw badRequest('Zona de delivery inexistente', undefined, 'UNKNOWN_ZONE');
    out.zone = rows[0].name; out.zoneFee = rows[0].fee_pyg;
  }
  return out;
}

async function insertItems(tx, orderId, lines) {
  for (const l of lines) {
    await tx.query('INSERT INTO order_items(order_id, variant_id, product_id, description, qty, unit_price_pyg, discount_pyg, line_total_pyg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [orderId, l.v.id, l.v.product_id, l.description, l.qty, l.unit, l.discount, l.total]);
  }
}

async function createOrder(tx, req, b, { isPublic = false } = {}) {
  const status = b.status ?? 'pendiente';
  if (b.customerId) {
    if (!(await tx.query('SELECT 1 FROM customers WHERE id = $1 AND archived_at IS NULL', [b.customerId])).rowCount) throw badRequest('Cliente inexistente o archivado', undefined, 'UNKNOWN_CUSTOMER');
  } else if (status !== 'consulta') throw badRequest('El pedido necesita un cliente', undefined, 'CUSTOMER_REQUIRED');
  if (b.requestedDate && b.requestedDate < today() && status !== 'consulta') throw badRequest('La fecha de entrega no puede ser anterior a hoy', undefined, 'DATE_IN_PAST');
  const ship = await resolveShipping(tx, b);
  const fee = b.deliveryFeePyg ?? ((b.deliveryType ?? 'delivery') === 'delivery' ? ship.zoneFee ?? 0 : 0);
  const priced = await sales.priceLines(tx, req, { ...b, deliveryFeePyg: (b.deliveryType ?? 'delivery') === 'retiro' ? 0 : fee });
  const number = await nextNumber(tx, 'order', 'P');
  const { rows: [o] } = await tx.query(
    `INSERT INTO orders(number, customer_id, recipient_id, channel, status, delivery_type, requested_date, time_slot, ship_name, ship_phone, ship_address, ship_zone, ship_reference,
                        card_message, notes, subtotal_pyg, discount_pyg, delivery_fee_pyg, total_pyg, attribution_source, attribution_medium, attribution_campaign, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id, status`,
    [number, b.customerId ?? null, ship.recipientId, b.channel ?? 'mostrador', status, b.deliveryType ?? 'delivery', b.requestedDate ?? null, b.timeSlot?.trim() || null, ship.name, ship.phone, ship.address, ship.zone, ship.reference,
      b.cardMessage?.trim() || null, b.notes?.trim() || null, priced.subtotal, priced.discount, priced.delivery, priced.total, b.attribution?.source ?? null, b.attribution?.medium ?? null, b.attribution?.campaign ?? null, req.user?.id ?? null]);
  await insertItems(tx, o.id, priced.lines);
  await history(tx, o.id, null, status, req.user?.id, isPublic ? 'Pedido recibido desde la web' : null);
  await audit(tx, req, { action: isPublic ? 'order.created_web' : 'order.created', entity: 'order', entityId: o.id, after: { number, channel: b.channel ?? 'mostrador', status, totalPyg: priced.total, items: priced.lines.map((l) => ({ variantId: l.v.id, qty: l.qty })) } });
  return { id: o.id, number, totalPyg: priced.total };
}

/** Crea las órdenes de producción (una por línea) con su checklist estándar. */
async function createProduction(tx, orderId) {
  const { rows: items } = await tx.query('SELECT id, variant_id, qty, description FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  for (const it of items) {
    const { rows: [p] } = await tx.query('INSERT INTO production_orders(order_id, order_item_id, variant_id, description, qty) VALUES ($1,$2,$3,$4,$5) RETURNING id', [orderId, it.id, it.variant_id, it.description, it.qty]);
    for (const [i, [code, step]] of CHECKLIST.entries()) await tx.query('INSERT INTO production_checklist(production_order_id, position, code, step) VALUES ($1,$2,$3,$4)', [p.id, i, code, step]);
  }
}
async function ensureDelivery(tx, order) {
  if (order.delivery_type !== 'delivery') return;
  await tx.query(
    `INSERT INTO deliveries(order_id, status, scheduled_date, time_slot, recipient_name, recipient_phone, address, zone, reference) VALUES ($1,'pendiente',$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (order_id) DO UPDATE SET scheduled_date = EXCLUDED.scheduled_date, time_slot = EXCLUDED.time_slot, recipient_name = EXCLUDED.recipient_name, recipient_phone = EXCLUDED.recipient_phone, address = EXCLUDED.address, zone = EXCLUDED.zone, reference = EXCLUDED.reference`,
    [order.id, order.requested_date, order.time_slot, order.ship_name, order.ship_phone, order.ship_address, order.ship_zone, order.ship_reference]);
}

/** pendiente → confirmado: valida datos, RESERVA el stock y abre producción y entrega. */
async function confirmOrder(tx, req, orderId) {
  const o = await loadOrder(tx, orderId);
  if (o.status !== 'pendiente') throw conflict('Solo se puede confirmar un pedido pendiente', 'INVALID_STATE', { status: o.status });
  if (!o.customer_id) throw badRequest('El pedido necesita un cliente para confirmarse', undefined, 'CUSTOMER_REQUIRED');
  if (!o.requested_date) throw badRequest('Indicá la fecha de entrega', undefined, 'DATE_REQUIRED');
  if (o.delivery_type === 'delivery' && !o.ship_address) throw badRequest('Indicá la dirección de entrega', undefined, 'ADDRESS_REQUIRED');
  await reserveStock(tx, orderId);
  await createProduction(tx, orderId);
  await ensureDelivery(tx, o);
  const paid = await paidOf(tx, orderId);
  await setStatus(tx, o, paid >= o.total_pyg && o.total_pyg > 0 ? 'pagado' : 'confirmado', req.user.id);
  await audit(tx, req, { action: 'order.confirmed', entity: 'order', entityId: orderId, after: { status: o.status, reservedStock: true } });
  return o;
}

async function updateOrder(tx, req, orderId, b) {
  const o = await loadOrder(tx, orderId);
  if (!EDITABLE.includes(o.status)) throw conflict('El pedido ya está en producción o finalizado y no se puede modificar', 'NOT_EDITABLE', { status: o.status });
  const reserved = RESERVED.includes(o.status);
  if (reserved) {
    const { rows } = await tx.query(`SELECT 1 FROM production_orders WHERE order_id = $1 AND status <> 'pendiente'`, [orderId]);
    if (rows.length) throw conflict('La producción ya comenzó', 'PRODUCTION_STARTED');
  }
  if (b.requestedDate && b.requestedDate < today()) throw badRequest('La fecha de entrega no puede ser anterior a hoy', undefined, 'DATE_IN_PAST');
  const before = { total: o.total_pyg, items: (await tx.query('SELECT variant_id, qty FROM order_items WHERE order_id = $1 ORDER BY id', [orderId])).rows };
  const merged = { ...b, items: b.items ?? (await tx.query('SELECT variant_id AS "variantId", qty, discount_pyg AS "discountPyg" FROM order_items WHERE order_id = $1 ORDER BY id', [orderId])).rows };
  const ship = (b.recipientId !== undefined || b.shipping || b.zoneId) ? await resolveShipping(tx, { recipientId: b.recipientId ?? o.recipient_id, shipping: b.shipping, zoneId: b.zoneId }) : null;
  const dtype = b.deliveryType ?? o.delivery_type;
  const fee = dtype === 'retiro' ? 0 : (b.deliveryFeePyg ?? (b.zoneId && ship ? ship.zoneFee : o.delivery_fee_pyg));
  const oldLineDisc = Number((await tx.query('SELECT COALESCE(sum(discount_pyg), 0)::bigint AS s FROM order_items WHERE order_id = $1', [orderId])).rows[0].s);
  const priced = await sales.priceLines(tx, req, { ...merged, discountPyg: b.discountPyg ?? Math.max(0, o.discount_pyg - oldLineDisc), deliveryFeePyg: fee });
  if (reserved) await releaseReservations(tx, orderId);
  if (b.items) { await tx.query('DELETE FROM production_orders WHERE order_id = $1', [orderId]); await tx.query('DELETE FROM order_items WHERE order_id = $1', [orderId]); await insertItems(tx, orderId, priced.lines); }
  const sets = ['subtotal_pyg = $2', 'discount_pyg = $3', 'delivery_fee_pyg = $4', 'total_pyg = $5', 'delivery_type = $6']; const args = [orderId, priced.subtotal, priced.discount, priced.delivery, priced.total, dtype];
  const col = (c, v) => { args.push(v); sets.push(`${c} = $${args.length}`); };
  if (b.requestedDate !== undefined) col('requested_date', b.requestedDate); if (b.timeSlot !== undefined) col('time_slot', b.timeSlot?.trim() || null);
  if (b.cardMessage !== undefined) col('card_message', b.cardMessage?.trim() || null); if (b.notes !== undefined) col('notes', b.notes?.trim() || null); if (b.channel) col('channel', b.channel);
  if (b.customerId !== undefined) col('customer_id', b.customerId);
  if (ship) { col('recipient_id', ship.recipientId); col('ship_name', ship.name); col('ship_phone', ship.phone); col('ship_address', ship.address); col('ship_zone', ship.zone); col('ship_reference', ship.reference); }
  await tx.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $1`, args);
  const fresh = await loadOrder(tx, orderId);
  if (reserved) {
    await reserveStock(tx, orderId);
    if (b.items) await createProduction(tx, orderId);
    if (fresh.delivery_type === 'delivery') await ensureDelivery(tx, fresh); else await tx.query(`UPDATE deliveries SET status = 'cancelado' WHERE order_id = $1 AND status NOT IN ('entregado')`, [orderId]);
  }
  const paid = await paidOf(tx, orderId);
  if (paid > fresh.total_pyg) throw conflict('El nuevo total es menor que lo ya cobrado. Devolvé la diferencia antes de modificar.', 'TOTAL_BELOW_PAID', { paidPyg: paid, totalPyg: fresh.total_pyg });
  await audit(tx, req, { action: 'order.updated', entity: 'order', entityId: orderId, before, after: { total: fresh.total_pyg, items: b.items ?? undefined } });
  return fresh;
}

/* ───────── Pagos del pedido ───────── */
async function addOrderPayment(tx, req, orderId, { methodCode, amountPyg, reference }) {
  const o = await loadOrder(tx, orderId);
  if (['cancelado', 'entregado', 'consulta'].includes(o.status)) throw conflict('No se pueden registrar pagos en este estado', 'INVALID_STATE', { status: o.status });
  const paid = await paidOf(tx, orderId); const balance = o.total_pyg - paid;
  if (amountPyg > balance) throw conflict(`El pago supera el saldo pendiente (${balance})`, 'OVERPAYMENT', { balancePyg: balance });
  const m = (await sales.paymentMethods(tx, [methodCode])).get(methodCode);
  let cmId = null;
  if (m.affects_cash) { const s = await cash.requireOpenSession(tx); cmId = await cash.addCashMovement(tx, { sessionId: s.id, type: 'cobro', amountPyg, concept: `Cobro pedido ${o.number}`, referenceType: 'order', referenceId: orderId, userId: req.user.id }); }
  const { rows: [p] } = await tx.query('INSERT INTO payments(order_id, method_id, amount_pyg, reference, user_id, cash_movement_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [orderId, m.id, amountPyg, reference?.trim() || null, req.user.id, cmId]);
  if (balance - amountPyg === 0 && ['confirmado', 'pendiente_pago'].includes(o.status)) await setStatus(tx, o, 'pagado', req.user.id, 'Pago completo');
  await audit(tx, req, { action: 'order.payment_added', entity: 'order', entityId: orderId, after: { paymentId: p.id, method: methodCode, amountPyg, balanceAfterPyg: balance - amountPyg } });
  return { paymentId: p.id, balancePyg: balance - amountPyg };
}

/* ───────── Cancelación ───────── */
async function cancelOrder(tx, req, orderId, { reason, restock }) {
  const o = await loadOrder(tx, orderId);
  if (['cancelado', 'entregado', 'en_reparto'].includes(o.status)) throw conflict('El pedido no se puede cancelar en este estado', 'INVALID_STATE', { status: o.status });
  const { rows: prods } = await tx.query(`SELECT id, status, qty FROM production_orders WHERE order_id = $1 FOR UPDATE`, [orderId]);
  const consumedProds = prods.filter((p) => ['en_preparacion', 'control_calidad', 'listo'].includes(p.status));
  if (consumedProds.length && typeof restock !== 'boolean') throw badRequest('La producción ya consumió materiales: indicá si se reponen al stock (restock: true) o se registran como merma (restock: false)', undefined, 'RESTOCK_DECISION_REQUIRED');
  // pagos → devolución (contra-asientos)
  const { rows: pays } = await tx.query('SELECT p.*, m.affects_cash FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE p.order_id = $1 ORDER BY p.id', [orderId]);
  const session = pays.some((p) => p.affects_cash) ? await cash.requireOpenSession(tx) : null;
  for (const p of pays) {
    let cmId = null;
    if (p.affects_cash) cmId = await cash.addCashMovement(tx, { sessionId: session.id, type: 'devolucion', amountPyg: -p.amount_pyg, concept: `Cancelación pedido ${o.number}`, referenceType: 'order', referenceId: orderId, userId: req.user.id });
    await tx.query('INSERT INTO sale_refunds(order_id, payment_id, method_id, amount_pyg, reason, user_id, cash_movement_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [orderId, p.id, p.method_id, p.amount_pyg, reason, req.user.id, cmId]);
  }
  // materiales ya consumidos: reponer o registrar merma
  if (consumedProds.length) {
    const { rows: moves } = await tx.query(
      `SELECT m.product_id, m.location_id, -m.qty AS qty, m.unit_cost_pyg, l.expires_at FROM inventory_movements m LEFT JOIN inventory_lots l ON l.id = m.lot_id
        WHERE m.reference_type = 'production_order' AND m.type = 'produccion' AND m.reference_id = ANY($1::bigint[]) ORDER BY m.product_id, m.id`, [consumedProds.map((p) => p.id)]);
    if (restock) {
      for (const m of moves) await inv.receiveStock(tx, { productId: m.product_id, locationId: m.location_id, qty: m.qty, unitCostPyg: m.unit_cost_pyg, type: 'devolucion', reason: `Cancelación pedido ${o.number}`, referenceType: 'order_cancel', referenceId: orderId, userId: req.user.id, expiresAt: m.expires_at });
    } else {
      const { rows: [wr] } = await tx.query(`SELECT id FROM waste_reasons WHERE code = 'otro'`);
      for (const m of moves) {
        const cost = Number((BigInt(inv.toMilli(m.qty)) * BigInt(m.unit_cost_pyg) + 500n) / 1000n);
        await tx.query('INSERT INTO waste_records(product_id, location_id, reason_id, qty, cost_pyg, note, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [m.product_id, m.location_id, wr.id, inv.fromMilli(inv.toMilli(m.qty)), cost, `Cancelación del pedido ${o.number}: ${reason}`, req.user.id]);
      }
    }
  }
  await releaseReservations(tx, orderId);
  await tx.query(`UPDATE production_orders SET status = 'cancelado' WHERE order_id = $1`, [orderId]);
  await tx.query(`UPDATE deliveries SET status = 'cancelado', route_id = NULL, route_position = NULL WHERE order_id = $1 AND status <> 'entregado'`, [orderId]);
  await tx.query(`UPDATE orders SET cancel_reason = $2, cancelled_at = now(), cancelled_by = $3 WHERE id = $1`, [orderId, reason, req.user.id]);
  await setStatus(tx, o, 'cancelado', req.user.id, reason);
  await audit(tx, req, { action: 'order.cancelled', entity: 'order', entityId: orderId, after: { reason, refundedPyg: sum(pays.map((p) => p.amount_pyg)), materialsConsumed: consumedProds.length > 0, restock: consumedProds.length ? restock : null } });
  return { id: orderId, refundedPyg: sum(pays.map((p) => p.amount_pyg)) };
}

/* ───────── Cierre: entrega → VENTA ───────── */
async function completeOrder(tx, req, orderId, { creditDueDate } = {}) {
  const o = await loadOrder(tx, orderId);
  if (!['listo', 'en_reparto', 'reprogramado', 'no_entregado'].includes(o.status)) throw conflict('El pedido todavía no está listo para entregarse', 'INVALID_STATE', { status: o.status });
  const { rows: prods } = await tx.query(`SELECT * FROM production_orders WHERE order_id = $1 ORDER BY id`, [orderId]);
  if (prods.some((p) => p.status !== 'listo')) throw conflict('Hay productos sin terminar de producir', 'PRODUCTION_PENDING');
  const paid = await paidOf(tx, orderId); const balance = o.total_pyg - paid;
  if (balance > 0) {
    if (!o.customer_id) throw badRequest('El pedido tiene saldo pendiente y no tiene cliente', undefined, 'CREDIT_REQUIRES_CUSTOMER');
    if (!creditDueDate && !o.credit_due_date) throw conflict(`Queda un saldo de ${balance} Gs.: cobralo antes de entregar o indicá la fecha de vencimiento`, 'BALANCE_PENDING', { balancePyg: balance });
  }
  const session = await cash.currentSession(tx);
  const number = await nextNumber(tx, 'sale', 'V');
  const { rows: [sale] } = await tx.query(
    `INSERT INTO sales(number, customer_id, channel, subtotal_pyg, discount_pyg, delivery_fee_pyg, total_pyg, paid_pyg, credit_due_date, notes, cash_session_id, created_by, order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [number, o.customer_id, o.channel, o.subtotal_pyg, o.discount_pyg, o.delivery_fee_pyg, o.total_pyg, paid, balance > 0 ? (creditDueDate ?? o.credit_due_date) : null, `Pedido ${o.number}`, session?.id ?? null, req.user?.id ?? o.created_by, orderId]);
  const { rows: items } = await tx.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  for (const it of items) {
    const p = prods.find((x) => x.order_item_id === it.id);
    await tx.query('INSERT INTO sale_items(sale_id, variant_id, product_id, description, qty, unit_price_pyg, discount_pyg, line_total_pyg, cost_total_pyg, cost_known) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [sale.id, it.variant_id, it.product_id, it.description, it.qty, it.unit_price_pyg, it.discount_pyg, it.line_total_pyg, p?.cost_total_pyg ?? 0, p?.cost_known ?? false]);
  }
  await tx.query('UPDATE payments SET sale_id = $2 WHERE order_id = $1 AND sale_id IS NULL', [orderId, sale.id]);
  await tx.query('UPDATE orders SET sale_id = $2, credit_due_date = $3 WHERE id = $1', [orderId, sale.id, balance > 0 ? (creditDueDate ?? o.credit_due_date) : null]);
  await setStatus(tx, o, 'entregado', req.user?.id, `Venta ${number}`);
  await tx.query(`UPDATE deliveries SET status = 'entregado', arrived_at = COALESCE(arrived_at, now()) WHERE order_id = $1 AND status <> 'entregado'`, [orderId]);
  await audit(tx, req, { action: 'order.completed', entity: 'order', entityId: orderId, after: { saleId: sale.id, saleNumber: number, totalPyg: o.total_pyg, paidPyg: paid, balancePyg: balance } });
  return { saleId: sale.id, saleNumber: number, balancePyg: balance };
}

module.exports = { CHECKLIST, EDITABLE, RESERVED, loadOrder, setStatus, history, paidOf, reserveStock, releaseReservations, createOrder, confirmOrder, updateOrder, addOrderPayment, cancelOrder, completeOrder, itemsForPlan, ensureDelivery };
