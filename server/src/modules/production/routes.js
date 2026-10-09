'use strict';
const access = require('../../lib/access');
const { notFound } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { querySchema, offset, meta } = require('../../lib/pagination');
const S = require('./service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };

module.exports = async function productionRoutes(app) {
  const { pool } = app;
  const BASE = `FROM production_orders p JOIN orders o ON o.id = p.order_id LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = p.assigned_to`;
  const shape = (r) => ({ id: r.id, orderId: r.order_id, orderNumber: r.number, orderStatus: r.order_status, description: r.description, qty: r.qty, status: r.status, customer: r.customer_name, recipient: r.ship_name,
    requestedDate: r.requested_date, timeSlot: r.time_slot, cardMessage: r.card_message, notes: r.notes, assignedTo: r.assigned_to ? { id: r.assigned_to, name: r.assigned_name } : null,
    checklistDone: r.done, checklistTotal: r.total, startedAt: r.started_at, readyAt: r.ready_at, costKnown: r.cost_known, ...(r.seeCost ? { costPyg: r.cost_total_pyg } : {}) });
  const COLS = `p.*, o.number, o.status AS order_status, o.requested_date, o.time_slot, o.card_message, o.ship_name, c.name AS customer_name, u.full_name AS assigned_name,
                (SELECT count(*) FILTER (WHERE done)::int FROM production_checklist k WHERE k.production_order_id = p.id) AS done, (SELECT count(*)::int FROM production_checklist k WHERE k.production_order_id = p.id) AS total`;

  app.get('/api/v1/production', { config: access.perm('produccion.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    status: { type: 'string', enum: ['all', 'active', 'pendiente', 'en_preparacion', 'control_calidad', 'listo', 'cancelado'], default: 'active' }, date: { type: 'string', format: 'date' }, assignedTo: id } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    if (q.status === 'active') conds.push(`p.status IN ('pendiente','en_preparacion','control_calidad')`); else if (q.status !== 'all') { args.push(q.status); conds.push(`p.status = $${args.length}`); }
    if (q.date) { args.push(q.date); conds.push(`o.requested_date = $${args.length}`); }
    if (q.assignedTo) { args.push(q.assignedTo); conds.push(`p.assigned_to = $${args.length}`); }
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(o.number ILIKE $${args.length} OR p.description ILIKE $${args.length} OR c.name ILIKE $${args.length})`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS n ${BASE} ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(`SELECT ${COLS} ${BASE} ${where} ORDER BY o.requested_date NULLS LAST, o.time_slot NULLS LAST, p.id LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    const counts = (await pool.query(`SELECT p.status, count(*)::int AS n FROM production_orders p GROUP BY p.status`)).rows;
    return { data: rows.map(shape), meta: meta(q, total), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });

  app.get('/api/v1/production/:id', { config: access.perm('produccion.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(`SELECT ${COLS} ${BASE} WHERE p.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Orden de producción no encontrada');
    const seeCost = req.permissions.has('finanzas.view') || req.permissions.has('reportes.view');
    const p = rows[0]; p.seeCost = seeCost;
    const m = await S.materialsFor(pool, p);
    const mats = [];
    for (const n of m.needs) { const r = (await pool.query('SELECT name, unit FROM products WHERE id = $1', [n.productId])).rows[0]; mats.push({ productId: n.productId, name: r.name, unit: r.unit, qty: n.milli / 1000 }); }
    return { ...shape(p), checklist: (await S.checklist(pool, p.id)).map((c) => ({ code: c.code, step: c.step, done: c.done, doneAt: c.done_at })), materials: mats, materialsKind: m.kind };
  });

  const act = (path, fn, body) => app.post(`/api/v1/production/:id/${path}`, { config: access.perm('produccion.edit'), schema: { params: idParams, ...(body ? { body } : {}) } },
    async (req) => { const r = await withTransaction(pool, (tx) => fn(tx, req)); return { ok: true, ...(r ?? {}) }; });
  act('start', (tx, req) => S.startProduction(tx, req, req.params.id));
  act('quality', (tx, req) => S.toQuality(tx, req, req.params.id));
  act('approve', (tx, req) => S.approve(tx, req, req.params.id));
  act('reject', (tx, req) => S.reject(tx, req, req.params.id, req.body.note.trim()), { type: 'object', required: ['note'], additionalProperties: false, properties: { note: { type: 'string', minLength: 3, maxLength: 300 } } });
  app.put('/api/v1/production/:id/checklist/:code', { config: access.perm('produccion.edit'), schema: { params: { type: 'object', required: ['id', 'code'], properties: { id, code: { type: 'string', pattern: '^[a-z_]+$', maxLength: 30 } } },
    body: { type: 'object', required: ['done'], additionalProperties: false, properties: { done: { type: 'boolean' } } } } }, async (req) => { await withTransaction(pool, (tx) => S.setChecklist(tx, req, req.params.id, req.params.code, req.body.done)); return { ok: true }; });
  app.put('/api/v1/production/:id/assignee', { config: access.perm('produccion.edit'), schema: { params: idParams, body: { type: 'object', required: ['userId'], additionalProperties: false, properties: { userId: { type: ['integer', 'null'], minimum: 1 } } } } },
    async (req) => { await withTransaction(pool, (tx) => S.assign(tx, req, req.params.id, req.body.userId)); return { ok: true }; });
};
