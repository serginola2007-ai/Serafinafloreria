'use strict';
const access = require('../../lib/access');
const { notFound } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { querySchema, offset, meta } = require('../../lib/pagination');
const { mediaUrl } = require('../media/urls');
const { loadRecipe } = require('../recipes/service');
const S = require('./service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const CHANNELS = ['mostrador', 'web', 'whatsapp', 'instagram', 'telefono', 'evento', 'mayorista'];
const pay = { type: 'object', required: ['methodCode', 'amountPyg'], additionalProperties: false, properties: { methodCode: { type: 'string', pattern: '^[a-z_]+$', maxLength: 30 }, amountPyg: { type: 'integer', minimum: 1, maximum: 1000000000000 }, reference: { type: ['string', 'null'], maxLength: 100 } } };

module.exports = async function salesRoutes(app) {
  const { pool } = app;
  const PAY_STATE = `CASE WHEN s.status = 'anulada' THEN 'void' WHEN s.paid_pyg >= s.total_pyg THEN 'paid' WHEN s.credit_due_date < CURRENT_DATE THEN 'overdue' WHEN s.paid_pyg > 0 THEN 'partial' ELSE 'credit' END`;

  /* ───────── Catálogo del POS: lo que se puede vender hoy, con disponibilidad real ───────── */
  app.get('/api/v1/pos/catalog', { config: access.perm('ventas.create'), schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 100 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 60 } } } } }, async (req) => {
    const args = []; let where = `WHERE v.active AND p.active AND p.is_sellable AND p.archived_at IS NULL AND NOT p.needs_review`;
    if (req.query.q) { args.push(`%${req.query.q.replace(/[%_\\]/g, '\\$&')}%`); where += ` AND p.name ILIKE $1`; }
    const { rows } = await pool.query(
      `SELECT v.id, v.label, v.price_pyg, v.recipe_enabled, p.id AS product_id, p.name, p.is_stockable, c.name AS category, t.storage, t.storage_key
         FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN product_categories c ON c.id = p.category_id
         LEFT JOIN LATERAL (SELECT m.storage, m.storage_key FROM product_media pm JOIN media m ON m.id = pm.media_id AND m.archived_at IS NULL WHERE pm.product_id = p.id ORDER BY pm.sort_order LIMIT 1) t ON true
         ${where} ORDER BY p.sort_order, p.name, v.sort_order, v.id LIMIT ${req.query.limit}`, args);
    const data = [];
    for (const r of rows) {
      const rec = await loadRecipe(pool, r.id);
      let availability = { type: 'none', qty: null };
      if (rec.hasRecipe && r.recipe_enabled) availability = { type: 'recipe', qty: rec.buildable };
      else if (r.is_stockable) availability = { type: 'stock', qty: Number((await pool.query('SELECT COALESCE(sum(on_hand - reserved), 0) AS q FROM inventory_levels WHERE product_id = $1', [r.product_id])).rows[0].q) };
      data.push({ variantId: r.id, productId: r.product_id, name: r.name, label: r.label, category: r.category, pricePyg: r.price_pyg, thumbUrl: r.storage_key ? mediaUrl(app, r) : null, availability });
    }
    return { data };
  });

  /* ───────── Confirmar venta ───────── */
  app.post('/api/v1/sales', { config: access.perm('ventas.create'), schema: { body: { type: 'object', required: ['items'], additionalProperties: false, properties: {
    customerId: { type: ['integer', 'null'], minimum: 1 }, channel: { type: 'string', enum: CHANNELS }, notes: { type: ['string', 'null'], maxLength: 1000 },
    discountPyg: { type: 'integer', minimum: 0, maximum: 1000000000000 }, deliveryFeePyg: { type: 'integer', minimum: 0, maximum: 1000000000000 }, creditDueDate: { type: ['string', 'null'], format: 'date' },
    items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['variantId', 'qty'], additionalProperties: false, properties: { variantId: id, qty: { type: 'integer', minimum: 1, maximum: 1000 }, discountPyg: { type: 'integer', minimum: 0, maximum: 1000000000000 } } } },
    payments: { type: 'array', maxItems: 10, default: [], items: pay } } } } }, async (req, reply) => {
    const out = await withTransaction(pool, (tx) => S.createSale(tx, req, req.body));
    reply.code(201); return out;
  });

  app.post('/api/v1/sales/:id/void', { config: access.perm('ventas.cancel'), schema: { params: idParams, body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 3, maxLength: 300 } } } } }, async (req) => {
    const r = await withTransaction(pool, (tx) => S.voidSale(tx, req, req.params.id, req.body.reason.trim()));
    if (!r) throw notFound('Venta no encontrada'); return r;
  });

  app.post('/api/v1/sales/:id/payments', { config: access.perm('ventas.edit'), schema: { params: idParams, body: pay } }, async (req, reply) => {
    const r = await withTransaction(pool, (tx) => S.addPayment(tx, req, req.params.id, req.body));
    if (!r) throw notFound('Venta no encontrada'); reply.code(201); return r;
  });

  /* ───────── Consulta ───────── */
  const shapeRow = (s) => ({ id: s.id, number: s.number, status: s.status, paymentState: s.pay_state, channel: s.channel, customer: s.customer_id ? { id: s.customer_id, name: s.customer_name } : null,
    totalPyg: s.total_pyg, paidPyg: s.paid_pyg, balancePyg: s.status === 'anulada' ? 0 : s.total_pyg - s.paid_pyg, creditDueDate: s.credit_due_date, createdAt: s.created_at, createdBy: s.created_by_name });
  const BASE = `FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.created_by`;
  app.get('/api/v1/sales', { config: access.perm('ventas.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties, status: { type: 'string', enum: ['all', 'confirmada', 'anulada'], default: 'all' },
    payment: { type: 'string', enum: ['all', 'paid', 'partial', 'credit', 'overdue'], default: 'all' }, channel: { type: 'string', enum: CHANNELS }, customerId: id, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    const add = (sql, v) => { args.push(v); conds.push(sql.replace('?', `$${args.length}`)); };
    if (q.status !== 'all') add('s.status = ?', q.status); if (q.channel) add('s.channel = ?', q.channel); if (q.customerId) add('s.customer_id = ?', q.customerId);
    if (q.from) add('s.created_at >= ?', q.from); if (q.to) add('s.created_at <= ?', q.to);
    if (q.payment !== 'all') add(`(${PAY_STATE}) = ?`, q.payment);
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(s.number ILIKE $${args.length} OR c.name ILIKE $${args.length})`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const agg = (await pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE s.status = 'confirmada')::int AS ok, COALESCE(sum(s.total_pyg) FILTER (WHERE s.status = 'confirmada'), 0)::bigint AS total ${BASE} ${where}`, args)).rows[0];
    const { rows } = await pool.query(`SELECT s.*, c.name AS customer_name, u.full_name AS created_by_name, (${PAY_STATE}) AS pay_state ${BASE} ${where} ORDER BY s.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map(shapeRow), meta: meta(q, agg.n), summary: { salesCount: agg.ok, totalPyg: agg.total, averageTicketPyg: agg.ok ? Math.round(agg.total / agg.ok) : 0 } };
  });

  app.get('/api/v1/sales/:id', { config: access.perm('ventas.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(`SELECT s.*, c.name AS customer_name, u.full_name AS created_by_name, vu.full_name AS voided_by_name, (${PAY_STATE}) AS pay_state ${BASE} LEFT JOIN users vu ON vu.id = s.voided_by WHERE s.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Venta no encontrada');
    const s = rows[0]; const seeCost = req.permissions.has('finanzas.view') || req.permissions.has('reportes.view');
    const items = (await pool.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id', [s.id])).rows;
    const pays = (await pool.query(`SELECT p.id, p.amount_pyg, p.reference, p.received_at, m.name AS method, m.code, u.full_name AS user_name FROM payments p JOIN payment_methods m ON m.id = p.method_id LEFT JOIN users u ON u.id = p.user_id WHERE p.sale_id = $1 ORDER BY p.id`, [s.id])).rows;
    const refunds = (await pool.query(`SELECT r.id, r.amount_pyg, r.at, r.reason, m.name AS method FROM sale_refunds r JOIN payment_methods m ON m.id = r.method_id WHERE r.sale_id = $1 ORDER BY r.id`, [s.id])).rows;
    const cost = items.reduce((a, i) => a + i.cost_total_pyg, 0);
    return { ...shapeRow(s), subtotalPyg: s.subtotal_pyg, discountPyg: s.discount_pyg, deliveryFeePyg: s.delivery_fee_pyg, notes: s.notes, voidedAt: s.voided_at, voidedBy: s.voided_by_name, voidReason: s.void_reason,
      items: items.map((i) => ({ id: i.id, description: i.description, qty: i.qty, unitPricePyg: i.unit_price_pyg, discountPyg: i.discount_pyg, totalPyg: i.line_total_pyg,
        ...(seeCost ? { costPyg: i.cost_total_pyg, costKnown: i.cost_known, marginPyg: i.cost_known ? i.line_total_pyg - i.cost_total_pyg : null } : {}) })),
      ...(seeCost ? { costPyg: cost, costComplete: items.every((i) => i.cost_known), marginPyg: items.every((i) => i.cost_known) ? s.subtotal_pyg - s.discount_pyg - cost : null } : {}),
      payments: pays.map((p) => ({ id: p.id, amountPyg: p.amount_pyg, method: p.method, methodCode: p.code, reference: p.reference, receivedAt: p.received_at, user: p.user_name })),
      refunds: refunds.map((r) => ({ id: r.id, amountPyg: r.amount_pyg, method: r.method, reason: r.reason, at: r.at })) };
  });

  /* ───────── Cuentas por cobrar ───────── */
  app.get('/api/v1/receivables', { config: access.anyPerm('ventas.view', 'finanzas.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties, status: { type: 'string', enum: ['open', 'pending', 'overdue'], default: 'open' }, customerId: id } } } }, async (req) => {
    const q = req.query; const conds = [`s.status = 'confirmada'`, 's.paid_pyg < s.total_pyg']; const args = [];
    if (q.status === 'overdue') conds.push('s.credit_due_date < CURRENT_DATE'); else if (q.status === 'pending') conds.push('s.credit_due_date >= CURRENT_DATE');
    if (q.customerId) { args.push(q.customerId); conds.push(`s.customer_id = $${args.length}`); }
    const where = 'WHERE ' + conds.join(' AND ');
    const agg = (await pool.query(`SELECT count(*)::int AS n, COALESCE(sum(s.total_pyg - s.paid_pyg), 0)::bigint AS bal, COALESCE(sum(s.total_pyg - s.paid_pyg) FILTER (WHERE s.credit_due_date < CURRENT_DATE), 0)::bigint AS overdue ${BASE} ${where}`, args)).rows[0];
    const { rows } = await pool.query(`SELECT s.*, c.name AS customer_name, u.full_name AS created_by_name, (${PAY_STATE}) AS pay_state ${BASE} ${where} ORDER BY s.credit_due_date, s.id LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((s) => ({ ...shapeRow(s), status: s.credit_due_date < new Date().toISOString().slice(0, 10) ? 'overdue' : 'pending' })), meta: meta(q, agg.n), balancePyg: agg.bal, overduePyg: agg.overdue };
  });
};
