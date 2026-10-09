'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');
const sales = require('../sales/service');
const S = require('./service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const CHANNELS = ['mostrador', 'web', 'whatsapp', 'instagram', 'telefono', 'evento', 'mayorista'];
const STATUSES = ['consulta', 'cotizacion', 'pendiente', 'confirmado', 'pendiente_pago', 'pagado', 'en_preparacion', 'listo', 'en_reparto', 'entregado', 'cancelado', 'reprogramado', 'no_entregado'];
const str = (max) => ({ type: ['string', 'null'], maxLength: max });
const date = { type: ['string', 'null'], format: 'date' };
const orderBody = {
  customerId: { type: ['integer', 'null'], minimum: 1 }, recipientId: { type: ['integer', 'null'], minimum: 1 }, channel: { type: 'string', enum: CHANNELS }, deliveryType: { type: 'string', enum: ['delivery', 'retiro'] },
  requestedDate: date, timeSlot: str(60), cardMessage: str(500), notes: str(1000), zoneId: { type: 'integer', minimum: 1 },
  shipping: { type: 'object', additionalProperties: false, properties: { name: str(120), phone: str(40), address: str(300), zone: str(80), reference: str(300) } },
  discountPyg: { type: 'integer', minimum: 0, maximum: 1000000000000 }, deliveryFeePyg: { type: 'integer', minimum: 0, maximum: 1000000000000 },
  items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['variantId', 'qty'], additionalProperties: false, properties: { variantId: id, qty: { type: 'integer', minimum: 1, maximum: 1000 }, discountPyg: { type: 'integer', minimum: 0, maximum: 1000000000000 } } } },
};
const pay = { type: 'object', required: ['methodCode', 'amountPyg'], additionalProperties: false, properties: { methodCode: { type: 'string', pattern: '^[a-z_]+$', maxLength: 30 }, amountPyg: { type: 'integer', minimum: 1, maximum: 1000000000000 }, reference: str(100) } };
const TRANSITIONS = { consulta: ['cotizacion', 'pendiente'], cotizacion: ['pendiente'], confirmado: ['pendiente_pago'], pendiente_pago: ['confirmado'] };

