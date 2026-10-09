'use strict';
const access = require('../../lib/access');
const { notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const str = (max) => ({ type: ['string', 'null'], maxLength: max });
const body = { name: { type: 'string', minLength: 1, maxLength: 120 }, taxId: str(30), phone: str(40), email: { type: ['string', 'null'], format: 'email', maxLength: 254 },
  address: str(300), contactName: str(120), notes: str(1000), paymentTermsDays: { type: 'integer', minimum: 0, maximum: 365 } };
const shape = (s) => ({ id: s.id, name: s.name, taxId: s.tax_id, phone: s.phone, email: s.email, address: s.address, contactName: s.contact_name, notes: s.notes,
  paymentTermsDays: s.payment_terms_days, active: s.active, archived: !!s.archived_at });
const clean = (v) => (typeof v === 'string' ? (v.trim() || null) : v);

module.exports = async function suppliersRoutes(app) {
  const { pool } = app;
  const BAL = `COALESCE((SELECT sum(total_pyg - paid_pyg) FROM payables p WHERE p.supplier_id = s.id), 0)::bigint`;

  app.get('/api/v1/suppliers', { config: access.perm('proveedores.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties, archived: { type: 'boolean', default: false } } } } }, async (req) => {
    const q = req.query; const args = []; const conds = [q.archived ? 's.archived_at IS NOT NULL' : 's.archived_at IS NULL'];
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(s.name ILIKE $1 OR s.tax_id ILIKE $1 OR s.contact_name ILIKE $1)`); }
    const where = 'WHERE ' + conds.join(' AND ');
    const total = (await pool.query(`SELECT count(*)::int AS n FROM suppliers s ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(
      `SELECT s.*, ${BAL} AS balance, (SELECT max(created_at) FROM purchase_orders o WHERE o.supplier_id = s.id) AS last_purchase,
              (SELECT count(*)::int FROM purchase_orders o WHERE o.supplier_id = s.id) AS orders
         FROM suppliers s ${where} ORDER BY s.name, s.id LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((s) => ({ ...shape(s), balancePyg: s.balance, lastPurchaseAt: s.last_purchase, orders: s.orders })), meta: meta(q, total) };
  });

  app.get('/api/v1/suppliers/:id', { config: access.perm('proveedores.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(`SELECT s.*, ${BAL} AS balance FROM suppliers s WHERE s.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Proveedor no encontrado');
    const products = (await pool.query(
      `SELECT sp.product_id, p.name, p.unit, sp.supplier_sku, sp.last_price_pyg, sp.updated_at FROM supplier_products sp JOIN products p ON p.id = sp.product_id WHERE sp.supplier_id = $1 ORDER BY p.name`, [req.params.id])).rows;
    const orders = (await pool.query(
      `SELECT o.id, o.number, o.status, o.created_at, COALESCE((SELECT sum(round(i.qty_ordered * i.unit_cost_pyg)) FROM purchase_order_items i WHERE i.po_id = o.id), 0)::bigint AS total
         FROM purchase_orders o WHERE o.supplier_id = $1 ORDER BY o.id DESC LIMIT 20`, [req.params.id])).rows;
    const payables = (await pool.query(
      `SELECT id, invoice_no, total_pyg, paid_pyg, due_date FROM payables WHERE supplier_id = $1 AND paid_pyg < total_pyg ORDER BY due_date`, [req.params.id])).rows;
    return { ...shape(rows[0]), balancePyg: rows[0].balance,
      products: products.map((p) => ({ productId: p.product_id, name: p.name, unit: p.unit, supplierSku: p.supplier_sku, lastPricePyg: p.last_price_pyg, updatedAt: p.updated_at })),
      orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, createdAt: o.created_at, totalPyg: o.total })),
      openPayables: payables.map((p) => ({ id: p.id, invoiceNo: p.invoice_no, totalPyg: p.total_pyg, paidPyg: p.paid_pyg, dueDate: p.due_date })) };
  });

  app.post('/api/v1/suppliers', { config: access.perm('proveedores.create'), schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: body } } }, async (req, reply) => {
    const b = req.body;
    const row = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO suppliers(name, tax_id, phone, email, address, contact_name, notes, payment_terms_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [b.name.trim(), clean(b.taxId) ?? null, clean(b.phone) ?? null, clean(b.email) ?? null, clean(b.address) ?? null, clean(b.contactName) ?? null, clean(b.notes) ?? null, b.paymentTermsDays ?? 0]);
      await audit(tx, req, { action: 'supplier.created', entity: 'supplier', entityId: rows[0].id, after: shape(rows[0]) });
      return rows[0];
    });
    reply.code(201); return shape(row);
  });

  app.patch('/api/v1/suppliers/:id', { config: access.perm('proveedores.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { ...body, active: { type: 'boolean' } } } } }, async (req) => {
    const b = req.body;
    return withTransaction(pool, async (tx) => {
      const { rows: cur } = await tx.query('SELECT * FROM suppliers WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur.length) throw notFound('Proveedor no encontrado');
      const map = { name: 'name', taxId: 'tax_id', phone: 'phone', email: 'email', address: 'address', contactName: 'contact_name', notes: 'notes', paymentTermsDays: 'payment_terms_days', active: 'active' };
      const sets = []; const args = [req.params.id];
      for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { args.push(clean(b[k]) ?? null); sets.push(`${col} = $${args.length}`); }
      const { rows } = await tx.query(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, args);
      await audit(tx, req, { action: 'supplier.updated', entity: 'supplier', entityId: req.params.id, before: shape(cur[0]), after: shape(rows[0]) });
      return shape(rows[0]);
    });
  });

  // No se borran: se archivan. Con deuda u órdenes abiertas no se puede.
  app.delete('/api/v1/suppliers/:id', { config: access.perm('proveedores.delete'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM suppliers WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
    if (!rows.length) throw notFound('Proveedor no encontrado');
    const debt = (await tx.query('SELECT COALESCE(sum(total_pyg - paid_pyg), 0)::bigint AS d FROM payables WHERE supplier_id = $1', [req.params.id])).rows[0].d;
    const open = (await tx.query(`SELECT count(*)::int AS n FROM purchase_orders WHERE supplier_id = $1 AND status IN ('borrador','enviada','parcial')`, [req.params.id])).rows[0].n;
    if (debt > 0 || open > 0) throw conflict('El proveedor tiene deuda pendiente u órdenes de compra abiertas', 'SUPPLIER_IN_USE', { balancePyg: debt, openOrders: open });
    await tx.query('UPDATE suppliers SET archived_at = now(), active = false WHERE id = $1', [req.params.id]);
    await audit(tx, req, { action: 'supplier.archived', entity: 'supplier', entityId: req.params.id, before: shape(rows[0]) });
    return { ok: true };
  }));

  // Productos que ofrece el proveedor (el precio se actualiza solo con cada compra recibida).
  app.put('/api/v1/suppliers/:id/products/:productId', { config: access.perm('proveedores.edit'), schema: { params: { type: 'object', required: ['id', 'productId'], properties: { id, productId: id } },
    body: { type: 'object', additionalProperties: false, properties: { supplierSku: str(60) } } } }, async (req) => withTransaction(pool, async (tx) => {
    const { id: sid, productId } = req.params;
    if (!(await tx.query('SELECT 1 FROM suppliers WHERE id = $1 AND archived_at IS NULL', [sid])).rowCount) throw notFound('Proveedor no encontrado');
    if (!(await tx.query('SELECT 1 FROM products WHERE id = $1 AND archived_at IS NULL', [productId])).rowCount) throw notFound('Producto no encontrado');
    await tx.query(`INSERT INTO supplier_products(supplier_id, product_id, supplier_sku) VALUES ($1,$2,$3)
                    ON CONFLICT (supplier_id, product_id) DO UPDATE SET supplier_sku = EXCLUDED.supplier_sku, updated_at = now()`, [sid, productId, clean(req.body.supplierSku) ?? null]);
    await audit(tx, req, { action: 'supplier.product_linked', entity: 'supplier', entityId: sid, after: { productId, supplierSku: req.body.supplierSku ?? null } });
    return { ok: true };
  }));
  app.delete('/api/v1/suppliers/:id/products/:productId', { config: access.perm('proveedores.edit'), schema: { params: { type: 'object', required: ['id', 'productId'], properties: { id, productId: id } } } }, async (req) => withTransaction(pool, async (tx) => {
    const r = await tx.query('DELETE FROM supplier_products WHERE supplier_id = $1 AND product_id = $2', [req.params.id, req.params.productId]);
    if (!r.rowCount) throw notFound('El proveedor no tiene ese producto');
    await audit(tx, req, { action: 'supplier.product_unlinked', entity: 'supplier', entityId: req.params.id, after: { productId: req.params.productId } });
    return { ok: true };
  }));

  app.get('/api/v1/suppliers/:id/price-history', { config: access.perm('proveedores.view'), schema: { params: idParams, querystring: { type: 'object', properties: { productId: id } } } }, async (req) => {
    const args = [req.params.id]; let extra = '';
    if (req.query.productId) { args.push(req.query.productId); extra = ' AND h.product_id = $2'; }
    const { rows } = await pool.query(
      `SELECT h.id, h.product_id, p.name, h.price_pyg, h.recorded_at, h.source, h.reference_id FROM supplier_price_history h JOIN products p ON p.id = h.product_id
        WHERE h.supplier_id = $1${extra} ORDER BY h.recorded_at DESC, h.id DESC LIMIT 200`, args);
    return { data: rows.map((r) => ({ id: r.id, productId: r.product_id, product: r.name, pricePyg: r.price_pyg, recordedAt: r.recorded_at, source: r.source, referenceId: r.reference_id })) };
  });
};
