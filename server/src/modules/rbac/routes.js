'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict, forbidden } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');

module.exports = async function rbacRoutes(app) {
  const { pool } = app;

  app.get('/api/v1/permissions', { config: access.perm('roles.view') }, async () => {
    const { rows } = await pool.query('SELECT code, module, description FROM permissions ORDER BY module, code');
    const modules = {};
    for (const r of rows) (modules[r.module] ||= []).push({ code: r.code, description: r.description });
    return { data: rows, modules };
  });

  app.get('/api/v1/roles', { config: access.perm('roles.view') }, async () => {
    const { rows } = await pool.query(
      `SELECT r.code, r.name, r.description, r.is_system, r.is_superuser,
              COALESCE((SELECT array_agg(p.code ORDER BY p.code) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id), '{}') AS permissions,
              (SELECT count(*)::int FROM users u WHERE u.role_id = r.id AND u.active) AS active_users
         FROM roles r ORDER BY r.id`);
    return { data: rows.map((r) => ({ code: r.code, name: r.name, description: r.description, isSystem: r.is_system, isSuperuser: r.is_superuser,
      permissions: r.is_superuser ? ['*'] : r.permissions, activeUsers: r.active_users })) };
  });

  app.put('/api/v1/roles/:code/permissions', {
    config: access.perm('roles.edit'),
    schema: { params: { type: 'object', required: ['code'], properties: { code: { type: 'string', pattern: '^[a-z_]+$' } } },
      body: { type: 'object', required: ['permissions'], additionalProperties: false,
        properties: { permissions: { type: 'array', items: { type: 'string', pattern: '^[a-z_]+\\.[a-z_]+$' }, maxItems: 200, uniqueItems: true } } } },
  }, async (req) => {
    const { code } = req.params; const wanted = req.body.permissions;
    return withTransaction(pool, async (tx) => {
      const { rows: rr } = await tx.query('SELECT id, is_superuser FROM roles WHERE code = $1 FOR UPDATE', [code]);
      if (!rr.length) throw notFound('Rol no encontrado');
      if (rr[0].is_superuser) throw conflict('El rol Administrador no se puede editar', 'SUPERUSER_FIXED');
      const { rows: known } = await tx.query('SELECT id, code FROM permissions WHERE code = ANY($1::text[])', [wanted]);
      const unknown = wanted.filter((c) => !known.some((k) => k.code === c));
      if (unknown.length) throw badRequest('Permisos inexistentes', { unknown }, 'UNKNOWN_PERMISSION');
      const { rows: cur } = await tx.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1', [rr[0].id]);
      const before = cur.map((c) => c.code).sort();
      const added = wanted.filter((c) => !before.includes(c));
      if (!req.user.role.isSuperuser && added.some((c) => !req.permissions.has(c))) throw forbidden('No podés otorgar permisos que no tenés', 'ESCALATION');
      await tx.query('DELETE FROM role_permissions WHERE role_id = $1', [rr[0].id]);
      for (const k of known) await tx.query('INSERT INTO role_permissions(role_id, permission_id) VALUES ($1,$2)', [rr[0].id, k.id]);
      const after = [...wanted].sort();
      await audit(tx, req, { action: 'role.permissions_set', entity: 'role', entityId: code, before: { permissions: before }, after: { permissions: after } });
      return { code, permissions: after };
    });
  });
};
