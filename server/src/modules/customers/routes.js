'use strict';
const access = require('../../lib/access');
const { notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const str = (max) => ({ type: ['string', 'null'], maxLength: max });
const KINDS = ['persona', 'empresa', 'mayorista'];
const cBody = { name: { type: 'string', minLength: 1, maxLength: 120 }, kind: { type: 'string', enum: KINDS }, taxId: str(30), phone: str(40), email: { type: ['string', 'null'], format: 'email', maxLength: 254 }, notes: str(1000), preferences: str(1000) };
const clean = (v) => (typeof v === 'string' ? (v.trim() || null) : v);
const shape = (c) => ({ id: c.id, kind: c.kind, name: c.name, taxId: c.tax_id, phone: c.phone, email: c.email, notes: c.notes, preferences: c.preferences, active: c.active, archived: !!c.archived_at, createdAt: c.created_at });
const STATS = `COALESCE((SELECT sum(total_pyg) FROM sales s WHERE s.customer_id = c.id AND s.status = 'confirmada'), 0)::bigint AS spent,
               (SELECT count(*)::int FROM sales s WHERE s.customer_id = c.id AND s.status = 'confirmada') AS purchases,
               COALESCE((SELECT sum(total_pyg - paid_pyg) FROM sales s WHERE s.customer_id = c.id AND s.status = 'confirmada'), 0)::bigint AS balance,
               (SELECT max(created_at) FROM sales s WHERE s.customer_id = c.id AND s.status = 'confirmada') AS last_purchase`;
const withStats = (c) => ({ ...shape(c), totalSpentPyg: c.spent, purchases: c.purchases, averageTicketPyg: c.purchases ? Math.round(c.spent / c.purchases) : 0, balancePyg: c.balance, lastPurchaseAt: c.last_purchase });
/** Evita inyección de fórmulas al abrir el CSV en Excel/Sheets. */
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

module.exports = async function customersRoutes(app) {
  const { pool } = app;
  const ensureCustomer = async (db, cid, lock = false) => {
    const { rows } = await db.query(`SELECT * FROM customers WHERE id = $1 AND archived_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [cid]);
    if (!rows.length) throw notFound('Cliente no encontrado'); return rows[0];
  };

  const SORTS = { name: 'lower(c.name)', spent: 'spent', last: 'last_purchase', created: 'c.created_at' };
  app.get('/api/v1/customers', { config: access.perm('clientes.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    kind: { type: 'string', enum: KINDS }, archived: { type: 'boolean', default: false }, sort: { type: 'string', enum: Object.keys(SORTS), default: 'name' }, dir: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } } } } }, async (req) => {
    const q = req.query; const conds = [q.archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL']; const args = [];
    if (q.kind) { args.push(q.kind); conds.push(`c.kind = $${args.length}`); }
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); const n = args.length; conds.push(`(c.name ILIKE $${n} OR c.phone ILIKE $${n} OR c.email::text ILIKE $${n} OR c.tax_id ILIKE $${n})`); }
    const where = 'WHERE ' + conds.join(' AND ');
    const total = (await pool.query(`SELECT count(*)::int AS n FROM customers c ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(`SELECT c.*, ${STATS} FROM customers c ${where} ORDER BY ${SORTS[q.sort]} ${q.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, c.id LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map(withStats), meta: meta(q, total) };
  });

  app.get('/api/v1/customers/export.csv', { config: access.perm('clientes.export') }, async (req, reply) => {
    const { rows } = await pool.query(`SELECT c.*, ${STATS} FROM customers c WHERE c.archived_at IS NULL ORDER BY lower(c.name), c.id`);
    const head = ['id', 'tipo', 'nombre', 'ruc_ci', 'telefono', 'correo', 'compras', 'total_comprado_pyg', 'saldo_pyg'];
    const lines = [head.join(',')].concat(rows.map((c) => [c.id, c.kind, c.name, c.tax_id, c.phone, c.email, c.purchases, c.spent, c.balance].map(csvCell).join(',')));
    await audit(pool, req, { action: 'customers.exported', entity: 'customer', after: { rows: rows.length } });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="clientes.csv"').send('﻿' + lines.join('\r\n') + '\r\n');
  });

  app.get('/api/v1/customers/upcoming-dates', { config: access.perm('clientes.view'), schema: { querystring: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90, default: 30 } } } } }, async (req) => {
    const { rows } = await pool.query(
      `SELECT d.id, d.label, d.month, d.day, c.id AS customer_id, c.name,
              (make_date(extract(year FROM CURRENT_DATE)::int + CASE WHEN make_date(extract(year FROM CURRENT_DATE)::int, d.month, LEAST(d.day, 28)) < CURRENT_DATE THEN 1 ELSE 0 END, d.month, LEAST(d.day, 28))) AS next_date
         FROM customer_dates d JOIN customers c ON c.id = d.customer_id AND c.archived_at IS NULL
        ORDER BY next_date LIMIT 200`);
    const limit = new Date(Date.now() + req.query.days * 86400000).toISOString().slice(0, 10);
    return { data: rows.filter((r) => r.next_date <= limit).map((r) => ({ id: r.id, label: r.label, customerId: r.customer_id, customer: r.name, date: r.next_date })) };
  });

  app.get('/api/v1/customers/:id', { config: access.perm('clientes.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(`SELECT c.*, ${STATS} FROM customers c WHERE c.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Cliente no encontrado');
    const cid = req.params.id;
    const addresses = (await pool.query('SELECT * FROM customer_addresses WHERE customer_id = $1 AND archived_at IS NULL ORDER BY is_default DESC, id', [cid])).rows;
    const dates = (await pool.query('SELECT * FROM customer_dates WHERE customer_id = $1 ORDER BY month, day', [cid])).rows;
    const recipients = (await pool.query('SELECT * FROM recipients WHERE customer_id = $1 AND archived_at IS NULL ORDER BY name', [cid])).rows;
    const out = { ...withStats(rows[0]),
      addresses: addresses.map((a) => ({ id: a.id, label: a.label, address: a.address, zone: a.zone, reference: a.reference, isDefault: a.is_default })),
      dates: dates.map((d) => ({ id: d.id, label: d.label, month: d.month, day: d.day, note: d.note })),
      recipients: recipients.map((r) => ({ id: r.id, name: r.name, phone: r.phone, address: r.address, zone: r.zone })) };
    if (req.permissions.has('ventas.view')) {
      out.recentSales = (await pool.query(`SELECT id, number, status, total_pyg, paid_pyg, created_at FROM sales WHERE customer_id = $1 ORDER BY id DESC LIMIT 10`, [cid]))
        .rows.map((s) => ({ id: s.id, number: s.number, status: s.status, totalPyg: s.total_pyg, paidPyg: s.paid_pyg, createdAt: s.created_at }));
    }
    return out;
  });

  app.post('/api/v1/customers', { config: access.perm('clientes.create'), schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: cBody } } }, async (req, reply) => {
    const b = req.body;
    const row = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query(`INSERT INTO customers(kind, name, tax_id, phone, email, notes, preferences, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [b.kind ?? 'persona', b.name.trim(), clean(b.taxId) ?? null, clean(b.phone) ?? null, clean(b.email) ?? null, clean(b.notes) ?? null, clean(b.preferences) ?? null, req.user.id]);
      await audit(tx, req, { action: 'customer.created', entity: 'customer', entityId: rows[0].id, after: shape(rows[0]) }); return rows[0];
    });
    reply.code(201); return shape(row);
  });

  app.patch('/api/v1/customers/:id', { config: access.perm('clientes.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { ...cBody, active: { type: 'boolean' } } } } }, async (req) => {
    const b = req.body;
    return withTransaction(pool, async (tx) => {
      const cur = await ensureCustomer(tx, req.params.id, true);
      const map = { name: 'name', kind: 'kind', taxId: 'tax_id', phone: 'phone', email: 'email', notes: 'notes', preferences: 'preferences', active: 'active' };
      const sets = []; const args = [req.params.id];
      for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { args.push(clean(b[k]) ?? null); sets.push(`${col} = $${args.length}`); }
      const { rows } = await tx.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, args);
      await audit(tx, req, { action: 'customer.updated', entity: 'customer', entityId: cur.id, before: shape(cur), after: shape(rows[0]) });
      return shape(rows[0]);
    });
  });

  app.delete('/api/v1/customers/:id', { config: access.perm('clientes.delete'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const cur = await ensureCustomer(tx, req.params.id, true);
    const { rows: [b] } = await tx.query(`SELECT COALESCE(sum(total_pyg - paid_pyg), 0)::bigint AS d FROM sales WHERE customer_id = $1 AND status = 'confirmada'`, [cur.id]);
    if (b.d > 0) throw conflict('El cliente tiene saldo pendiente de cobro', 'CUSTOMER_HAS_BALANCE', { balancePyg: b.d });
    await tx.query('UPDATE customers SET archived_at = now(), active = false WHERE id = $1', [cur.id]);
    await audit(tx, req, { action: 'customer.archived', entity: 'customer', entityId: cur.id, before: shape(cur) });
    return { ok: true };
  }));

  /* ───────── Direcciones ───────── */
  const aBody = { label: str(60), address: { type: 'string', minLength: 1, maxLength: 300 }, zone: str(80), reference: str(300), isDefault: { type: 'boolean' } };
  app.post('/api/v1/customers/:id/addresses', { config: access.perm('clientes.edit'), schema: { params: idParams, body: { type: 'object', required: ['address'], additionalProperties: false, properties: aBody } } }, async (req, reply) => {
    const b = req.body;
    const row = await withTransaction(pool, async (tx) => {
      await ensureCustomer(tx, req.params.id, true);
      if (b.isDefault) await tx.query('UPDATE customer_addresses SET is_default = false WHERE customer_id = $1', [req.params.id]);
      const { rows } = await tx.query('INSERT INTO customer_addresses(customer_id, label, address, zone, reference, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [req.params.id, clean(b.label) ?? null, b.address.trim(), clean(b.zone) ?? null, clean(b.reference) ?? null, !!b.isDefault]);
      await audit(tx, req, { action: 'customer.address_added', entity: 'customer', entityId: req.params.id, after: { address: b.address } }); return rows[0];
    });
    reply.code(201); return { id: row.id, label: row.label, address: row.address, zone: row.zone, reference: row.reference, isDefault: row.is_default };
  });
  app.patch('/api/v1/customer-addresses/:id', { config: access.perm('clientes.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: aBody } } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows: cur } = await tx.query('SELECT * FROM customer_addresses WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
    if (!cur.length) throw notFound('Dirección no encontrada');
    const b = req.body;
    if (b.isDefault) await tx.query('UPDATE customer_addresses SET is_default = false WHERE customer_id = $1', [cur[0].customer_id]);
    const map = { label: 'label', address: 'address', zone: 'zone', reference: 'reference', isDefault: 'is_default' }; const sets = []; const args = [req.params.id];
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { args.push(typeof b[k] === 'string' ? (b[k].trim() || (k === 'address' ? cur[0].address : null)) : b[k]); sets.push(`${col} = $${args.length}`); }
    await tx.query(`UPDATE customer_addresses SET ${sets.join(', ')} WHERE id = $1`, args);
    await audit(tx, req, { action: 'customer.address_updated', entity: 'customer', entityId: cur[0].customer_id, before: { address: cur[0].address }, after: b });
    return { ok: true };
  }));
  app.delete('/api/v1/customer-addresses/:id', { config: access.perm('clientes.edit'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const r = await tx.query('UPDATE customer_addresses SET archived_at = now(), is_default = false WHERE id = $1 AND archived_at IS NULL RETURNING customer_id', [req.params.id]);
    if (!r.rowCount) throw notFound('Dirección no encontrada');
    await audit(tx, req, { action: 'customer.address_removed', entity: 'customer', entityId: r.rows[0].customer_id }); return { ok: true };
  }));

  /* ───────── Fechas importantes ───────── */
  app.post('/api/v1/customers/:id/dates', { config: access.perm('clientes.edit'), schema: { params: idParams, body: { type: 'object', required: ['label', 'month', 'day'], additionalProperties: false,
    properties: { label: { type: 'string', minLength: 1, maxLength: 80 }, month: { type: 'integer', minimum: 1, maximum: 12 }, day: { type: 'integer', minimum: 1, maximum: 31 }, note: str(300) } } } }, async (req, reply) => {
    const b = req.body;
    if (new Date(2024, b.month, 0).getDate() < b.day) throw require('../../lib/errors').badRequest('Fecha inexistente para ese mes', undefined, 'INVALID_DATE');
    const row = await withTransaction(pool, async (tx) => {
      await ensureCustomer(tx, req.params.id, true);
      const { rows } = await tx.query('INSERT INTO customer_dates(customer_id, label, month, day, note) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.params.id, b.label.trim(), b.month, b.day, clean(b.note) ?? null]);
      await audit(tx, req, { action: 'customer.date_added', entity: 'customer', entityId: req.params.id, after: b }); return rows[0];
    });
    reply.code(201); return { id: row.id, label: row.label, month: row.month, day: row.day, note: row.note };
  });
  app.delete('/api/v1/customer-dates/:id', { config: access.perm('clientes.edit'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const r = await tx.query('DELETE FROM customer_dates WHERE id = $1 RETURNING customer_id', [req.params.id]);
    if (!r.rowCount) throw notFound('Fecha no encontrada');
    await audit(tx, req, { action: 'customer.date_removed', entity: 'customer', entityId: r.rows[0].customer_id }); return { ok: true };
  }));

  /* ───────── Destinatarios (independientes del cliente) ───────── */
  const rBody = { name: { type: 'string', minLength: 1, maxLength: 120 }, customerId: { type: ['integer', 'null'], minimum: 1 }, phone: str(40), address: str(300), zone: str(80), reference: str(300), notes: str(500) };
  const rShape = (r) => ({ id: r.id, customerId: r.customer_id, name: r.name, phone: r.phone, address: r.address, zone: r.zone, reference: r.reference, notes: r.notes });
  app.get('/api/v1/recipients', { config: access.perm('clientes.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties, customerId: id } } } }, async (req) => {
    const q = req.query; const conds = ['archived_at IS NULL']; const args = [];
    if (q.customerId) { args.push(q.customerId); conds.push(`customer_id = $${args.length}`); }
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(name ILIKE $${args.length} OR phone ILIKE $${args.length})`); }
    const where = 'WHERE ' + conds.join(' AND ');
    const total = (await pool.query(`SELECT count(*)::int AS n FROM recipients ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(`SELECT * FROM recipients ${where} ORDER BY name, id LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map(rShape), meta: meta(q, total) };
  });
  app.post('/api/v1/recipients', { config: access.perm('clientes.create'), schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: rBody } } }, async (req, reply) => {
    const b = req.body;
    const row = await withTransaction(pool, async (tx) => {
      if (b.customerId) await ensureCustomer(tx, b.customerId);
      const { rows } = await tx.query('INSERT INTO recipients(customer_id, name, phone, address, zone, reference, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [b.customerId ?? null, b.name.trim(), clean(b.phone) ?? null, clean(b.address) ?? null, clean(b.zone) ?? null, clean(b.reference) ?? null, clean(b.notes) ?? null]);
      await audit(tx, req, { action: 'recipient.created', entity: 'recipient', entityId: rows[0].id, after: rShape(rows[0]) }); return rows[0];
    });
    reply.code(201); return rShape(row);
  });
  app.patch('/api/v1/recipients/:id', { config: access.perm('clientes.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: rBody } } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows: cur } = await tx.query('SELECT * FROM recipients WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
    if (!cur.length) throw notFound('Destinatario no encontrado');
    const b = req.body; if (b.customerId) await ensureCustomer(tx, b.customerId);
    const map = { name: 'name', customerId: 'customer_id', phone: 'phone', address: 'address', zone: 'zone', reference: 'reference', notes: 'notes' }; const sets = []; const args = [req.params.id];
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { args.push(clean(b[k]) ?? null); sets.push(`${col} = $${args.length}`); }
    const { rows } = await tx.query(`UPDATE recipients SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, args);
    await audit(tx, req, { action: 'recipient.updated', entity: 'recipient', entityId: req.params.id, before: rShape(cur[0]), after: rShape(rows[0]) });
    return rShape(rows[0]);
  }));
  app.delete('/api/v1/recipients/:id', { config: access.perm('clientes.delete'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const r = await tx.query('UPDATE recipients SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id', [req.params.id]);
    if (!r.rowCount) throw notFound('Destinatario no encontrado');
    await audit(tx, req, { action: 'recipient.archived', entity: 'recipient', entityId: req.params.id }); return { ok: true };
  }));
};
