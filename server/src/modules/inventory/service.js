'use strict';
/**
 * Núcleo de inventario. TODA modificación de stock pasa por receiveStock/consumeStock, que en la MISMA transacción:
 *   1) bloquean el nivel (FOR UPDATE), 2) mueven lotes (FEFO), 3) escriben movimientos inmutables, 4) actualizan el nivel.
 * Invariante verificable (verifyIntegrity): on_hand == Σ lotes.qty_remaining == Σ movimientos.qty.
 * Cantidades: NUMERIC(14,3) (se opera en milésimas enteras para no arrastrar errores de punto flotante). Dinero: guaraníes enteros.
 */
const { badRequest, conflict, notFound } = require('../../lib/errors');
const { assertPYG } = require('../../lib/money');

const MILLI = 1000;
const toMilli = (q) => Math.round(q * MILLI);
const fromMilli = (m) => (m / MILLI).toFixed(3);

function assertQty(q, label = 'cantidad') {
  if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > 1e9 || Math.abs(toMilli(q) / MILLI - q) > 1e-9) {
    throw badRequest(`La ${label} debe ser un número mayor que 0 con hasta 3 decimales`, { qty: q }, 'INVALID_QTY');
  }
  return toMilli(q);
}

async function defaultLocationId(db) {
  const { rows } = await db.query('SELECT id FROM stock_locations WHERE active ORDER BY id LIMIT 1');
  if (!rows.length) throw conflict('No hay ubicaciones de stock activas', 'NO_LOCATION');
  return rows[0].id;
}

