'use strict';
/**
 * Confirmación y anulación de ventas. Cada operación corre en UNA transacción: o queda todo
 * (venta + detalle + descuento de stock + pagos + caja + auditoría) o no queda nada.
 */
const { badRequest, conflict, forbidden } = require('../../lib/errors');
const { nextNumber } = require('../../lib/sequences');
const inv = require('../inventory/service');
const cash = require('../cash/service');
const { audit } = require('../audit/audit');

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const money = (n, label) => { if (!Number.isSafeInteger(n) || n < 0) throw badRequest(`${label} inválido`, undefined, 'INVALID_AMOUNT'); return n; };

async function paymentMethods(db, codes) {
  const { rows } = await db.query('SELECT id, code, name, affects_cash FROM payment_methods WHERE code = ANY($1::text[]) AND active', [[...new Set(codes)]]);
  const by = new Map(rows.map((r) => [r.code, r]));
  for (const c of codes) if (!by.has(c)) throw badRequest('Método de pago inexistente o inactivo', { methodCode: c }, 'UNKNOWN_METHOD');
  return by;
}

/** Qué se descuenta de inventario por cada línea: receta (componentes) → producto con stock propio → nada. */
async function planConsumption(db, variants, items) {
  const plan = []; const totals = new Map(); // productId → milésimas requeridas
  for (const it of items) {
    const v = variants.get(it.variantId);
    const { rows: comps } = v.recipe_enabled
      ? await db.query(`SELECT rc.component_product_id AS product_id, rc.qty FROM recipe_components rc WHERE rc.variant_id = $1`, [v.id]) : { rows: [] };
    let needs = []; let kind = 'none';
    if (comps.length) { kind = 'recipe'; needs = comps.map((c) => ({ productId: c.product_id, milli: inv.toMilli(c.qty) * it.qty })); }
    else if (v.is_stockable) { kind = 'stock'; needs = [{ productId: v.product_id, milli: it.qty * 1000 }]; }
    const { rows: ex } = kind === 'recipe' ? await db.query('SELECT COALESCE(sum(amount_pyg), 0)::bigint AS s FROM recipe_extra_costs WHERE variant_id = $1', [v.id]) : { rows: [{ s: 0 }] };
    for (const n of needs) totals.set(n.productId, (totals.get(n.productId) ?? 0) + n.milli);
    plan.push({ item: it, kind, needs, extrasPyg: Number(ex[0].s) * it.qty });
  }
  return { plan, totals };
}

/** Bloquea (en orden ascendente → sin deadlocks) y verifica el stock disponible de TODO lo que la venta necesita. */
async function lockAndCheckStock(tx, totals, locationId) {
  const shortages = [];
  for (const pid of [...totals.keys()].sort((a, b) => a - b)) {
    const p = await inv.lockProduct(tx, pid);
    const level = await inv.lockLevel(tx, pid, locationId);
    const available = inv.toMilli(level.on_hand) - inv.toMilli(level.reserved);
    if (totals.get(pid) > available) shortages.push({ productId: pid, name: p.name, unit: p.unit, required: totals.get(pid) / 1000, available: Math.max(available, 0) / 1000 });
  }
  if (shortages.length) {
    const msg = shortages.slice(0, 3).map((s) => `${s.name}: faltan ${(s.required - s.available).toFixed(3).replace(/\.?0+$/, '')} ${s.unit} (hay ${s.available})`).join('; ');
    throw conflict(`Stock insuficiente. ${msg}`, 'INSUFFICIENT_STOCK', { shortages });
  }
}

