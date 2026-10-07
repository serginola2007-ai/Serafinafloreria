'use strict';
const access = require('../../lib/access');
const { unauthorized, badRequest } = require('../../lib/errors');
const { passwordProblem } = require('../../lib/passwords');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { createSession, revokeSession, revokeUserSessions } = require('./sessions');
const { cookieName } = require('../../plugins/auth');
const { loadAccess } = require('../rbac/service');

const GENERIC = 'Credenciales inválidas o cuenta bloqueada temporalmente';

function publicUser(u, role) {
  return { id: u.id, email: u.email, fullName: u.fullName ?? u.full_name, mustChangePassword: u.mustChangePassword ?? u.must_change_password, role: { code: role.code, name: role.name } };
}

module.exports = async function authRoutes(app) {
  const { config, pool, hasher } = app;
  const setCookie = (reply, token) => reply.setCookie(cookieName(config), token, {
    httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/', maxAge: config.session.ttlHours * 3600,
  });

  app.post('/api/v1/auth/login', {
    config: { ...access.public, rateLimit: { max: config.rateLimit.login, timeWindow: config.rateLimit.windowMs } },
    schema: { body: { type: 'object', required: ['email', 'password'], additionalProperties: false,
      properties: { email: { type: 'string', maxLength: 254 }, password: { type: 'string', minLength: 1, maxLength: 256 } } } },
  }, async (req, reply) => {
    const { email, password } = req.body;
    const { rows } = await pool.query(
      `SELECT id, email, full_name, password_hash, active, must_change_password, failed_attempts, locked_until,
              (locked_until IS NOT NULL AND locked_until > now()) AS locked
         FROM users WHERE email = $1`, [email.trim()]);
    const u = rows[0];
    const fail = async (reason, userId = null) => {
      await audit(pool, req, { action: 'auth.login_failed', entity: 'user', entityId: userId, userId, after: { email: email.trim().slice(0, 254), reason } });
      throw unauthorized(GENERIC, 'INVALID_CREDENTIALS');
    };
    if (!u) { await hasher.verifyDummy(password); return fail('unknown_user'); }
    if (!u.active) { await hasher.verifyDummy(password); return fail('inactive', u.id); }
    if (u.locked) { await hasher.verifyDummy(password); return fail('locked', u.id); }

    if (!(await hasher.verify(u.password_hash, password))) {
      const attempts = u.failed_attempts + 1;
      const lock = attempts >= config.lockout.maxAttempts;
      await pool.query(
        `UPDATE users SET failed_attempts = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id = $1`,
        [u.id, lock ? 0 : attempts, lock, config.lockout.minutes]);
      return fail(lock ? 'bad_password_locked' : 'bad_password', u.id);
    }

    const result = await withTransaction(pool, async (tx) => {
      const sets = ['failed_attempts = 0', 'locked_until = NULL', 'last_login_at = now()'];
      const params = [u.id];
      if (hasher.needsRehash(u.password_hash)) { params.push(await hasher.hash(password)); sets.push(`password_hash = $${params.length}`); }
      await tx.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
      const s = await createSession(tx, { userId: u.id, ip: req.ip, userAgent: req.headers['user-agent'] }, config);
      await audit(tx, req, { action: 'auth.login', entity: 'user', entityId: u.id, userId: u.id });
      return s;
    });
    const acc = await loadAccess(pool, u.id);
    setCookie(reply, result.token);
    return { user: publicUser(u, acc.role), permissions: [...acc.permissions].sort(), csrfToken: result.csrf };
  });

  app.post('/api/v1/auth/logout', { config: access.authenticatedAllowPasswordChange }, async (req, reply) => {
    await withTransaction(pool, async (tx) => {
      await revokeSession(tx, req.sessionId);
      await audit(tx, req, { action: 'auth.logout', entity: 'user', entityId: req.user.id });
    });
    reply.clearCookie(cookieName(config), { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { config: access.authenticatedAllowPasswordChange }, async (req) => ({
    user: publicUser(req.user, req.user.role),
    permissions: [...req.permissions].sort(),
    csrfToken: req.csrf,
  }));

  app.post('/api/v1/auth/change-password', {
    config: access.authenticatedAllowPasswordChange,
    schema: { body: { type: 'object', required: ['currentPassword', 'newPassword'], additionalProperties: false,
      properties: { currentPassword: { type: 'string', minLength: 1, maxLength: 256 }, newPassword: { type: 'string', minLength: 1, maxLength: 256 } } } },
  }, async (req) => {
    const { currentPassword, newPassword } = req.body;
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await hasher.verify(rows[0].password_hash, currentPassword))) throw badRequest('La contraseña actual no es correcta', undefined, 'INVALID_CURRENT_PASSWORD');
    if (currentPassword === newPassword) throw badRequest('La nueva contraseña debe ser distinta de la actual', undefined, 'WEAK_PASSWORD');
    const problem = passwordProblem(newPassword, { email: req.user.email, fullName: req.user.fullName });
    if (problem) throw badRequest(problem, undefined, 'WEAK_PASSWORD');
    const hash = await hasher.hash(newPassword);
    await withTransaction(pool, async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [req.user.id, hash]);
      await revokeUserSessions(tx, req.user.id, req.sessionId);
      await audit(tx, req, { action: 'auth.password_changed', entity: 'user', entityId: req.user.id });
    });
    return { ok: true };
  });
};