module.exports = async function ordersRoutes(app) {
  const { pool } = app;
  const PAID = `COALESCE((SELECT sum(amount_pyg) FROM payments p WHERE p.order_id = o.id), 0)::bigint`;
  const row = (o) => ({ id: o.id, number: o.number, status: o.status, channel: o.channel, deliveryType: o.delivery_type, customer: o.customer_id ? { id: o.customer_id, name: o.customer_name } : null, recipient: o.ship_name,
    requestedDate: o.requested_date, timeSlot: o.time_slot, totalPyg: o.total_pyg, paidPyg: o.paid, balancePyg: ['cancelado'].includes(o.status) ? 0 : o.total_pyg - o.paid, createdAt: o.created_at });
  const LIST = `FROM orders o LEFT JOIN customers c ON c.id = o.customer_id`;

  /* ───────── Listado y alertas ───────── */
  app.get('/api/v1/orders', { config: access.perm('pedidos.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    status: { type: 'string', enum: ['all', 'open', ...STATUSES], default: 'open' }, channel: { type: 'string', enum: CHANNELS }, customerId: id, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, unpaid: { type: 'boolean' } } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    if (q.status === 'open') conds.push(`o.status NOT IN ('entregado','cancelado')`); else if (q.status !== 'all') { args.push(q.status); conds.push(`o.status = $${args.length}`); }
    if (q.channel) { args.push(q.channel); conds.push(`o.channel = $${args.length}`); } if (q.customerId) { args.push(q.customerId); conds.push(`o.customer_id = $${args.length}`); }
    if (q.from) { args.push(q.from); conds.push(`o.requested_date >= $${args.length}`); } if (q.to) { args.push(q.to); conds.push(`o.requested_date <= $${args.length}`); }
    if (q.unpaid) conds.push(`o.status <> 'cancelado' AND ${PAID} < o.total_pyg`);
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(o.number ILIKE $${args.length} OR c.name ILIKE $${args.length} OR o.ship_name ILIKE $${args.length})`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS n ${LIST} ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(`SELECT o.*, c.name AS customer_name, ${PAID} AS paid ${LIST} ${where} ORDER BY o.requested_date NULLS LAST, o.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    const counts = (await pool.query(`SELECT status, count(*)::int AS n FROM orders GROUP BY status`)).rows;
    return { data: rows.map(row), meta: meta(q, total), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });

  // "Hay 5 pedidos pendientes que requieren 60 rosas y solo hay 42 disponibles": demanda sin reservar vs stock disponible.
  app.get('/api/v1/orders/demand', { config: access.perm('pedidos.view') }, async () => {
    const { rows: open } = await pool.query(`SELECT id, number FROM orders WHERE status = 'pendiente' ORDER BY id LIMIT 300`);
    const need = new Map(); const by = new Map();
    for (const o of open) {
      const { items, variants } = await S.itemsForPlan(pool, o.id);
      const { totals } = await sales.planConsumption(pool, variants, items);
      for (const [pid, milli] of totals) { need.set(pid, (need.get(pid) ?? 0) + milli); (by.get(pid) || by.set(pid, new Set()).get(pid)).add(o.number); }
    }
    const out = [];
    for (const [pid, milli] of need) {
      const { rows: [p] } = await pool.query(`SELECT p.name, p.unit, COALESCE((SELECT sum(on_hand - reserved) FROM inventory_levels l WHERE l.product_id = p.id), 0) AS available FROM products p WHERE p.id = $1`, [pid]);
      const available = Math.round(Number(p.available) * 1000);
      if (milli > available) out.push({ productId: pid, name: p.name, unit: p.unit, required: milli / 1000, available: Math.max(0, available) / 1000, orders: [...by.get(pid)],
        message: `Hay ${by.get(pid).size} pedido(s) pendiente(s) que requieren ${milli / 1000} ${p.unit} de ${p.name} y solo hay ${Math.max(0, available) / 1000} disponibles` });
    }
    return { data: out, pendingOrders: open.length };
  });

  /* ───────── Detalle ───────── */
  app.get('/api/v1/orders/:id', { config: access.perm('pedidos.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(`SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, ${PAID} AS paid, s.number AS sale_number ${LIST} LEFT JOIN sales s ON s.id = o.sale_id WHERE o.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Pedido no encontrado');
    const o = rows[0]; const oid = o.id;
    const items = (await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [oid])).rows;
    const pays = (await pool.query(`SELECT p.id, p.amount_pyg, p.reference, p.received_at, m.name AS method, u.full_name AS user_name FROM payments p JOIN payment_methods m ON m.id = p.method_id LEFT JOIN users u ON u.id = p.user_id WHERE p.order_id = $1 ORDER BY p.id`, [oid])).rows;
    const hist = (await pool.query(`SELECT h.from_status, h.to_status, h.note, h.at, u.full_name AS user_name FROM order_status_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.order_id = $1 ORDER BY h.id`, [oid])).rows;
    const prod = (await pool.query(`SELECT p.id, p.description, p.qty, p.status, (SELECT count(*) FILTER (WHERE done)::int FROM production_checklist k WHERE k.production_order_id = p.id) AS done, (SELECT count(*)::int FROM production_checklist k WHERE k.production_order_id = p.id) AS total FROM production_orders p WHERE p.order_id = $1 ORDER BY p.id`, [oid])).rows;
    const del = (await pool.query(`SELECT d.*, u.full_name AS courier_name FROM deliveries d LEFT JOIN users u ON u.id = d.courier_id WHERE d.order_id = $1`, [oid])).rows[0];
    const res = (await pool.query(`SELECT r.product_id, p.name, p.unit, r.qty, r.status FROM stock_reservations r JOIN products p ON p.id = r.product_id WHERE r.order_id = $1 ORDER BY p.name`, [oid])).rows;
    return { ...row(o), customer: o.customer_id ? { id: o.customer_id, name: o.customer_name, phone: o.customer_phone } : null, recipientId: o.recipient_id,
      shipping: { name: o.ship_name, phone: o.ship_phone, address: o.ship_address, zone: o.ship_zone, reference: o.ship_reference }, cardMessage: o.card_message, notes: o.notes,
      subtotalPyg: o.subtotal_pyg, discountPyg: o.discount_pyg, deliveryFeePyg: o.delivery_fee_pyg, creditDueDate: o.credit_due_date, cancelReason: o.cancel_reason, sale: o.sale_id ? { id: o.sale_id, number: o.sale_number } : null,
      attribution: { source: o.attribution_source, medium: o.attribution_medium, campaign: o.attribution_campaign },
      items: items.map((i) => ({ id: i.id, variantId: i.variant_id, description: i.description, qty: i.qty, unitPricePyg: i.unit_price_pyg, discountPyg: i.discount_pyg, totalPyg: i.line_total_pyg })),
      payments: pays.map((p) => ({ id: p.id, amountPyg: p.amount_pyg, method: p.method, reference: p.reference, receivedAt: p.received_at, user: p.user_name })),
      history: hist.map((h) => ({ from: h.from_status, to: h.to_status, note: h.note, at: h.at, user: h.user_name })),
      production: prod.map((p) => ({ id: p.id, description: p.description, qty: p.qty, status: p.status, checklistDone: p.done, checklistTotal: p.total })),
      delivery: del ? { id: del.id, status: del.status, courier: del.courier_id ? { id: del.courier_id, name: del.courier_name } : null, scheduledDate: del.scheduled_date, timeSlot: del.time_slot, failureReason: del.failure_reason } : null,
      reservations: res.map((r) => ({ productId: r.product_id, name: r.name, unit: r.unit, qty: r.qty, status: r.status })) };
  });

  /* ───────── Alta / edición / flujo ───────── */
  app.post('/api/v1/orders', { config: access.perm('pedidos.create'), schema: { body: { type: 'object', required: ['items'], additionalProperties: false, properties: { ...orderBody, status: { type: 'string', enum: ['consulta', 'cotizacion', 'pendiente'] } } } } }, async (req, reply) => {
    const out = await withTransaction(pool, (tx) => S.createOrder(tx, req, req.body)); reply.code(201); return out;
  });
  app.put('/api/v1/orders/:id', { config: access.perm('pedidos.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: orderBody } } }, async (req) => {
    await withTransaction(pool, (tx) => S.updateOrder(tx, req, req.params.id, req.body)); return { ok: true };
  });
  app.post('/api/v1/orders/:id/confirm', { config: access.perm('pedidos.edit'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => { const o = await S.confirmOrder(tx, req, req.params.id); return { ok: true, status: o.status }; }));
  app.post('/api/v1/orders/:id/transition', { config: access.perm('pedidos.edit'), schema: { params: idParams, body: { type: 'object', required: ['to'], additionalProperties: false, properties: { to: { type: 'string', enum: STATUSES }, note: str(300) } } } }, async (req) => withTransaction(pool, async (tx) => {
    const o = await S.loadOrder(tx, req.params.id); const to = req.body.to;
    if (!(TRANSITIONS[o.status] ?? []).includes(to)) throw conflict(`No se puede pasar de “${o.status}” a “${to}” desde acá`, 'INVALID_TRANSITION', { from: o.status, to, allowed: TRANSITIONS[o.status] ?? [] });
    const from = o.status; await S.setStatus(tx, o, to, req.user.id, req.body.note);
    await audit(tx, req, { action: 'order.transition', entity: 'order', entityId: o.id, before: { status: from }, after: { status: to } }); return { ok: true, status: to };
  }));
  app.post('/api/v1/orders/:id/payments', { config: access.perm('pedidos.edit'), schema: { params: idParams, body: pay } }, async (req, reply) => {
    const r = await withTransaction(pool, (tx) => S.addOrderPayment(tx, req, req.params.id, req.body)); reply.code(201); return r;
  });
  app.post('/api/v1/orders/:id/cancel', { config: access.perm('pedidos.cancel'), schema: { params: idParams, body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 3, maxLength: 300 }, restock: { type: 'boolean' } } } } },
    async (req) => withTransaction(pool, (tx) => S.cancelOrder(tx, req, req.params.id, { reason: req.body.reason.trim(), restock: req.body.restock })));
  // Entrega en el local (retiro): cierra el pedido y genera la venta.
  app.post('/api/v1/orders/:id/complete', { config: access.perm('pedidos.edit'), schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: { creditDueDate: date } } } }, async (req) => withTransaction(pool, async (tx) => {
    const o = await S.loadOrder(tx, req.params.id);
    if (o.delivery_type !== 'retiro') throw conflict('Los pedidos con delivery se cierran desde la entrega', 'USE_DELIVERY');
    return S.completeOrder(tx, req, req.params.id, req.body ?? {});
  }));

  /* ───────── Zonas de delivery (tarifas) ───────── */
  app.get('/api/v1/delivery-zones', { config: access.anyPerm('pedidos.view', 'delivery.view', 'delivery.edit') }, async () => {
    const { rows } = await pool.query('SELECT id, name, fee_pyg, active FROM delivery_zones ORDER BY sort_order, name');
    return { data: rows.map((z) => ({ id: z.id, name: z.name, feePyg: z.fee_pyg, active: z.active })) };
  });
  app.post('/api/v1/delivery-zones', { config: access.perm('delivery.edit'), schema: { body: { type: 'object', required: ['name', 'feePyg'], additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 80 }, feePyg: { type: 'integer', minimum: 0, maximum: 100000000 } } } } }, async (req, reply) => {
    const z = await withTransaction(pool, async (tx) => { const { rows } = await tx.query('INSERT INTO delivery_zones(name, fee_pyg, sort_order) VALUES ($1,$2,(SELECT COALESCE(max(sort_order),0)+1 FROM delivery_zones)) RETURNING id, name, fee_pyg', [req.body.name.trim(), req.body.feePyg]); await audit(tx, req, { action: 'delivery_zone.created', entity: 'delivery_zone', entityId: rows[0].id, after: req.body }); return rows[0]; });
    reply.code(201); return { id: z.id, name: z.name, feePyg: z.fee_pyg };
  });
  app.patch('/api/v1/delivery-zones/:id', { config: access.perm('delivery.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 80 }, feePyg: { type: 'integer', minimum: 0, maximum: 100000000 }, active: { type: 'boolean' } } } } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows: cur } = await tx.query('SELECT * FROM delivery_zones WHERE id = $1 FOR UPDATE', [req.params.id]); if (!cur.length) throw notFound('Zona no encontrada');
    await tx.query('UPDATE delivery_zones SET name = COALESCE($2, name), fee_pyg = COALESCE($3, fee_pyg), active = COALESCE($4, active) WHERE id = $1', [req.params.id, req.body.name?.trim() ?? null, req.body.feePyg ?? null, req.body.active ?? null]);
    await audit(tx, req, { action: 'delivery_zone.updated', entity: 'delivery_zone', entityId: req.params.id, before: { name: cur[0].name, feePyg: cur[0].fee_pyg, active: cur[0].active }, after: req.body }); return { ok: true };
  }));
  void badRequest;
};