async function createSale(tx, req, b) {
  const user = req.user;
  const lineDiscounts = sum(b.items.map((i) => i.discountPyg ?? 0)); const orderDiscount = b.discountPyg ?? 0;
  if ((lineDiscounts > 0 || orderDiscount > 0) && !req.permissions.has('ventas.discount')) throw forbidden('No tenés permiso para aplicar descuentos', 'DISCOUNT_FORBIDDEN');
  const delivery = money(b.deliveryFeePyg ?? 0, 'Costo de delivery');

  if (b.customerId) {
    const { rowCount } = await tx.query('SELECT 1 FROM customers WHERE id = $1 AND archived_at IS NULL', [b.customerId]);
    if (!rowCount) throw badRequest('Cliente inexistente o archivado', undefined, 'UNKNOWN_CUSTOMER');
  }
  // Variantes: precio y vigencia SIEMPRE desde la base (nunca del cliente).
  const { rows: vrows } = await tx.query(
    `SELECT v.id, v.label, v.price_pyg, v.active, v.recipe_enabled, p.id AS product_id, p.name, p.is_sellable, p.is_stockable, p.active AS product_active, p.archived_at
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::bigint[])`, [[...new Set(b.items.map((i) => i.variantId))]]);
  const variants = new Map(vrows.map((v) => [v.id, v]));
  for (const it of b.items) {
    const v = variants.get(it.variantId);
    if (!v) throw badRequest('Hay productos inexistentes', { variantId: it.variantId }, 'UNKNOWN_VARIANT');
    if (!v.active || !v.product_active || v.archived_at || !v.is_sellable) throw conflict(`“${v.name}” no está disponible para la venta`, 'NOT_SELLABLE', { variantId: v.id });
  }
  const lines = b.items.map((it) => {
    const v = variants.get(it.variantId); const gross = it.qty * v.price_pyg; const d = it.discountPyg ?? 0;
    if (d > gross) throw badRequest(`El descuento de “${v.name}” supera su importe`, { variantId: v.id }, 'DISCOUNT_TOO_HIGH');
    return { ...it, v, unit: v.price_pyg, discount: d, total: gross - d, description: v.label && v.label !== 'Único' ? `${v.name} (${v.label})` : v.name };
  });
  const subtotal = sum(lines.map((l) => l.qty * l.unit)) ;
  const discount = lineDiscounts + orderDiscount;
  if (discount > subtotal) throw badRequest('El descuento no puede superar el subtotal', undefined, 'DISCOUNT_TOO_HIGH');
  const total = subtotal - discount + delivery;

  // Pagos
  const pays = b.payments ?? []; const methods = await paymentMethods(tx, pays.map((p) => p.methodCode));
  const paid = sum(pays.map((p) => p.amountPyg));
  if (paid > total) throw badRequest(`Los pagos (${paid}) superan el total (${total}). Registrá solo lo que corresponde a la venta (el vuelto no se carga).`, { totalPyg: total, paidPyg: paid }, 'OVERPAYMENT');
  const balance = total - paid;
  if (balance > 0) {
    if (!b.customerId) throw badRequest('Una venta con saldo pendiente (a crédito) necesita un cliente', undefined, 'CREDIT_REQUIRES_CUSTOMER');
    if (!b.creditDueDate) throw badRequest('Indicá la fecha de vencimiento del saldo pendiente', undefined, 'CREDIT_DUE_REQUIRED');
  }
  const cashTotal = sum(pays.filter((p) => methods.get(p.methodCode).affects_cash).map((p) => p.amountPyg));
  const session = cashTotal > 0 ? await cash.requireOpenSession(tx) : await cash.currentSession(tx);

  // Stock: verificar TODO antes de tocar nada
  const locationId = await inv.defaultLocationId(tx);
  const { plan, totals } = await planConsumption(tx, variants, lines);
  await lockAndCheckStock(tx, totals, locationId);

  const number = await nextNumber(tx, 'sale', 'V');
  const { rows: [sale] } = await tx.query(
    `INSERT INTO sales(number, customer_id, channel, subtotal_pyg, discount_pyg, delivery_fee_pyg, total_pyg, paid_pyg, credit_due_date, notes, cash_session_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, created_at`,
    [number, b.customerId ?? null, b.channel ?? 'mostrador', subtotal, discount, delivery, total, paid, balance > 0 ? b.creditDueDate : null, b.notes?.trim() || null, session?.id ?? null, user.id]);

  // Descontar componentes y congelar el costo REAL (lotes consumidos + costos extra de la receta)
  const itemsOut = [];
  for (const p of plan) {
    let cost = p.extrasPyg; let known = p.kind !== 'none';
    for (const n of p.needs) {
      const r = await inv.consumeStock(tx, { productId: n.productId, locationId, qty: n.milli / 1000, type: 'venta', reason: `Venta ${number}`, referenceType: 'sale', referenceId: sale.id, userId: user.id });
      cost += r.totalCostPyg; if (r.movements.some((m) => m.unitCostPyg === 0)) known = false;
    }
    const l = p.item;
    const { rows: [si] } = await tx.query(
      `INSERT INTO sale_items(sale_id, variant_id, product_id, description, qty, unit_price_pyg, discount_pyg, line_total_pyg, cost_total_pyg, cost_known) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [sale.id, l.v.id, l.v.product_id, l.description, l.qty, l.unit, l.discount, l.total, cost, known]);
    itemsOut.push({ id: si.id, variantId: l.v.id, qty: l.qty, totalPyg: l.total, costPyg: cost });
  }
  // Pagos + movimientos de caja (solo el efectivo mueve el cajón)
  for (const p of pays) {
    const m = methods.get(p.methodCode); let cmId = null;
    if (m.affects_cash) cmId = await cash.addCashMovement(tx, { sessionId: session.id, type: 'venta', amountPyg: p.amountPyg, concept: `Venta ${number}`, referenceType: 'sale', referenceId: sale.id, userId: user.id });
    await tx.query('INSERT INTO payments(sale_id, method_id, amount_pyg, reference, user_id, cash_movement_id) VALUES ($1,$2,$3,$4,$5,$6)', [sale.id, m.id, p.amountPyg, p.reference?.trim() || null, user.id, cmId]);
  }
  await audit(tx, req, { action: 'sale.confirmed', entity: 'sale', entityId: sale.id, after: { number, customerId: b.customerId ?? null, channel: b.channel ?? 'mostrador', subtotalPyg: subtotal, discountPyg: discount, deliveryFeePyg: delivery, totalPyg: total, paidPyg: paid,
    items: itemsOut.map((i) => ({ variantId: i.variantId, qty: i.qty, totalPyg: i.totalPyg, costPyg: i.costPyg })), payments: pays.map((p) => ({ method: p.methodCode, amountPyg: p.amountPyg })) } });
  return { id: sale.id, number, totalPyg: total, paidPyg: paid, balancePyg: balance };
}

/** Anula una venta: repone el stock (al costo original), devuelve el dinero (contra-asientos) y deja todo auditado. */
async function voidSale(tx, req, saleId, reason) {
  const { rows } = await tx.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
  if (!rows.length) return null;
  const sale = rows[0];
  if (sale.status !== 'confirmada') throw conflict('La venta ya está anulada', 'ALREADY_VOIDED');
  const { rows: pays } = await tx.query('SELECT p.*, m.affects_cash FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE p.sale_id = $1 ORDER BY p.id', [saleId]);
  const session = pays.some((p) => p.affects_cash) ? await cash.requireOpenSession(tx) : null;
  for (const p of pays) {
    let cmId = null;
    if (p.affects_cash) cmId = await cash.addCashMovement(tx, { sessionId: session.id, type: 'devolucion', amountPyg: -p.amount_pyg, concept: `Anulación ${sale.number}`, referenceType: 'sale', referenceId: saleId, userId: req.user.id });
    await tx.query('INSERT INTO sale_refunds(sale_id, payment_id, method_id, amount_pyg, reason, user_id, cash_movement_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [saleId, p.id, p.method_id, p.amount_pyg, reason, req.user.id, cmId]);
  }
  const { rows: moves } = await tx.query(
    `SELECT m.id, m.product_id, m.location_id, -m.qty AS qty, m.unit_cost_pyg, l.expires_at FROM inventory_movements m LEFT JOIN inventory_lots l ON l.id = m.lot_id
      WHERE m.reference_type = 'sale' AND m.reference_id = $1 AND m.type = 'venta' ORDER BY m.product_id, m.id`, [saleId]);
  for (const m of moves) {
    await inv.receiveStock(tx, { productId: m.product_id, locationId: m.location_id, qty: m.qty, unitCostPyg: m.unit_cost_pyg, type: 'devolucion', reason: `Anulación ${sale.number}`, referenceType: 'sale_void', referenceId: saleId, userId: req.user.id, expiresAt: m.expires_at });
  }
  await tx.query(`UPDATE sales SET status = 'anulada', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`, [saleId, req.user.id, reason]);
  await audit(tx, req, { action: 'sale.voided', entity: 'sale', entityId: saleId, before: { status: 'confirmada', totalPyg: sale.total_pyg, paidPyg: sale.paid_pyg }, after: { status: 'anulada', reason, refundedPyg: sum(pays.map((p) => p.amount_pyg)), stockReturned: moves.length } });
  return { id: saleId, number: sale.number, refundedPyg: sum(pays.map((p) => p.amount_pyg)) };
}

/** Cobro posterior de una venta con saldo (cuentas por cobrar). */
async function addPayment(tx, req, saleId, { methodCode, amountPyg, reference }) {
  const { rows } = await tx.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
  if (!rows.length) return null;
  const sale = rows[0];
  if (sale.status !== 'confirmada') throw conflict('No se puede cobrar una venta anulada', 'SALE_VOIDED');
  const balance = sale.total_pyg - sale.paid_pyg;
  if (amountPyg > balance) throw conflict(`El cobro supera el saldo pendiente (${balance})`, 'OVERPAYMENT', { balancePyg: balance });
  const m = (await paymentMethods(tx, [methodCode])).get(methodCode);
  let cmId = null;
  if (m.affects_cash) { const s = await cash.requireOpenSession(tx); cmId = await cash.addCashMovement(tx, { sessionId: s.id, type: 'cobro', amountPyg, concept: `Cobro ${sale.number}`, referenceType: 'sale', referenceId: saleId, userId: req.user.id }); }
  const { rows: [pay] } = await tx.query('INSERT INTO payments(sale_id, method_id, amount_pyg, reference, user_id, cash_movement_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [saleId, m.id, amountPyg, reference?.trim() || null, req.user.id, cmId]);
  await tx.query('UPDATE sales SET paid_pyg = paid_pyg + $2 WHERE id = $1', [saleId, amountPyg]);
  await audit(tx, req, { action: 'sale.payment_added', entity: 'sale', entityId: saleId, after: { paymentId: pay.id, method: methodCode, amountPyg, balanceAfterPyg: balance - amountPyg } });
  return { paymentId: pay.id, balancePyg: balance - amountPyg };
}

module.exports = { createSale, voidSale, addPayment, paymentMethods };