async function lockProduct(db, productId) {
  const { rows } = await db.query('SELECT id, name, is_stockable, avg_cost_pyg, archived_at, unit FROM products WHERE id = $1 FOR UPDATE', [productId]);
  if (!rows.length) throw notFound('Producto no encontrado');
  if (rows[0].archived_at) throw conflict('El producto está archivado', 'ARCHIVED');
  if (!rows[0].is_stockable) throw conflict(`“${rows[0].name}” no se gestiona en inventario`, 'NOT_STOCKABLE');
  return rows[0];
}
async function lockLevel(db, productId, locationId) {
  await db.query('INSERT INTO inventory_levels(product_id, location_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [productId, locationId]);
  const { rows } = await db.query('SELECT on_hand, reserved FROM inventory_levels WHERE product_id = $1 AND location_id = $2 FOR UPDATE', [productId, locationId]);
  return rows[0];
}

/** Ingreso de stock: crea un lote, un movimiento positivo y recalcula el costo promedio ponderado. */
async function receiveStock(tx, { productId, locationId, qty, unitCostPyg, type, reason = null, referenceType = null, referenceId = null, userId = null,
  supplierId = null, receiptId = null, purchasedAt = null, expiresAt = null, note = null }) {
  const m = assertQty(qty); assertPYG(unitCostPyg, 'costo unitario');
  const p = await lockProduct(tx, productId);
  await lockLevel(tx, productId, locationId);
  const { rows: [tot] } = await tx.query('SELECT COALESCE(sum(on_hand), 0) AS s FROM inventory_levels WHERE product_id = $1', [productId]);
  const { rows: [avg] } = await tx.query(
    `SELECT round(($1::numeric * $2::bigint + $3::numeric * $4::bigint) / ($1::numeric + $3::numeric))::bigint AS v`,
    [String(tot.s), p.avg_cost_pyg, fromMilli(m), unitCostPyg]);
  const { rows: [lot] } = await tx.query(
    `INSERT INTO inventory_lots(product_id, location_id, supplier_id, receipt_id, purchased_at, expires_at, qty_initial, qty_remaining, unit_cost_pyg, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) RETURNING id`,
    [productId, locationId, supplierId, receiptId, purchasedAt, expiresAt, fromMilli(m), unitCostPyg, note]);
  const { rows: [mv] } = await tx.query(
    `INSERT INTO inventory_movements(product_id, location_id, lot_id, type, qty, unit_cost_pyg, reason, reference_type, reference_id, user_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [productId, locationId, lot.id, type, fromMilli(m), unitCostPyg, reason, referenceType, referenceId, userId, note]);
  await tx.query('UPDATE inventory_levels SET on_hand = on_hand + $3, updated_at = now() WHERE product_id = $1 AND location_id = $2', [productId, locationId, fromMilli(m)]);
  await tx.query('UPDATE products SET avg_cost_pyg = $2 WHERE id = $1', [productId, avg.v]);
  return { lotId: lot.id, movementId: mv.id, avgCostPyg: avg.v };
}

/**
 * Salida de stock con FEFO (primero lo que vence antes; sin vencimiento, lo más antiguo).
 * Falla con 409 INSUFFICIENT_STOCK si no alcanza el stock DISPONIBLE (físico − reservado), sin tocar nada.
 * `useReserved` = la salida consume una reserva propia (p. ej. producción de un pedido): usa lo reservado y la libera en el mismo paso.
 */
async function consumeStock(tx, { productId, locationId, qty, type, reason = null, referenceType = null, referenceId = null, userId = null, note = null, useReserved = false }) {
  const need = assertQty(qty);
  const p = await lockProduct(tx, productId);
  const level = await lockLevel(tx, productId, locationId);
  const physical = toMilli(level.on_hand); const reservedM = toMilli(level.reserved);
  if (useReserved && need > reservedM) {
    throw conflict(`No hay suficiente stock reservado de “${p.name}” (reservado ${fromMilli(reservedM)})`, 'RESERVATION_MISSING', { productId, requested: need / MILLI, reserved: reservedM / MILLI });
  }
  const available = useReserved ? physical : physical - reservedM;
  if (need > available) {
    throw conflict(`Stock insuficiente de “${p.name}”: se necesitan ${fromMilli(need)} y hay ${fromMilli(Math.max(available, 0))} disponibles`, 'INSUFFICIENT_STOCK',
      { productId, requested: need / MILLI, available: Math.max(available, 0) / MILLI });
  }
  const { rows: lots } = await tx.query(
    `SELECT id, qty_remaining, unit_cost_pyg FROM inventory_lots WHERE product_id = $1 AND location_id = $2 AND qty_remaining > 0
      ORDER BY expires_at NULLS LAST, received_at, id FOR UPDATE`, [productId, locationId]);
  let left = need; const movements = []; let total = 0n;
  for (const lot of lots) {
    if (left === 0) break;
    const take = Math.min(left, toMilli(lot.qty_remaining));
    await tx.query('UPDATE inventory_lots SET qty_remaining = qty_remaining - $2 WHERE id = $1', [lot.id, fromMilli(take)]);
    const { rows: [mv] } = await tx.query(
      `INSERT INTO inventory_movements(product_id, location_id, lot_id, type, qty, unit_cost_pyg, reason, reference_type, reference_id, user_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [productId, locationId, lot.id, type, fromMilli(-take), lot.unit_cost_pyg, reason, referenceType, referenceId, userId, note]);
    const cost = (BigInt(take) * BigInt(lot.unit_cost_pyg) + 500n) / 1000n;
    total += cost; left -= take;
    movements.push({ id: mv.id, lotId: lot.id, qty: take / MILLI, unitCostPyg: lot.unit_cost_pyg, costPyg: Number(cost) });
  }
  if (left !== 0) throw Object.assign(new Error(`Inconsistencia de inventario: los lotes no cubren el stock físico del producto ${productId}`), { statusCode: 500 });
  await tx.query(`UPDATE inventory_levels SET on_hand = on_hand - $3, reserved = reserved - CASE WHEN $4 THEN $3::numeric ELSE 0 END, updated_at = now() WHERE product_id = $1 AND location_id = $2`,
    [productId, locationId, fromMilli(need), useReserved]);
  return { movements, totalCostPyg: Number(total), avgCostPyg: p.avg_cost_pyg };
}

/** Auditoría interna de integridad: devuelve las inconsistencias (lista vacía = todo coherente). */
async function verifyIntegrity(db) {
  const { rows } = await db.query(
    `SELECT l.product_id, l.location_id, l.on_hand,
            COALESCE((SELECT sum(qty_remaining) FROM inventory_lots x WHERE x.product_id = l.product_id AND x.location_id = l.location_id), 0) AS lots,
            COALESCE((SELECT sum(qty) FROM inventory_movements m WHERE m.product_id = l.product_id AND m.location_id = l.location_id), 0) AS moves
       FROM inventory_levels l`);
  return rows.filter((r) => toMilli(r.on_hand) !== toMilli(r.lots) || toMilli(r.on_hand) !== toMilli(r.moves))
    .map((r) => ({ productId: r.product_id, locationId: r.location_id, onHand: r.on_hand, lots: r.lots, movements: r.moves }));
}

module.exports = { assertQty, toMilli, fromMilli, defaultLocationId, lockProduct, lockLevel, receiveStock, consumeStock, verifyIntegrity };
