'use strict';
const querySchema = {
  type: 'object',
  properties: { page: { type: 'integer', minimum: 1, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, q: { type: 'string', maxLength: 100 } },
  additionalProperties: true,
};
const offset = (q) => ((q.page || 1) - 1) * (q.limit || 25);
const meta = (q, total) => ({ page: q.page || 1, limit: q.limit || 25, total, pages: Math.max(1, Math.ceil(total / (q.limit || 25))) });
module.exports = { querySchema, offset, meta };
