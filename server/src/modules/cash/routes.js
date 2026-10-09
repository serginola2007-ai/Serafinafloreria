'use strict';
const access = require('../../lib/access');
const { notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');
const cash = require('./service');

const pyg = { type: 'integer', minimum: 0, maximum: 1000000000000 };

module.exports = async function cashRoutes(app) {
  const { pool } = app;
  const shape = (s, extra = {}) => ({ id: s.id, openedAt: s.opened_at, openedBy: s.opened_by_name, openingAmountPyg: s.opening_amount_pyg, closedAt: s.closed_at, closedBy: s.closed_by_name,
    expectedCashPyg: s.expected_cash_pyg, countedCashPyg: s.counted_cash_pyg, differencePyg: s.difference_pyg, note: s.note, ...extra });
  const SESSION_SQL = `SELECT s.*, uo.full_name AS opened_by_name, uc.full_name AS closed_by_name FROM cash_sessions s JOIN users uo ON uo.id = s.opened_by LEFT JOIN users uc ON uc.id = s.closed_by`;

  async function summary(db, s) {
    const byType = (await db.query('SELECT type, sum(amount_pyg)::bigint AS total, count(*)::int AS n FROM cash_movements WHERE session_id = $1 GROUP BY type ORDER BY type', [s.id])).rows;
    const end = s.closed_at ?? new Date();
    const byMethod = (await db.query(
      `SELECT m.code, m.name, m.affects_cash, sum(p.amount_pyg)::bigint AS total, count(*)::int AS n FROM payments p JOIN payment_methods m ON m.id = p.method_id
        WHERE p.received_at >= $1 AND p.received_at <= $2 GROUP BY m.code, m.name, m.affects_cash, m.id ORDER BY m.id`, [s.opened_at, end])).rows;
    return { movementsByType: byType.map((r) => ({ type: r.type, totalPyg: r.total, count: r.n })), salesByMethod: byMethod.map((r) => ({ code: r.code, name: r.name, affectsCash: r.affects_cash, totalPyg: r.total, count: r.n })) };
  }

  app.get('/api/v1/cash/current', { config: access.perm('caja.view') }, async () => {
    const { rows } = await pool.query(`${SESSION_SQL} WHERE s.closed_at IS NULL`);
    if (!rows.length) return { open: false };
    const s = rows[0];
    return { open: true, session: shape(s, { expectedCashPyg: await cash.expectedCash(pool, s.id) }), ...(await summary(pool, s)) };
  });

  app.post('/api/v1/cash/open', { config: access.perm('caja.open'), schema: { body: { type: 'object', required: ['openingAmountPyg'], additionalProperties: false, properties: { openingAmountPyg: pyg } } } }, async (req, reply) => {
    const out = await withTransaction(pool, async (tx) => {
      if (await cash.currentSession(tx)) throw conflict('Ya hay una caja abierta', 'CASH_ALREADY_OPEN');
      const { rows: [s] } = await tx.query('INSERT INTO cash_sessions(opened_by, opening_amount_pyg) VALUES ($1,$2) RETURNING id', [req.user.id, req.body.openingAmountPyg]);
      if (req.body.openingAmountPyg > 0) await cash.addCashMovement(tx, { sessionId: s.id, type: 'apertura', amountPyg: req.body.openingAmountPyg, concept: 'Apertura de caja', userId: req.user.id });
      await audit(tx, req, { action: 'cash.opened', entity: 'cash_session', entityId: s.id, after: { openingAmountPyg: req.body.openingAmountPyg } });
      return { id: s.id };
    });
    reply.code(201); return out;
  });

  app.post('/api/v1/cash/close', { config: access.perm('caja.close'), schema: { body: { type: 'object', required: ['countedCashPyg'], additionalProperties: false, properties: { countedCashPyg: pyg, note: { type: ['string', 'null'], maxLength: 500 } } } } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM cash_sessions WHERE closed_at IS NULL FOR UPDATE');
    if (!rows.length) throw conflict('No hay una caja abierta', 'CASH_CLOSED');
    const s = rows[0]; const expected = await cash.expectedCash(tx, s.id); const diff = req.body.countedCashPyg - expected;
    await tx.query('UPDATE cash_sessions SET closed_at = now(), closed_by = $2, expected_cash_pyg = $3, counted_cash_pyg = $4, difference_pyg = $5, note = $6 WHERE id = $1',
      [s.id, req.user.id, expected, req.body.countedCashPyg, diff, req.body.note?.trim() || null]);
    await audit(tx, req, { action: 'cash.closed', entity: 'cash_session', entityId: s.id, after: { expectedCashPyg: expected, countedCashPyg: req.body.countedCashPyg, differencePyg: diff, note: req.body.note ?? null } });
    return { id: s.id, expectedCashPyg: expected, countedCashPyg: req.body.countedCashPyg, differencePyg: diff };
  }));

  // Ingresos, egresos y retiros manuales (siempre con concepto).
  app.post('/api/v1/cash/movements', { config: access.perm('caja.adjust'), schema: { body: { type: 'object', required: ['type', 'amountPyg', 'concept'], additionalProperties: false, properties: {
    type: { type: 'string', enum: ['ingreso', 'egreso', 'retiro'] }, amountPyg: { type: 'integer', minimum: 1, maximum: 1000000000000 }, concept: { type: 'string', minLength: 3, maxLength: 200 } } } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      const s = await cash.requireOpenSession(tx);
      const id = await cash.addCashMovement(tx, { sessionId: s.id, type: b.type, amountPyg: b.type === 'ingreso' ? b.amountPyg : -b.amountPyg, concept: b.concept.trim(), userId: req.user.id });
      await audit(tx, req, { action: `cash.${b.type}`, entity: 'cash_session', entityId: s.id, after: { movementId: id, amountPyg: b.amountPyg, concept: b.concept } });
      return { id, expectedCashPyg: await cash.expectedCash(tx, s.id) };
    });
    reply.code(201); return out;
  });

  app.get('/api/v1/cash/sessions', { config: access.perm('caja.view'), schema: { querystring: querySchema } }, async (req) => {
    const q = req.query; const total = (await pool.query('SELECT count(*)::int AS n FROM cash_sessions')).rows[0].n;
    const { rows } = await pool.query(`${SESSION_SQL} ORDER BY s.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`);
    return { data: rows.map((s) => shape(s)), meta: meta(q, total) };
  });
  app.get('/api/v1/cash/sessions/:id', { config: access.perm('caja.view'), schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } } }, async (req) => {
    const { rows } = await pool.query(`${SESSION_SQL} WHERE s.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Sesión de caja no encontrada');
    const mv = (await pool.query('SELECT m.*, u.full_name AS user_name FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id WHERE m.session_id = $1 ORDER BY m.id', [req.params.id])).rows;
    return { ...shape(rows[0], { expectedCashPyg: rows[0].closed_at ? rows[0].expected_cash_pyg : await cash.expectedCash(pool, rows[0].id) }), ...(await summary(pool, rows[0])),
      movements: mv.map((m) => ({ id: m.id, type: m.type, amountPyg: m.amount_pyg, concept: m.concept, referenceType: m.reference_type, referenceId: m.reference_id, user: m.user_name, at: m.at })) };
  });
};
