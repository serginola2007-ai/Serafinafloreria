'use strict';
const access = require('../../lib/access');
const { querySchema, offset, meta } = require('../../lib/pagination');

module.exports = async function auditRoutes(app) {
  app.get('/api/v1/audit-logs', {
    config: access.perm('auditoria.view'),
    schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
      action: { type: 'string', maxLength: 80 }, entity: { type: 'string', maxLength: 60 }, entityId: { type: 'string', maxLength: 60 },
      userId: { type: 'integer', minimum: 1 }, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } } } },
  }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    const add = (sql, v) => { args.push(v); conds.push(sql.replace('?', `$${args.length}`)); };
    if (q.action) add('a.action = ?', q.action);
    if (q.entity) add('a.entity = ?', q.entity);
    if (q.entityId) add('a.entity_id = ?', q.entityId);
    if (q.userId) add('a.user_id = ?', q.userId);
    if (q.from) add('a.at >= ?', q.from);
    if (q.to) add('a.at <= ?', q.to);
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await app.pool.query(`SELECT count(*)::int AS n FROM audit_logs a ${where}`, args)).rows[0].n;
    const { rows } = await app.pool.query(
      `SELECT a.id, a.at, a.user_id, u.full_name AS user_name, a.action, a.entity, a.entity_id, a.before, a.after, a.ip, a.request_id
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where} ORDER BY a.at DESC, a.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((r) => ({ id: r.id, at: r.at, userId: r.user_id, userName: r.user_name, action: r.action, entity: r.entity,
      entityId: r.entity_id, before: r.before, after: r.after, ip: r.ip, requestId: r.request_id })), meta: meta(q, total) };
  });
};
