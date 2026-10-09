'use strict';
const access = require('../../lib/access');
const { notFound, conflict, badRequest } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const S = require('./service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const STATUSES = ['pendiente', 'asignado', 'listo', 'en_camino', 'entregado', 'no_entregado', 'reprogramado', 'cancelado'];
const ACTIVE = ['pendiente', 'asignado', 'listo', 'en_camino', 'no_entregado', 'reprogramado'];

module.exports = async function deliveryRoutes(app) {
  const { pool } = app;
  const mapsLink = (d) => (d.lat != null && d.lng != null ? `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}` : d.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}` : null);
  const shape = (d) => ({ id: d.id, orderId: d.order_id, orderNumber: d.number, orderStatus: d.order_status, status: d.status, courier: d.courier_id ? { id: d.courier_id, name: d.courier_name } : null,
    routeId: d.route_id, routePosition: d.route_position, scheduledDate: d.scheduled_date, timeSlot: d.time_slot, recipient: d.recipient_name, phone: d.recipient_phone, address: d.address, zone: d.zone, reference: d.reference,
    cardMessage: d.card_message, balancePyg: Math.max(0, d.total_pyg - d.paid), mapsUrl: mapsLink(d), failureReason: d.failure_reason, hasProof: !!d.proof_media_id });
  const COLS = `d.*, o.number, o.status AS order_status, o.card_message, o.total_pyg, u.full_name AS courier_name, COALESCE((SELECT sum(amount_pyg) FROM payments p WHERE p.order_id = o.id), 0)::bigint AS paid`;
  const BASE = `FROM deliveries d JOIN orders o ON o.id = d.order_id LEFT JOIN users u ON u.id = d.courier_id`;
  const view = access.anyPerm('delivery.view', 'delivery.edit', 'delivery.own');

  app.get('/api/v1/deliveries', { config: view, schema: { querystring: { type: 'object', additionalProperties: false, properties: {
    status: { type: 'string', enum: ['all', 'active', ...STATUSES], default: 'active' }, date: { type: 'string', format: 'date' }, courierId: id, routeId: id, mine: { type: 'boolean' } } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    const seesAll = req.permissions.has('delivery.view') || req.permissions.has('delivery.edit');
    if (!seesAll || q.mine) { args.push(req.user.id); conds.push(`d.courier_id = $${args.length}`); } // repartidor: solo las suyas, impuesto en backend
    if (q.status === 'active') conds.push(`d.status = ANY('{${ACTIVE.join(',')}}')`); else if (q.status !== 'all') { args.push(q.status); conds.push(`d.status = $${args.length}`); }
    if (q.date) { args.push(q.date); conds.push(`d.scheduled_date = $${args.length}`); }
    if (q.courierId && seesAll) { args.push(q.courierId); conds.push(`d.courier_id = $${args.length}`); }
    if (q.routeId) { args.push(q.routeId); conds.push(`d.route_id = $${args.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await pool.query(`SELECT ${COLS} ${BASE} ${where} ORDER BY d.scheduled_date NULLS LAST, d.route_position NULLS LAST, d.time_slot NULLS LAST, d.id LIMIT 300`, args);
    return { data: rows.map(shape) };
  });

  app.get('/api/v1/deliveries/:id', { config: view, schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(`SELECT ${COLS} ${BASE} WHERE d.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Entrega no encontrada');
    S.assertCanOperate(req, rows[0]) ;
    return shape(rows[0]);
  });

  const act = (path, fn, perm, body) => app.post(`/api/v1/deliveries/:id/${path}`, { config: perm, schema: { params: idParams, ...(body ? { body } : {}) } },
    async (req) => { const r = await withTransaction(pool, (tx) => fn(tx, req)); return { ok: true, ...(r ?? {}) }; });
  const operate = access.anyPerm('delivery.edit', 'delivery.own');
  act('assign', (tx, req) => S.assign(tx, req, req.params.id, req.body.courierId), access.perm('delivery.edit'), { type: 'object', required: ['courierId'], additionalProperties: false, properties: { courierId: { type: ['integer', 'null'], minimum: 1 } } });
  act('start', (tx, req) => S.start(tx, req, req.params.id), operate);
  act('deliver', (tx, req) => S.deliver(tx, req, req.params.id, req.body ?? {}), operate, { type: 'object', additionalProperties: false, properties: { proofMediaId: { type: ['integer', 'null'], minimum: 1 }, creditDueDate: { type: ['string', 'null'], format: 'date' } } });
  act('fail', (tx, req) => S.fail(tx, req, req.params.id, req.body.reason.trim()), operate, { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 3, maxLength: 300 } } });
  act('reschedule', (tx, req) => S.reschedule(tx, req, req.params.id, req.body), operate, { type: 'object', required: ['date', 'reason'], additionalProperties: false, properties: { date: { type: 'string', format: 'date' }, timeSlot: { type: ['string', 'null'], maxLength: 60 }, reason: { type: 'string', minLength: 3, maxLength: 300 } } });

  // Repartidores disponibles (usuarios activos con permiso de entregas propias) para el selector de asignación.
  app.get('/api/v1/delivery-couriers', { config: access.perm('delivery.edit') }, async () => {
    const { rows } = await pool.query(`SELECT DISTINCT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.active AND (r.is_superuser = false) AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code = 'delivery.own') ORDER BY u.full_name`);
    return { data: rows.map((u) => ({ id: u.id, name: u.full_name })) };
  });

  /* ───────── Rutas ───────── */
  app.get('/api/v1/delivery-routes', { config: view, schema: { querystring: { type: 'object', properties: { date: { type: 'string', format: 'date' } } } } }, async (req) => {
    const args = []; const conds = [];
    if (!(req.permissions.has('delivery.view') || req.permissions.has('delivery.edit'))) { args.push(req.user.id); conds.push(`r.courier_id = $${args.length}`); }
    if (req.query.date) { args.push(req.query.date); conds.push(`r.route_date = $${args.length}`); }
    const { rows } = await pool.query(`SELECT r.*, u.full_name AS courier_name, (SELECT count(*)::int FROM deliveries d WHERE d.route_id = r.id) AS stops FROM delivery_routes r LEFT JOIN users u ON u.id = r.courier_id
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY r.route_date DESC, r.id DESC LIMIT 100`, args);
    return { data: rows.map((r) => ({ id: r.id, date: r.route_date, name: r.name, status: r.status, stops: r.stops, courier: r.courier_id ? { id: r.courier_id, name: r.courier_name } : null })) };
  });
  // Crea la ruta y ordena las paradas indicadas (el orden del arreglo es el orden de visita).
  app.post('/api/v1/delivery-routes', { config: access.perm('delivery.edit'), schema: { body: { type: 'object', required: ['date', 'deliveryIds'], additionalProperties: false, properties: {
    date: { type: 'string', format: 'date' }, name: { type: ['string', 'null'], maxLength: 80 }, courierId: { type: ['integer', 'null'], minimum: 1 }, deliveryIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: id } } } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      const { rows: [r] } = await tx.query('INSERT INTO delivery_routes(route_date, courier_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [b.date, b.courierId ?? null, b.name?.trim() || null, req.user.id]);
      let pos = 1;
      for (const did of b.deliveryIds) {
        const d = await S.loadDelivery(tx, did);
        if (['entregado', 'cancelado'].includes(d.status)) throw conflict(`La entrega ${did} ya está cerrada`, 'INVALID_STATE');
        await tx.query('UPDATE deliveries SET route_id = $2, route_position = $3 WHERE id = $1', [did, r.id, pos++]);
        if (b.courierId && d.courier_id !== b.courierId) await S.assign(tx, req, did, b.courierId);
      }
      await audit(tx, req, { action: 'delivery_route.created', entity: 'delivery_route', entityId: r.id, after: b });
      return r;
    });
    reply.code(201); return { id: out.id };
  });
  app.put('/api/v1/delivery-routes/:id/order', { config: access.perm('delivery.edit'), schema: { params: idParams, body: { type: 'object', required: ['deliveryIds'], additionalProperties: false, properties: { deliveryIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: id } } } } }, async (req) => withTransaction(pool, async (tx) => {
    if (!(await tx.query('SELECT 1 FROM delivery_routes WHERE id = $1 FOR UPDATE', [req.params.id])).rowCount) throw notFound('Ruta no encontrada');
    const { rows } = await tx.query('SELECT id FROM deliveries WHERE route_id = $1', [req.params.id]);
    const cur = new Set(rows.map((r) => r.id));
    if (req.body.deliveryIds.length !== cur.size || req.body.deliveryIds.some((d) => !cur.has(d))) throw badRequest('El orden debe incluir exactamente las paradas de la ruta', undefined, 'ROUTE_MISMATCH');
    let pos = 1; for (const did of req.body.deliveryIds) await tx.query('UPDATE deliveries SET route_position = $2 WHERE id = $1', [did, pos++]);
    await audit(tx, req, { action: 'delivery_route.reordered', entity: 'delivery_route', entityId: req.params.id, after: req.body }); return { ok: true };
  }));
};
