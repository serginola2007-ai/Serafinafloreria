'use strict';
const access = require('../../lib/access');
const { createRegistry } = require('../integrations/registry');

/**
 * Resumen del panel. SOLO datos reales de la base y solo las secciones que el usuario tiene permiso de ver.
 * Los indicadores de ventas, stock, caja, etc. se agregan cuando existan esos módulos (no hay números de relleno).
 */
module.exports = async function dashboardRoutes(app) {
  const { pool } = app;
  const registry = createRegistry(app.integrationEnv || process.env);
  const can = (req, ...codes) => codes.some((c) => req.permissions.has(c));

  app.get('/api/v1/dashboard/summary', { config: access.authenticated }, async (req) => {
    const out = {};
    if (can(req, 'productos.view')) {
      const { rows } = await pool.query(
        `SELECT count(*) FILTER (WHERE active AND archived_at IS NULL AND NOT needs_review)::int AS published,
                count(*) FILTER (WHERE needs_review)::int AS needs_review,
                count(*) FILTER (WHERE archived_at IS NOT NULL OR NOT active)::int AS inactive,
                (SELECT count(*)::int FROM product_categories WHERE archived_at IS NULL) AS categories
           FROM products`);
      out.catalog = rows[0];
    }
    if (can(req, 'usuarios.view')) {
      const { rows } = await pool.query(`SELECT count(*) FILTER (WHERE active)::int AS active, count(*) FILTER (WHERE NOT active)::int AS inactive FROM users`);
      out.users = rows[0];
    }
    if (can(req, 'ventas.view')) {
      const { rows } = await pool.query(
        `SELECT count(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_count,
                COALESCE(sum(total_pyg) FILTER (WHERE created_at >= CURRENT_DATE), 0)::bigint AS today_total,
                count(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::int AS month_count,
                COALESCE(sum(total_pyg) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0)::bigint AS month_total,
                COALESCE(sum(total_pyg - paid_pyg) FILTER (WHERE paid_pyg < total_pyg), 0)::bigint AS receivable,
                COALESCE(sum(total_pyg - paid_pyg) FILTER (WHERE paid_pyg < total_pyg AND credit_due_date < CURRENT_DATE), 0)::bigint AS receivable_overdue
           FROM sales WHERE status = 'confirmada'`);
      out.sales = { ...rows[0], averageTicket: rows[0].month_count ? Math.round(rows[0].month_total / rows[0].month_count) : 0 };
    }
    if (can(req, 'pedidos.view')) {
      const { rows } = await pool.query(
        `SELECT count(*) FILTER (WHERE status = 'pendiente')::int AS pending, count(*) FILTER (WHERE status IN ('confirmado','pagado','pendiente_pago','en_preparacion'))::int AS in_progress,
                count(*) FILTER (WHERE status = 'listo')::int AS ready, count(*) FILTER (WHERE status IN ('confirmado','pagado','pendiente_pago','en_preparacion','listo','en_reparto','reprogramado','no_entregado') AND requested_date = CURRENT_DATE)::int AS due_today
           FROM orders`);
      out.orders = rows[0];
    }
    if (can(req, 'caja.view')) {
      const { rows } = await pool.query(`SELECT s.id, s.opened_at, COALESCE((SELECT sum(amount_pyg) FROM cash_movements m WHERE m.session_id = s.id), 0)::bigint AS expected FROM cash_sessions s WHERE s.closed_at IS NULL`);
      out.cash = rows[0] ? { open: true, openedAt: rows[0].opened_at, expectedCashPyg: rows[0].expected } : { open: false };
    }
    if (can(req, 'inventario.view')) {
      const { rows } = await pool.query(
        `SELECT count(*) FILTER (WHERE l.on_hand = 0)::int AS out,
                count(*) FILTER (WHERE l.on_hand > 0 AND l.min_stock > 0 AND l.on_hand - l.reserved <= l.min_stock)::int AS low,
                COALESCE(sum(round(l.on_hand * p.avg_cost_pyg)), 0)::bigint AS value
           FROM products p JOIN inventory_levels l ON l.product_id = p.id WHERE p.is_stockable AND p.archived_at IS NULL`);
      out.inventory = rows[0];
    }
    if (can(req, 'compras.view', 'finanzas.view')) {
      const { rows } = await pool.query(
        `SELECT COALESCE(sum(total_pyg - paid_pyg), 0)::bigint AS payable,
                COALESCE(sum(total_pyg - paid_pyg) FILTER (WHERE due_date < CURRENT_DATE), 0)::bigint AS overdue,
                (SELECT count(*)::int FROM purchase_orders WHERE status IN ('enviada','parcial')) AS open_orders
           FROM payables WHERE paid_pyg < total_pyg`);
      out.purchasing = rows[0];
    }
    if (can(req, 'marketing.view', 'analytics.view', 'configuracion.view')) {
      const list = [...registry.values()];
      out.integrations = { total: list.length, withCredentials: list.filter((a) => a.status === 'credentials_present').length };
    }
    if (can(req, 'auditoria.view')) {
      const { rows } = await pool.query(
        `SELECT a.id, a.at, a.action, a.entity, a.entity_id, u.full_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 8`);
      out.recentActivity = rows.map((r) => ({ id: r.id, at: r.at, action: r.action, entity: r.entity, entityId: r.entity_id, userName: r.user_name }));
    }
    return out;
  });
};
