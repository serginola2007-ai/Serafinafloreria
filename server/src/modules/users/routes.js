'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict, forbidden } = require('../../lib/errors');
const { passwordProblem } = require('../../lib/passwords');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { revokeUserSessions } = require('../auth/sessions');
const { loadAccess } = require('../rbac/service');
const { querySchema, offset, meta } = require('../../lib/pagination');

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } };
const emailProp = { type: 'string', format: 'email', maxLength: 254 };
const nameProp = { type: 'string', minLength: 1, maxLength: 120 };
const codeProp = { type: 'string', pattern: '^[a-z_]+$', maxLength: 40 };
const permCode = { type: 'string', pattern: '^[a-z_]+\\.[a-z_]+$', maxLength: 60 };

const USER_SQL = `SELECT u.id, u.email, u.full_name, u.active, u.must_change_password, u.last_login_at, u.created_at,
                         r.code AS role_code, r.name AS role_name, r.is_superuser
                    FROM users u JOIN roles r ON r.id = u.role_id`;
const shape = (r) => ({ id: r.id, email: r.email, fullName: r.full_name, active: r.active, mustChangePassword: r.must_change_password,
  lastLoginAt: r.last_login_at, createdAt: r.created_at, role: { code: r.role_code, name: r.role_name, isSuperuser: r.is_superuser } });

