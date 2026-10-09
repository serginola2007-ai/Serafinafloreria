'use strict';
const SENSITIVE = /pass|token|secret|hash|csrf|authorization|cookie/i;

/** Quita claves sensibles antes de guardar en auditoría. */
function scrub(value, depth = 0) {
  if (value == null || depth > 6) return value ?? null;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : scrub(v, depth + 1)]));
  }
  return value;
}

/**
 * Registra una acción. `db` es un client de transacción (para que el log sea atómico con el cambio) o el pool.
 * `ctx` es el request (o un objeto {user, ip, userAgent, id}).
 */
async function audit(db, ctx, { action, entity = null, entityId = null, before = null, after = null, userId }) {
  const uid = userId !== undefined ? userId : (ctx?.user?.id ?? null);
  await db.query(
    `INSERT INTO audit_logs(user_id, action, entity, entity_id, before, after, ip, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [uid, action, entity, entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(scrub(before)), after == null ? null : JSON.stringify(scrub(after)),
      ctx?.ip ?? null, ctx?.headers?.['user-agent']?.slice(0, 300) ?? ctx?.userAgent ?? null, ctx?.id ?? null]);
}

module.exports = { audit, scrub };
