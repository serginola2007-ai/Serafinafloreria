'use strict';
const crypto = require('node:crypto');
const { loadAccess } = require('../rbac/service');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest();

async function createSession(db, { userId, ip, userAgent }, cfg) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const { rows } = await db.query(
    `INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at, ip, user_agent)
     VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5, $6) RETURNING id, expires_at`,
    [hashToken(token), userId, csrf, cfg.session.ttlHours, ip ?? null, userAgent ? userAgent.slice(0, 300) : null]);
  return { token, csrf, id: rows[0].id, expiresAt: rows[0].expires_at };
}

/** Devuelve la sesión válida (no revocada, no vencida, sin exceso de inactividad, usuario activo) o null. */
async function resolveSession(pool, token, cfg) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.csrf_token, s.last_seen_at, u.id AS user_id, u.email, u.full_name, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(mins => $2) AND u.active`,
    [hashToken(token), cfg.session.idleMinutes]);
  if (!rows.length) return null;
  const r = rows[0];
  const access = await loadAccess(pool, r.user_id);
  if (!access) return null;
  if (Date.now() - new Date(r.last_seen_at).getTime() > 60000) {
    await pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [r.id]);
  }
  return {
    id: r.id, csrf: r.csrf_token,
    user: { id: r.user_id, email: r.email, fullName: r.full_name, mustChangePassword: r.must_change_password, role: access.role },
    permissions: access.permissions,
  };
}

const revokeSession = (db, id) => db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
const revokeUserSessions = (db, userId, exceptId = null) =>
  db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::bigint IS NULL OR id <> $2)', [userId, exceptId]);

module.exports = { createSession, resolveSession, revokeSession, revokeUserSessions, hashToken };
