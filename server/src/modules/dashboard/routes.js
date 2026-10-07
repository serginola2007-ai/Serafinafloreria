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