module.exports = async function usersRoutes(app) {
  const { pool, hasher } = app;
  const actorIsSuper = (req) => req.user.role.isSuperuser;

  async function getUser(db, id, lock = false) {
    const { rows } = await db.query(`${USER_SQL} WHERE u.id = $1${lock ? ' FOR UPDATE OF u' : ''}`, [id]);
    if (!rows.length) throw notFound('Usuario no encontrado');
    return rows[0];
  }
  async function roleByCode(db, code) {
    const { rows } = await db.query('SELECT id, code, is_superuser FROM roles WHERE code = $1', [code]);
    if (!rows.length) throw badRequest('Rol inexistente', { roleCode: code }, 'UNKNOWN_ROLE');
    return rows[0];
  }
  /** Nunca puede quedar el sistema sin un Administrador activo. */
  async function assertNotLastSuperuser(db, target) {
    if (!target.is_superuser || !target.active) return;
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_superuser AND u.active AND u.id <> $1`, [target.id]);
    if (rows[0].n === 0) throw conflict('No se puede quitar al último Administrador activo', 'LAST_ADMIN');
  }

  const SORTS = { name: 'u.full_name', email: 'u.email', role: 'r.name', lastLogin: 'u.last_login_at', created: 'u.created_at' };
  const listQuery = { ...querySchema, properties: { ...querySchema.properties,
    sort: { type: 'string', enum: Object.keys(SORTS), default: 'name' }, dir: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
    active: { type: 'boolean' } } };
  app.get('/api/v1/users', { config: access.perm('usuarios.view'), schema: { querystring: listQuery } }, async (req) => {
    const q = req.query; const args = []; let where = '';
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); where = 'WHERE (u.email::text ILIKE $1 OR u.full_name ILIKE $1)'; }
    if (q.active !== undefined) { args.push(q.active); where += (where ? ' AND' : 'WHERE') + ` u.active = $${args.length}`; }
    const total = (await pool.query(`SELECT count(*)::int AS n FROM users u ${where}`, args)).rows[0].n;
    const order = `${SORTS[q.sort]} ${q.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, u.id`; // columnas de una lista blanca
    const { rows } = await pool.query(`${USER_SQL} ${where} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map(shape), meta: meta(q, total) };
  });

  app.get('/api/v1/users/:id', { config: access.perm('usuarios.view'), schema: { params: idParams } }, async (req) => {
    const u = await getUser(pool, req.params.id);
    const acc = await loadAccess(pool, u.id);
    const { rows: ov } = await pool.query(
      `SELECT p.code, up.effect FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = $1 ORDER BY p.code`, [u.id]);
    return { ...shape(u), effectivePermissions: [...acc.permissions].sort(),
      overrides: { allow: ov.filter((o) => o.effect === 'allow').map((o) => o.code), deny: ov.filter((o) => o.effect === 'deny').map((o) => o.code) } };
  });

  app.post('/api/v1/users', {
    config: access.perm('usuarios.create'),
    schema: { body: { type: 'object', required: ['email', 'fullName', 'roleCode', 'password'], additionalProperties: false,
      properties: { email: emailProp, fullName: nameProp, roleCode: codeProp, password: { type: 'string', maxLength: 256 } } } },
  }, async (req, reply) => {
    const b = req.body;
    const role = await roleByCode(pool, b.roleCode);
    if (role.is_superuser && !actorIsSuper(req)) throw forbidden('Solo un Administrador puede crear otro Administrador');
    const problem = passwordProblem(b.password, { email: b.email, fullName: b.fullName });
    if (problem) throw badRequest(problem, undefined, 'WEAK_PASSWORD');
    const hash = await hasher.hash(b.password);
    const id = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO users(email, full_name, password_hash, role_id, must_change_password, created_by) VALUES ($1,$2,$3,$4,true,$5) RETURNING id`,
        [b.email.trim(), b.fullName.trim(), hash, role.id, req.user.id]);
      await audit(tx, req, { action: 'user.created', entity: 'user', entityId: rows[0].id, after: { email: b.email.trim(), fullName: b.fullName.trim(), roleCode: b.roleCode } });
      return rows[0].id;
    });
    reply.code(201);
    return shape(await getUser(pool, id));
  });

  app.patch('/api/v1/users/:id', {
    config: access.perm('usuarios.edit'),
    schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false,
      properties: { fullName: nameProp, roleCode: codeProp, active: { type: 'boolean' } } } },
  }, async (req) => {
    const b = req.body; const id = req.params.id;
    return withTransaction(pool, async (tx) => {
      const before = await getUser(tx, id, true);
      if (before.is_superuser && !actorIsSuper(req)) throw forbidden('Solo un Administrador puede modificar a otro Administrador');
      const changesAccess = b.roleCode !== undefined || b.active !== undefined;
      if (id === req.user.id && changesAccess && ((b.roleCode && b.roleCode !== before.role_code) || b.active === false)) {
        throw conflict('No podés cambiar tu propio rol ni desactivarte', 'SELF_CHANGE');
      }
      const sets = []; const args = [id];
      const set = (col, v) => { args.push(v); sets.push(`${col} = $${args.length}`); };
      if (b.fullName !== undefined) set('full_name', b.fullName.trim());
      if (b.roleCode !== undefined) {
        const role = await roleByCode(tx, b.roleCode);
        if (role.is_superuser && !actorIsSuper(req)) throw forbidden('Solo un Administrador puede asignar el rol Administrador');
        if (before.is_superuser && !role.is_superuser) await assertNotLastSuperuser(tx, before);
        set('role_id', role.id);
      }
      if (b.active !== undefined) {
        if (b.active === false) await assertNotLastSuperuser(tx, before);
        set('active', b.active);
        if (b.active) { sets.push('failed_attempts = 0', 'locked_until = NULL'); }
      }
      await tx.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, args);
      if (b.active === false) await revokeUserSessions(tx, id);
      const after = await getUser(tx, id);
      await audit(tx, req, { action: 'user.updated', entity: 'user', entityId: id, before: shape(before), after: shape(after) });
      return shape(after);
    });
  });

  // El borrado es lógico: la fila se conserva por integridad histórica (ventas, auditoría, etc.).
  app.delete('/api/v1/users/:id', { config: access.perm('usuarios.delete'), schema: { params: idParams } }, async (req) => {
    const id = req.params.id;
    if (id === req.user.id) throw conflict('No podés desactivarte a vos mismo', 'SELF_CHANGE');
    return withTransaction(pool, async (tx) => {
      const before = await getUser(tx, id, true);
      if (before.is_superuser && !actorIsSuper(req)) throw forbidden('Solo un Administrador puede desactivar a otro Administrador');
      await assertNotLastSuperuser(tx, before);
      await tx.query('UPDATE users SET active = false WHERE id = $1', [id]);
      await revokeUserSessions(tx, id);
      await audit(tx, req, { action: 'user.deactivated', entity: 'user', entityId: id, before: { active: before.active }, after: { active: false } });
      return shape(await getUser(tx, id));
    });
  });

  app.post('/api/v1/users/:id/reset-password', {
    config: access.perm('usuarios.edit'),
    schema: { params: idParams, body: { type: 'object', required: ['password'], additionalProperties: false, properties: { password: { type: 'string', maxLength: 256 } } } },
  }, async (req) => {
    const id = req.params.id;
    return withTransaction(pool, async (tx) => {
      const u = await getUser(tx, id, true);
      if (u.is_superuser && !actorIsSuper(req)) throw forbidden('Solo un Administrador puede restablecer la contraseña de otro Administrador');
      const problem = passwordProblem(req.body.password, { email: u.email, fullName: u.full_name });
      if (problem) throw badRequest(problem, undefined, 'WEAK_PASSWORD');
      await tx.query(`UPDATE users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL WHERE id = $1`,
        [id, await hasher.hash(req.body.password)]);
      await revokeUserSessions(tx, id);
      await audit(tx, req, { action: 'user.password_reset', entity: 'user', entityId: id });
      return { ok: true };
    });
  });

  // Permisos individuales (rol "Personalizado" y excepciones). Reemplaza el conjunto completo.
  app.put('/api/v1/users/:id/permissions', {
    config: access.perm('roles.edit'),
    schema: { params: idParams, body: { type: 'object', required: ['allow', 'deny'], additionalProperties: false,
      properties: { allow: { type: 'array', items: permCode, maxItems: 200, uniqueItems: true }, deny: { type: 'array', items: permCode, maxItems: 200, uniqueItems: true } } } },
  }, async (req) => {
    const { allow, deny } = req.body; const id = req.params.id;
    const overlap = allow.filter((c) => deny.includes(c));
    if (overlap.length) throw badRequest('Un permiso no puede estar permitido y denegado a la vez', { overlap }, 'PERMISSION_OVERLAP');
    return withTransaction(pool, async (tx) => {
      const u = await getUser(tx, id, true);
      if (u.is_superuser) throw conflict('El Administrador tiene todos los permisos; no admite ajustes individuales', 'SUPERUSER_FIXED');
      const { rows: known } = await tx.query('SELECT id, code FROM permissions WHERE code = ANY($1::text[])', [[...allow, ...deny]]);
      const byCode = new Map(known.map((p) => [p.code, p.id]));
      const unknown = [...allow, ...deny].filter((c) => !byCode.has(c));
      if (unknown.length) throw badRequest('Permisos inexistentes', { unknown }, 'UNKNOWN_PERMISSION');
      if (!actorIsSuper(req)) { // nadie puede otorgar lo que no tiene
        const notHeld = allow.filter((c) => !req.permissions.has(c));
        if (notHeld.length) throw forbidden('No podés otorgar permisos que no tenés', 'ESCALATION');
      }
      const { rows: prev } = await tx.query(`SELECT p.code, up.effect FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = $1`, [id]);
      await tx.query('DELETE FROM user_permissions WHERE user_id = $1', [id]);
      for (const [codes, effect] of [[allow, 'allow'], [deny, 'deny']]) {
        for (const c of codes) await tx.query('INSERT INTO user_permissions(user_id, permission_id, effect, granted_by) VALUES ($1,$2,$3,$4)', [id, byCode.get(c), effect, req.user.id]);
      }
      await audit(tx, req, { action: 'user.permissions_set', entity: 'user', entityId: id,
        before: { allow: prev.filter((p) => p.effect === 'allow').map((p) => p.code), deny: prev.filter((p) => p.effect === 'deny').map((p) => p.code) }, after: { allow, deny } });
      const acc = await loadAccess(tx, id);
      return { allow, deny, effectivePermissions: [...acc.permissions].sort() };
    });
  });
};
