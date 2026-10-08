'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');
const inv = require('../inventory/service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const qty = { type: 'number', exclusiveMinimum: 0, maximum: 1000000000 };
const pyg = { type: 'integer', minimum: 0, maximum: 1000000000000 };
const date = { type: 'string', format: 'date' };

/** Número correlativo atómico (sin huecos duplicados aun con concurrencia). */
async function nextNumber(tx, key, prefix) {
  const { rows } = await tx.query(
    `INSERT INTO number_sequences(key, last_value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET last_value = number_sequences.last_value + 1 RETURNING last_value`, [key]);
  return `${prefix}-${String(rows[0].last_value).padStart(6, '0')}`;
}
const lineTotal = (q, cost) => Number((BigInt(inv.toMilli(q)) * BigInt(cost) + 500n) / 1000n); // qty (3 dec) × costo, redondeado a Gs enteros
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

module.exports = async function purchasingRoutes(app) {
  const { pool } = app;

  async function loadOrder(db, oid, lock = false) {
    const { rows } = await db.query(
      `SELECT o.*, s.name AS supplier_name, s.payment_terms_days FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = $1${lock ? ' FOR UPDATE OF o' : ''}`, [oid]);
    if (!rows.length) throw notFound('Orden de compra no encontrada');
    return rows[0];
  }
  async function orderDetail(db, oid) {
    const o = await loadOrder(db, oid);
    const items = (await db.query(
      `SELECT i.id, i.product_id, p.name, p.unit, i.qty_ordered, i.qty_received, i.unit_cost_pyg FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = $1 ORDER BY i.id`, [oid])).rows;
    const receipts = (await db.query(
      `SELECT r.id, r.number, r.supplier_invoice_no, r.invoice_date, r.received_at, r.total_pyg, u.full_name AS user_name, pa.id AS payable_id, pa.paid_pyg, pa.due_date
         FROM purchase_receipts r LEFT JOIN users u ON u.id = r.received_by LEFT JOIN payables pa ON pa.receipt_id = r.id WHERE r.po_id = $1 ORDER BY r.id`, [oid])).rows;
    return {
      id: o.id, number: o.number, status: o.status, supplier: { id: o.supplier_id, name: o.supplier_name }, expectedAt: o.expected_at, notes: o.notes,
      createdAt: o.created_at, sentAt: o.sent_at, closedAt: o.closed_at,
      items: items.map((i) => ({ id: i.id, productId: i.product_id, name: i.name, unit: i.unit, qtyOrdered: i.qty_ordered, qtyReceived: i.qty_received,
        qtyPending: Number((i.qty_ordered - i.qty_received).toFixed(3)), unitCostPyg: i.unit_cost_pyg, totalPyg: lineTotal(i.qty_ordered, i.unit_cost_pyg) })),
      totalPyg: items.reduce((a, i) => a + lineTotal(i.qty_ordered, i.unit_cost_pyg), 0),
      receipts: receipts.map((r) => ({ id: r.id, number: r.number, supplierInvoiceNo: r.supplier_invoice_no, invoiceDate: r.invoice_date, receivedAt: r.received_at, totalPyg: r.total_pyg, receivedBy: r.user_name,
        payableId: r.payable_id, paidPyg: r.paid_pyg, dueDate: r.due_date })),
    };
  }

  async function validateItems(tx, items) {
    if (new Set(items.map((i) => i.productId)).size !== items.length) throw badRequest('Un producto aparece más de una vez en la orden', undefined, 'DUPLICATE_ITEM');
    for (const it of items) inv.assertQty(it.qty);
    const { rows } = await tx.query('SELECT id, name, is_stockable, archived_at FROM products WHERE id = ANY($1::bigint[])', [items.map((i) => i.productId)]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const it of items) {
      const p = byId.get(it.productId);
      if (!p || p.archived_at) throw badRequest('Hay productos inexistentes o archivados', { productId: it.productId }, 'UNKNOWN_PRODUCT');
      if (!p.is_stockable) throw conflict(`“${p.name}” no está en inventario. Incorporalo primero.`, 'NOT_STOCKABLE', { productId: it.productId });
    }
  }
  const itemSchema = { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['productId', 'qty', 'unitCostPyg'], additionalProperties: false, properties: { productId: id, qty, unitCostPyg: pyg } } };

  /* ───────── Órdenes de compra ───────── */
  app.get('/api/v1/purchase-orders', { config: access.perm('compras.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    status: { type: 'string', enum: ['all', 'borrador', 'enviada', 'parcial', 'recibida', 'cancelada', 'open'], default: 'all' }, supplierId: id } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    if (q.status === 'open') conds.push(`o.status IN ('borrador','enviada','parcial')`); else if (q.status !== 'all') { args.push(q.status); conds.push(`o.status = $${args.length}`); }
    if (q.supplierId) { args.push(q.supplierId); conds.push(`o.supplier_id = $${args.length}`); }
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(o.number ILIKE $${args.length} OR s.name ILIKE $${args.length})`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS n FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(
      `SELECT o.id, o.number, o.status, o.expected_at, o.created_at, s.name AS supplier, (SELECT count(*)::int FROM purchase_order_items i WHERE i.po_id = o.id) AS items,
              COALESCE((SELECT sum(round(i.qty_ordered * i.unit_cost_pyg)) FROM purchase_order_items i WHERE i.po_id = o.id), 0)::bigint AS total
         FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id ${where} ORDER BY o.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((o) => ({ id: o.id, number: o.number, status: o.status, supplier: o.supplier, expectedAt: o.expected_at, createdAt: o.created_at, items: o.items, totalPyg: o.total })), meta: meta(q, total) };
  });

  app.get('/api/v1/purchase-orders/:id', { config: access.perm('compras.view'), schema: { params: idParams } }, async (req) => orderDetail(pool, req.params.id));

  app.post('/api/v1/purchase-orders', { config: access.perm('compras.create'), schema: { body: { type: 'object', required: ['supplierId', 'items'], additionalProperties: false, properties: {
    supplierId: id, expectedAt: { ...date, type: ['string', 'null'] }, notes: { type: ['string', 'null'], maxLength: 1000 }, items: itemSchema } } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      const { rows: sup } = await tx.query('SELECT id, active FROM suppliers WHERE id = $1 AND archived_at IS NULL', [b.supplierId]);
      if (!sup.length || !sup[0].active) throw badRequest('Proveedor inexistente o inactivo', undefined, 'UNKNOWN_SUPPLIER');
      await validateItems(tx, b.items);
      const number = await nextNumber(tx, 'purchase_order', 'OC');
      const { rows: [o] } = await tx.query('INSERT INTO purchase_orders(number, supplier_id, expected_at, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [number, b.supplierId, b.expectedAt ?? null, b.notes?.trim() || null, req.user.id]);
      for (const it of [...b.items].sort((a, c) => a.productId - c.productId)) {
        await tx.query('INSERT INTO purchase_order_items(po_id, product_id, qty_ordered, unit_cost_pyg) VALUES ($1,$2,$3,$4)', [o.id, it.productId, inv.fromMilli(inv.toMilli(it.qty)), it.unitCostPyg]);
      }
      await audit(tx, req, { action: 'purchase_order.created', entity: 'purchase_order', entityId: o.id, after: { number, supplierId: b.supplierId, items: b.items } });
      return orderDetail(tx, o.id);
    });
    reply.code(201); return out;
  });

  // Solo se edita mientras es borrador.
  app.put('/api/v1/purchase-orders/:id', { config: access.perm('compras.edit'), schema: { params: idParams, body: { type: 'object', required: ['supplierId', 'items'], additionalProperties: false, properties: {
    supplierId: id, expectedAt: { ...date, type: ['string', 'null'] }, notes: { type: ['string', 'null'], maxLength: 1000 }, items: itemSchema } } } }, async (req) => {
    const b = req.body; const oid = req.params.id;
    return withTransaction(pool, async (tx) => {
      const o = await loadOrder(tx, oid, true);
      if (o.status !== 'borrador') throw conflict('Solo se puede editar una orden en borrador', 'NOT_EDITABLE');
      if (!(await tx.query('SELECT 1 FROM suppliers WHERE id = $1 AND archived_at IS NULL AND active', [b.supplierId])).rowCount) throw badRequest('Proveedor inexistente o inactivo', undefined, 'UNKNOWN_SUPPLIER');
      await validateItems(tx, b.items);
      const before = await orderDetail(tx, oid);
      await tx.query('UPDATE purchase_orders SET supplier_id = $2, expected_at = $3, notes = $4 WHERE id = $1', [oid, b.supplierId, b.expectedAt ?? null, b.notes?.trim() || null]);
      await tx.query('DELETE FROM purchase_order_items WHERE po_id = $1', [oid]);
      for (const it of [...b.items].sort((a, c) => a.productId - c.productId)) {
        await tx.query('INSERT INTO purchase_order_items(po_id, product_id, qty_ordered, unit_cost_pyg) VALUES ($1,$2,$3,$4)', [oid, it.productId, inv.fromMilli(inv.toMilli(it.qty)), it.unitCostPyg]);
      }
      await audit(tx, req, { action: 'purchase_order.updated', entity: 'purchase_order', entityId: oid, before: { items: before.items.map((i) => ({ productId: i.productId, qty: i.qtyOrdered, unitCostPyg: i.unitCostPyg })), supplierId: before.supplier.id }, after: b });
      return orderDetail(tx, oid);
    });
  });

  // Marca la orden como enviada. (El envío real al proveedor —email/WhatsApp— no está implementado: se coordina por fuera.)
  app.post('/api/v1/purchase-orders/:id/send', { config: access.perm('compras.edit'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const o = await loadOrder(tx, req.params.id, true);
    if (o.status !== 'borrador') throw conflict('Solo se puede enviar una orden en borrador', 'INVALID_STATE');
    await tx.query(`UPDATE purchase_orders SET status = 'enviada', sent_at = now() WHERE id = $1`, [o.id]);
    await audit(tx, req, { action: 'purchase_order.sent', entity: 'purchase_order', entityId: o.id, before: { status: 'borrador' }, after: { status: 'enviada' } });
    return orderDetail(tx, o.id);
  }));

  app.post('/api/v1/purchase-orders/:id/cancel', { config: access.perm('compras.edit'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null;
    const o = await loadOrder(tx, req.params.id, true);
    if (!['borrador', 'enviada'].includes(o.status)) throw conflict('Solo se puede cancelar una orden sin recepciones (borrador o enviada)', 'INVALID_STATE');
    await tx.query(`UPDATE purchase_orders SET status = 'cancelada', closed_at = now() WHERE id = $1`, [o.id]);
    await audit(tx, req, { action: 'purchase_order.cancelled', entity: 'purchase_order', entityId: o.id, before: { status: o.status }, after: { status: 'cancelada', reason } });
    return orderDetail(tx, o.id);
  }));

  // Cierra una orden parcialmente recibida (lo pendiente no va a llegar).
  app.post('/api/v1/purchase-orders/:id/close', { config: access.perm('compras.edit'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const o = await loadOrder(tx, req.params.id, true);
    if (o.status !== 'parcial') throw conflict('Solo se puede cerrar una orden parcialmente recibida', 'INVALID_STATE');
    await tx.query(`UPDATE purchase_orders SET status = 'recibida', closed_at = now() WHERE id = $1`, [o.id]);
    await audit(tx, req, { action: 'purchase_order.closed', entity: 'purchase_order', entityId: o.id, before: { status: 'parcial' }, after: { status: 'recibida' } });
    return orderDetail(tx, o.id);
  }));

  /* ───────── Recepción: stock + costo + cuenta por pagar, todo en UNA transacción ───────── */
  app.post('/api/v1/purchase-orders/:id/receive', { config: access.perm('compras.receive'), schema: { params: idParams, body: { type: 'object', required: ['items'], additionalProperties: false, properties: {
    supplierInvoiceNo: { type: ['string', 'null'], maxLength: 60 }, invoiceDate: { ...date, type: ['string', 'null'] }, dueDate: { ...date, type: ['string', 'null'] }, note: { type: ['string', 'null'], maxLength: 500 },
    items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['poItemId', 'qty'], additionalProperties: false, properties: { poItemId: id, qty, unitCostPyg: pyg, expiresAt: { ...date, type: ['string', 'null'] } } } } } } } }, async (req, reply) => {
    const b = req.body; const oid = req.params.id;
    const out = await withTransaction(pool, async (tx) => {
      const o = await loadOrder(tx, oid, true);
      if (!['enviada', 'parcial'].includes(o.status)) throw conflict('Solo se recibe mercadería de órdenes enviadas o parcialmente recibidas', 'INVALID_STATE', { status: o.status });
      if (new Set(b.items.map((i) => i.poItemId)).size !== b.items.length) throw badRequest('Una línea de la orden aparece más de una vez', undefined, 'DUPLICATE_ITEM');
      const { rows: poItems } = await tx.query('SELECT * FROM purchase_order_items WHERE po_id = $1 FOR UPDATE', [oid]);
      const byId = new Map(poItems.map((i) => [i.id, i]));
      const lines = b.items.map((it) => {
        const pi = byId.get(it.poItemId);
        if (!pi) throw badRequest('La línea no pertenece a esta orden', { poItemId: it.poItemId }, 'UNKNOWN_ITEM');
        const m = inv.assertQty(it.qty); const pending = inv.toMilli(pi.qty_ordered) - inv.toMilli(pi.qty_received);
        if (m > pending) throw conflict(`Se intenta recibir más de lo pendiente (${inv.fromMilli(pending)})`, 'OVER_RECEIPT', { poItemId: it.poItemId, pending: pending / 1000 });
        return { pi, qty: it.qty, cost: it.unitCostPyg ?? pi.unit_cost_pyg, expiresAt: it.expiresAt ?? null };
      }).sort((a, c) => a.pi.product_id - c.pi.product_id); // orden fijo de bloqueo → sin deadlocks
      const total = lines.reduce((a, l) => a + lineTotal(l.qty, l.cost), 0);
      const number = await nextNumber(tx, 'purchase_receipt', 'RC');
      const { rows: [r] } = await tx.query(
        `INSERT INTO purchase_receipts(number, po_id, supplier_id, supplier_invoice_no, invoice_date, received_by, total_pyg, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [number, oid, o.supplier_id, b.supplierInvoiceNo?.trim() || null, b.invoiceDate ?? null, req.user.id, total, b.note?.trim() || null]);
      const locationId = await inv.defaultLocationId(tx);
      for (const l of lines) {
        const res = await inv.receiveStock(tx, { productId: l.pi.product_id, locationId, qty: l.qty, unitCostPyg: l.cost, type: 'compra', reason: `Recepción ${number}`, referenceType: 'purchase_receipt', referenceId: r.id,
          userId: req.user.id, supplierId: o.supplier_id, receiptId: r.id, purchasedAt: b.invoiceDate ?? null, expiresAt: l.expiresAt });
        await tx.query('INSERT INTO purchase_receipt_items(receipt_id, po_item_id, product_id, qty, unit_cost_pyg, expires_at) VALUES ($1,$2,$3,$4,$5,$6)', [r.id, l.pi.id, l.pi.product_id, inv.fromMilli(inv.toMilli(l.qty)), l.cost, l.expiresAt]);
        await tx.query('UPDATE purchase_order_items SET qty_received = qty_received + $2 WHERE id = $1', [l.pi.id, inv.fromMilli(inv.toMilli(l.qty))]);
        // precio del proveedor: último precio + historial
        await tx.query(`INSERT INTO supplier_products(supplier_id, product_id, last_price_pyg) VALUES ($1,$2,$3)
                        ON CONFLICT (supplier_id, product_id) DO UPDATE SET last_price_pyg = EXCLUDED.last_price_pyg, updated_at = now()`, [o.supplier_id, l.pi.product_id, l.cost]);
        await tx.query('INSERT INTO supplier_price_history(supplier_id, product_id, price_pyg, reference_id) VALUES ($1,$2,$3,$4)', [o.supplier_id, l.pi.product_id, l.cost, r.id]);
        void res;
      }
      const { rows: [pend] } = await tx.query('SELECT count(*)::int AS n FROM purchase_order_items WHERE po_id = $1 AND qty_received < qty_ordered', [oid]);
      const status = pend.n === 0 ? 'recibida' : 'parcial';
      await tx.query('UPDATE purchase_orders SET status = $2, closed_at = CASE WHEN $2 = \'recibida\' THEN now() ELSE closed_at END WHERE id = $1', [oid, status]);
      let payableId = null;
      if (total > 0) {
        const due = b.dueDate ?? addDays(b.invoiceDate ?? today(), o.payment_terms_days);
        const { rows: [pa] } = await tx.query('INSERT INTO payables(supplier_id, receipt_id, invoice_no, total_pyg, due_date) VALUES ($1,$2,$3,$4,$5) RETURNING id', [o.supplier_id, r.id, b.supplierInvoiceNo?.trim() || null, total, due]);
        payableId = pa.id;
      }
      await audit(tx, req, { action: 'purchase.received', entity: 'purchase_order', entityId: oid, after: { receipt: number, totalPyg: total, status, payableId, items: lines.map((l) => ({ productId: l.pi.product_id, qty: l.qty, unitCostPyg: l.cost })) } });
      return { receiptId: r.id, number, totalPyg: total, status, payableId };
    });
    reply.code(201); return out;
  });

  /* ───────── Cuentas por pagar ───────── */
  const PAY_STATUS = `CASE WHEN pa.paid_pyg >= pa.total_pyg THEN 'paid' WHEN pa.due_date < CURRENT_DATE THEN 'overdue' ELSE 'pending' END`;
  app.get('/api/v1/payables', { config: access.anyPerm('compras.view', 'finanzas.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    status: { type: 'string', enum: ['all', 'open', 'pending', 'overdue', 'paid'], default: 'open' }, supplierId: id } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    if (q.status === 'open') conds.push('pa.paid_pyg < pa.total_pyg'); else if (q.status !== 'all') { args.push(q.status); conds.push(`(${PAY_STATUS}) = $${args.length}`); }
    if (q.supplierId) { args.push(q.supplierId); conds.push(`pa.supplier_id = $${args.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const from = `FROM payables pa JOIN suppliers s ON s.id = pa.supplier_id JOIN purchase_receipts r ON r.id = pa.receipt_id JOIN purchase_orders o ON o.id = r.po_id ${where}`;
    const tot = (await pool.query(`SELECT count(*)::int AS n, COALESCE(sum(pa.total_pyg - pa.paid_pyg),0)::bigint AS bal ${from}`, args)).rows[0];
    const { rows } = await pool.query(
      `SELECT pa.id, pa.invoice_no, pa.total_pyg, pa.paid_pyg, pa.due_date, s.id AS supplier_id, s.name AS supplier, r.number AS receipt, o.number AS po, (${PAY_STATUS}) AS status
         ${from} ORDER BY pa.due_date, pa.id LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((p) => ({ id: p.id, supplier: { id: p.supplier_id, name: p.supplier }, invoiceNo: p.invoice_no, receipt: p.receipt, purchaseOrder: p.po, totalPyg: p.total_pyg, paidPyg: p.paid_pyg,
      balancePyg: p.total_pyg - p.paid_pyg, dueDate: p.due_date, status: p.status })), meta: meta(q, tot.n), balancePyg: tot.bal };
  });

  app.get('/api/v1/payables/:id', { config: access.anyPerm('compras.view', 'finanzas.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(
      `SELECT pa.*, s.name AS supplier, r.number AS receipt, (${PAY_STATUS}) AS status FROM payables pa JOIN suppliers s ON s.id = pa.supplier_id JOIN purchase_receipts r ON r.id = pa.receipt_id WHERE pa.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Cuenta por pagar no encontrada');
    const pays = (await pool.query(
      `SELECT x.id, x.amount_pyg, x.reference, x.paid_at, m.name AS method, u.full_name AS user_name FROM payable_payments x JOIN payment_methods m ON m.id = x.method_id LEFT JOIN users u ON u.id = x.user_id WHERE x.payable_id = $1 ORDER BY x.id`, [req.params.id])).rows;
    const p = rows[0];
    return { id: p.id, supplier: { id: p.supplier_id, name: p.supplier }, invoiceNo: p.invoice_no, receipt: p.receipt, totalPyg: p.total_pyg, paidPyg: p.paid_pyg, balancePyg: p.total_pyg - p.paid_pyg, dueDate: p.due_date, status: p.status,
      payments: pays.map((x) => ({ id: x.id, amountPyg: x.amount_pyg, method: x.method, reference: x.reference, paidAt: x.paid_at, user: x.user_name })) };
  });

  // Pago a proveedor. El vínculo con la caja (efectivo que sale de la caja) se agrega con el módulo de caja.
  app.post('/api/v1/payables/:id/payments', { config: access.perm('finanzas.edit'), schema: { params: idParams, body: { type: 'object', required: ['amountPyg', 'methodCode'], additionalProperties: false, properties: {
    amountPyg: { type: 'integer', minimum: 1, maximum: 1000000000000 }, methodCode: { type: 'string', pattern: '^[a-z_]+$', maxLength: 30 }, reference: { type: ['string', 'null'], maxLength: 100 } } } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM payables WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows.length) throw notFound('Cuenta por pagar no encontrada');
      const pa = rows[0]; const balance = pa.total_pyg - pa.paid_pyg;
      if (b.amountPyg > balance) throw conflict(`El pago supera el saldo pendiente (${balance})`, 'OVERPAYMENT', { balancePyg: balance });
      const { rows: mt } = await tx.query('SELECT id FROM payment_methods WHERE code = $1 AND active', [b.methodCode]);
      if (!mt.length) throw badRequest('Método de pago inexistente o inactivo', { methodCode: b.methodCode }, 'UNKNOWN_METHOD');
      const { rows: [pay] } = await tx.query('INSERT INTO payable_payments(payable_id, amount_pyg, method_id, reference, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id', [pa.id, b.amountPyg, mt[0].id, b.reference?.trim() || null, req.user.id]);
      await tx.query('UPDATE payables SET paid_pyg = paid_pyg + $2 WHERE id = $1', [pa.id, b.amountPyg]);
      await audit(tx, req, { action: 'payable.payment', entity: 'payable', entityId: pa.id, after: { paymentId: pay.id, amountPyg: b.amountPyg, method: b.methodCode, balanceAfterPyg: balance - b.amountPyg } });
      return { paymentId: pay.id, balancePyg: balance - b.amountPyg, status: balance - b.amountPyg === 0 ? 'paid' : 'partial' };
    });
    reply.code(201); return out;
  });

  app.get('/api/v1/payment-methods', { config: access.authenticated }, async () => {
    const { rows } = await pool.query('SELECT code, name, affects_cash FROM payment_methods WHERE active ORDER BY sort_order, id');
    return { data: rows.map((m) => ({ code: m.code, name: m.name, affectsCash: m.affects_cash })) };
  });
};
