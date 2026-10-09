'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');
const { nextNumber } = require('../../lib/sequences');
const cash = require('../cash/service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const str = (max) => ({ type: ['string', 'null'], maxLength: max });
const today = () => new Date().toISOString().slice(0, 10);

module.exports = async function financeRoutes(app) {
  const { pool } = app;
  const row = (e) => ({ id: e.id, number: e.number, category: { id: e.category_id, name: e.category_name }, concept: e.concept, amountPyg: e.amount_pyg, date: e.expense_date, method: e.method_name, supplier: e.supplier_id ? { id: e.supplier_id, name: e.supplier_name } : null,
    documentNo: e.document_no, notes: e.notes, status: e.status, voidReason: e.void_reason, voidedAt: e.voided_at, createdBy: e.user_name, createdAt: e.created_at });
  const BASE = `FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN payment_methods m ON m.id = e.method_id LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN users u ON u.id = e.created_by`;
  const COLS = `e.*, c.name AS category_name, m.name AS method_name, s.name AS supplier_name, u.full_name AS user_name`;

  /* ───────── Categorías ───────── */
  app.get('/api/v1/expense-categories', { config: access.anyPerm('finanzas.view', 'finanzas.edit') }, async () => {
    const { rows } = await pool.query('SELECT id, name, active FROM expense_categories ORDER BY name');
    return { data: rows };
  });
  app.post('/api/v1/expense-categories', { config: access.perm('finanzas.edit'), schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 80 } } } } }, async (req, reply) => {
    const r = await withTransaction(pool, async (tx) => {
      try { const { rows } = await tx.query('INSERT INTO expense_categories(name) VALUES ($1) RETURNING id, name, active', [req.body.name.trim()]); await audit(tx, req, { action: 'expense_category.created', entity: 'expense_category', entityId: rows[0].id, after: rows[0] }); return rows[0]; }
      catch (e) { if (e.code === '23505') throw conflict('Ya existe una categoría con ese nombre', 'DUPLICATE'); throw e; }
    });
    reply.code(201); return r;
  });
  app.patch('/api/v1/expense-categories/:id', { config: access.perm('finanzas.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 80 }, active: { type: 'boolean' } } } } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows: cur } = await tx.query('SELECT * FROM expense_categories WHERE id = $1 FOR UPDATE', [req.params.id]); if (!cur.length) throw notFound('Categoría no encontrada');
    try { await tx.query('UPDATE expense_categories SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1', [req.params.id, req.body.name?.trim() ?? null, req.body.active ?? null]); }
    catch (e) { if (e.code === '23505') throw conflict('Ya existe una categoría con ese nombre', 'DUPLICATE'); throw e; }
    await audit(tx, req, { action: 'expense_category.updated', entity: 'expense_category', entityId: req.params.id, before: cur[0], after: req.body }); return { ok: true };
  }));

  /* ───────── Gastos ───────── */
  app.get('/api/v1/expenses', { config: access.perm('finanzas.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, categoryId: id, status: { type: 'string', enum: ['all', 'registrado', 'anulado'], default: 'registrado' } } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    if (q.status !== 'all') { args.push(q.status); conds.push(`e.status = $${args.length}`); }
    if (q.from) { args.push(q.from); conds.push(`e.expense_date >= $${args.length}`); } if (q.to) { args.push(q.to); conds.push(`e.expense_date <= $${args.length}`); }
    if (q.categoryId) { args.push(q.categoryId); conds.push(`e.category_id = $${args.length}`); }
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(e.concept ILIKE $${args.length} OR e.number ILIKE $${args.length} OR s.name ILIKE $${args.length})`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS n ${BASE} ${where}`, args)).rows[0].n;
    const sum = (await pool.query(`SELECT COALESCE(sum(e.amount_pyg) FILTER (WHERE e.status = 'registrado'), 0)::bigint AS s ${BASE} ${where}`, args)).rows[0].s;
    const { rows } = await pool.query(`SELECT ${COLS} ${BASE} ${where} ORDER BY e.expense_date DESC, e.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map(row), meta: meta(q, total), totalPyg: sum };
  });

  app.post('/api/v1/expenses', { config: access.perm('finanzas.edit'), schema: { body: { type: 'object', required: ['categoryId', 'concept', 'amountPyg', 'methodCode'], additionalProperties: false, properties: {
    categoryId: id, concept: { type: 'string', minLength: 2, maxLength: 200 }, amountPyg: { type: 'integer', minimum: 1, maximum: 1000000000000 }, date: { type: 'string', format: 'date' }, methodCode: { type: 'string', pattern: '^[a-z_]+$', maxLength: 30 },
    supplierId: { type: ['integer', 'null'], minimum: 1 }, documentNo: str(60), notes: str(500) } } } }, async (req, reply) => {
    const b = req.body; const date = b.date ?? today();
    if (date > today()) throw badRequest('La fecha del gasto no puede ser futura', undefined, 'FUTURE_DATE');
    const out = await withTransaction(pool, async (tx) => {
      const { rows: cat } = await tx.query('SELECT active FROM expense_categories WHERE id = $1', [b.categoryId]); if (!cat.length) throw badRequest('La categoría no existe', undefined, 'UNKNOWN_CATEGORY'); if (!cat[0].active) throw conflict('La categoría está inactiva', 'INACTIVE_CATEGORY');
      const { rows: mt } = await tx.query('SELECT id, affects_cash FROM payment_methods WHERE code = $1 AND active', [b.methodCode]); if (!mt.length) throw badRequest('Método de pago inválido', undefined, 'UNKNOWN_METHOD');
      if (b.supplierId && !(await tx.query('SELECT 1 FROM suppliers WHERE id = $1 AND archived_at IS NULL', [b.supplierId])).rowCount) throw badRequest('El proveedor no existe', undefined, 'UNKNOWN_SUPPLIER');
      const number = await nextNumber(tx, 'expense', 'G');
      const { rows: [e] } = await tx.query(`INSERT INTO expenses(number, category_id, concept, amount_pyg, expense_date, method_id, supplier_id, document_no, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [number, b.categoryId, b.concept.trim(), b.amountPyg, date, mt[0].id, b.supplierId ?? null, b.documentNo?.trim() || null, b.notes?.trim() || null, req.user.id]);
      if (mt[0].affects_cash) { // el efectivo sale de la caja abierta
        const s = await cash.requireOpenSession(tx);
        const cm = await cash.addCashMovement(tx, { sessionId: s.id, type: 'gasto', amountPyg: -b.amountPyg, concept: `Gasto ${number}: ${b.concept.trim()}`, referenceType: 'expense', referenceId: e.id, userId: req.user.id });
        await tx.query('UPDATE expenses SET cash_movement_id = $2 WHERE id = $1', [e.id, cm]);
      }
      await audit(tx, req, { action: 'expense.created', entity: 'expense', entityId: e.id, after: { number, categoryId: b.categoryId, amountPyg: b.amountPyg, date, method: b.methodCode } });
      return { id: e.id, number };
    });
    reply.code(201); return out;
  });

  // Los gastos no se borran: se anulan con motivo (si salió efectivo, vuelve a la caja abierta).
  app.post('/api/v1/expenses/:id/void', { config: access.perm('finanzas.edit'), schema: { params: idParams, body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 3, maxLength: 300 } } } } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [req.params.id]); if (!rows.length) throw notFound('Gasto no encontrado');
    const e = rows[0]; if (e.status === 'anulado') throw conflict('El gasto ya está anulado', 'ALREADY_VOIDED');
    let vcm = null;
    if (e.cash_movement_id) { const s = await cash.requireOpenSession(tx); vcm = await cash.addCashMovement(tx, { sessionId: s.id, type: 'ingreso', amountPyg: e.amount_pyg, concept: `Anulación gasto ${e.number}`, referenceType: 'expense', referenceId: e.id, userId: req.user.id }); }
    await tx.query(`UPDATE expenses SET status = 'anulado', voided_at = now(), voided_by = $2, void_reason = $3, void_cash_movement_id = $4 WHERE id = $1`, [e.id, req.user.id, req.body.reason.trim(), vcm]);
    await audit(tx, req, { action: 'expense.voided', entity: 'expense', entityId: e.id, before: { status: 'registrado', amountPyg: e.amount_pyg }, after: { reason: req.body.reason.trim() } });
    return { ok: true };
  }));

  /* ───────── Resumen financiero ───────── */
  // Ventas − costo de lo vendido (congelado en cada venta) − gastos operativos. Si hay líneas sin costo conocido NO se inventa el resultado.
  app.get('/api/v1/finance/summary', { config: access.perm('finanzas.view'), schema: { querystring: { type: 'object', additionalProperties: false, properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } } } } }, async (req) => {
    const now = new Date(); const from = req.query.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10); const to = req.query.to ?? today();
    if (from > to) throw badRequest('El rango de fechas es inválido', undefined, 'INVALID_RANGE');
    const r = (await pool.query(`SELECT count(*)::int AS n, COALESCE(sum(s.total_pyg), 0)::bigint AS total FROM sales s WHERE s.status = 'confirmada' AND s.created_at::date BETWEEN $1 AND $2`, [from, to])).rows[0];
    const c = (await pool.query(`SELECT COALESCE(sum(i.cost_total_pyg) FILTER (WHERE i.cost_known), 0)::bigint AS cost, count(*) FILTER (WHERE NOT i.cost_known)::int AS unknown, COALESCE(sum(i.line_total_pyg) FILTER (WHERE i.cost_known), 0)::bigint AS known_revenue
      FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.status = 'confirmada' AND s.created_at::date BETWEEN $1 AND $2`, [from, to])).rows[0];
    const ex = (await pool.query(`SELECT c.id, c.name, COALESCE(sum(e.amount_pyg), 0)::bigint AS total FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.status = 'registrado' AND e.expense_date BETWEEN $1 AND $2 GROUP BY c.id, c.name ORDER BY total DESC`, [from, to])).rows;
    const expenses = ex.reduce((s, x) => s + Number(x.total), 0);
    const rec = (await pool.query(`SELECT COALESCE(sum(total_pyg - paid_pyg), 0)::bigint AS v FROM sales WHERE status = 'confirmada' AND paid_pyg < total_pyg`)).rows[0].v;
    const pay = (await pool.query(`SELECT COALESCE(sum(total_pyg - paid_pyg), 0)::bigint AS v FROM payables WHERE paid_pyg < total_pyg`)).rows[0].v;
    const complete = c.unknown === 0; const gross = Number(r.total) - Number(c.cost);
    return { from, to, salesCount: r.n, salesPyg: Number(r.total), costPyg: Number(c.cost), costComplete: complete, unknownCostLines: c.unknown,
      grossMarginPyg: complete ? gross : null, expensesPyg: expenses, operatingResultPyg: complete ? gross - expenses : null,
      expensesByCategory: ex.map((x) => ({ categoryId: x.id, name: x.name, totalPyg: Number(x.total) })), receivablePyg: Number(rec), payablePyg: Number(pay),
      note: 'Las compras de mercadería no se cuentan como gasto: llegan al resultado como costo de lo vendido. Es un resumen de gestión, no un balance contable.' };
  });
};
