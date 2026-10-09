'use strict';
const access = require('../../lib/access');
const { badRequest, forbidden } = require('../../lib/errors');
const { audit } = require('../audit/audit');

const today = () => new Date().toISOString().slice(0, 10);
const range = { type: 'object', additionalProperties: false, properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } } };
/** Evita inyección de fórmulas al abrir el CSV en Excel/Sheets. */
const cell = (v) => { let s = v == null ? '' : (v instanceof Date ? v.toISOString() : String(v)); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

module.exports = async function reportsRoutes(app) {
  const { pool } = app;
  const period = (q) => {
    const now = new Date(); const from = q.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10); const to = q.to ?? today();
    if (from > to) throw badRequest('El rango de fechas es inválido', undefined, 'INVALID_RANGE'); return { from, to };
  };
  const csv = async (req, reply, name, head, rows, entity) => {
    await audit(pool, req, { action: 'report.exported', entity: 'report', after: { report: name, rows: rows.length, ...entity } });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`).header('cache-control', 'no-store')
      .send('﻿' + [head.join(',')].concat(rows.map((r) => r.map(cell).join(','))).join('\r\n') + '\r\n');
  };
  const SALES = `FROM sales s WHERE s.status = 'confirmada' AND s.created_at::date BETWEEN $1 AND $2`;

  // Costos y márgenes solo para quien ve finanzas (igual que en el detalle de ventas).
  app.get('/api/v1/reports/overview', { config: access.perm('reportes.view'), schema: { querystring: range } }, async (req) => {
    const { from, to } = period(req.query); const seeCost = req.permissions.has('finanzas.view');
    const byDay = (await pool.query(`SELECT s.created_at::date AS day, count(*)::int AS n, sum(s.total_pyg)::bigint AS total ${SALES} GROUP BY 1 ORDER BY 1`, [from, to])).rows;
    const byChannel = (await pool.query(`SELECT s.channel, count(*)::int AS n, sum(s.total_pyg)::bigint AS total ${SALES} GROUP BY 1 ORDER BY total DESC`, [from, to])).rows;
    const byMethod = (await pool.query(`SELECT m.name, sum(p.amount_pyg)::bigint AS total FROM payments p JOIN payment_methods m ON m.id = p.method_id JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'confirmada' AND s.created_at::date BETWEEN $1 AND $2 GROUP BY m.name ORDER BY total DESC`, [from, to])).rows;
    const top = (await pool.query(`SELECT i.description, sum(i.qty)::int AS qty, sum(i.line_total_pyg)::bigint AS revenue, sum(i.cost_total_pyg) FILTER (WHERE i.cost_known)::bigint AS cost, bool_and(i.cost_known) AS cost_known
      FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.status = 'confirmada' AND s.created_at::date BETWEEN $1 AND $2 GROUP BY i.description ORDER BY revenue DESC LIMIT 10`, [from, to])).rows;
    const customers = (await pool.query(`SELECT c.id, c.name, count(*)::int AS n, sum(s.total_pyg)::bigint AS total FROM sales s JOIN customers c ON c.id = s.customer_id
      WHERE s.status = 'confirmada' AND s.created_at::date BETWEEN $1 AND $2 GROUP BY c.id, c.name ORDER BY total DESC LIMIT 10`, [from, to])).rows;
    return { from, to, byDay: byDay.map((d) => ({ day: d.day, sales: d.n, totalPyg: Number(d.total) })), byChannel: byChannel.map((c) => ({ channel: c.channel, sales: c.n, totalPyg: Number(c.total) })),
      byMethod: byMethod.map((m) => ({ method: m.name, totalPyg: Number(m.total) })), topCustomers: customers.map((c) => ({ id: c.id, name: c.name, sales: c.n, totalPyg: Number(c.total) })),
      topProducts: top.map((t) => ({ description: t.description, qty: t.qty, revenuePyg: Number(t.revenue), ...(seeCost ? { costPyg: t.cost_known ? Number(t.cost) : null, marginPyg: t.cost_known ? Number(t.revenue) - Number(t.cost) : null } : {}) })) };
  });

  app.get('/api/v1/reports/sales.csv', { config: access.perm('reportes.export'), schema: { querystring: range } }, async (req, reply) => {
    const { from, to } = period(req.query); const seeCost = req.permissions.has('finanzas.view');
    const { rows } = await pool.query(`SELECT s.number, s.created_at, s.channel, c.name AS customer, s.subtotal_pyg, s.discount_pyg, s.delivery_fee_pyg, s.total_pyg, s.paid_pyg,
      (SELECT sum(cost_total_pyg) FROM sale_items i WHERE i.sale_id = s.id) AS cost, (SELECT bool_and(cost_known) FROM sale_items i WHERE i.sale_id = s.id) AS cost_known
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.status = 'confirmada' AND s.created_at::date BETWEEN $1 AND $2 ORDER BY s.id`, [from, to]);
    const head = ['numero', 'fecha', 'canal', 'cliente', 'subtotal_pyg', 'descuento_pyg', 'delivery_pyg', 'total_pyg', 'cobrado_pyg', 'saldo_pyg', ...(seeCost ? ['costo_pyg', 'margen_pyg'] : [])];
    return csv(req, reply, `ventas_${from}_${to}`, head, rows.map((r) => [r.number, r.created_at, r.channel, r.customer, r.subtotal_pyg, r.discount_pyg, r.delivery_fee_pyg, r.total_pyg, r.paid_pyg, r.total_pyg - r.paid_pyg,
      ...(seeCost ? [r.cost_known ? r.cost : '', r.cost_known ? r.total_pyg - r.cost : ''] : [])]), { from, to });
  });
  app.get('/api/v1/reports/expenses.csv', { config: access.perm('finanzas.view'), schema: { querystring: range } }, async (req, reply) => {
    if (!req.permissions.has('reportes.export')) throw forbidden(); // exige AMBOS permisos: finanzas.view y reportes.export
    const { from, to } = period(req.query);
    const { rows } = await pool.query(`SELECT e.number, e.expense_date, c.name AS category, e.concept, e.amount_pyg, m.name AS method, s.name AS supplier, e.document_no, e.status
      FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN payment_methods m ON m.id = e.method_id LEFT JOIN suppliers s ON s.id = e.supplier_id WHERE e.expense_date BETWEEN $1 AND $2 ORDER BY e.expense_date, e.id`, [from, to]);
    return csv(req, reply, `gastos_${from}_${to}`, ['numero', 'fecha', 'categoria', 'concepto', 'monto_pyg', 'forma_pago', 'proveedor', 'documento', 'estado'], rows.map((r) => [r.number, r.expense_date, r.category, r.concept, r.amount_pyg, r.method, r.supplier, r.document_no, r.status]), { from, to });
  });
  app.get('/api/v1/reports/inventory.csv', { config: access.perm('reportes.export') }, async (req, reply) => {
    const seeCost = req.permissions.has('finanzas.view');
    const { rows } = await pool.query(`SELECT p.name, p.sku, p.unit, l.on_hand, l.reserved, l.min_stock, p.avg_cost_pyg FROM products p JOIN inventory_levels l ON l.product_id = p.id WHERE p.is_stockable AND p.archived_at IS NULL ORDER BY p.name`);
    return csv(req, reply, `inventario_${today()}`, ['producto', 'sku', 'unidad', 'fisico', 'reservado', 'disponible', 'minimo', ...(seeCost ? ['costo_promedio_pyg', 'valor_pyg'] : [])],
      rows.map((r) => [r.name, r.sku, r.unit, r.on_hand, r.reserved, Number(r.on_hand) - Number(r.reserved), r.min_stock, ...(seeCost ? [r.avg_cost_pyg, Math.round(Number(r.on_hand) * Number(r.avg_cost_pyg))] : [])]), {});
  });
  app.get('/api/v1/reports/receivables.csv', { config: access.perm('reportes.export') }, async (req, reply) => {
    const { rows } = await pool.query(`SELECT s.number, c.name AS customer, c.phone, s.total_pyg, s.paid_pyg, s.credit_due_date FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.status = 'confirmada' AND s.paid_pyg < s.total_pyg ORDER BY s.credit_due_date NULLS LAST, s.id`);
    return csv(req, reply, `por_cobrar_${today()}`, ['venta', 'cliente', 'telefono', 'total_pyg', 'cobrado_pyg', 'saldo_pyg', 'vence', 'vencida'],
      rows.map((r) => [r.number, r.customer, r.phone, r.total_pyg, r.paid_pyg, r.total_pyg - r.paid_pyg, r.credit_due_date, r.credit_due_date && String(r.credit_due_date).length && new Date(r.credit_due_date) < new Date(today()) ? 'si' : 'no']), {});
  });
};
