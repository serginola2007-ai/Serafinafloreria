'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict, forbidden } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');
const { nextNumber } = require('../../lib/sequences');
const orders = require('../orders/service');

const id = { type: 'integer', minimum: 1 };
const idParams = { type: 'object', required: ['id'], properties: { id } };
const str = (max) => ({ type: ['string', 'null'], maxLength: max });
const TYPES = ['casamiento', 'cumpleanos', 'corporativo', 'funebre', 'aniversario', 'otro'];
const EV_STATUS = ['planificado', 'confirmado', 'realizado', 'cancelado'];
const today = () => new Date().toISOString().slice(0, 10);
const evBody = { name: { type: 'string', minLength: 2, maxLength: 160 }, type: { type: 'string', enum: TYPES }, customerId: id, eventDate: { type: ['string', 'null'], format: 'date' }, venue: str(200), guests: { type: ['integer', 'null'], minimum: 0, maximum: 100000 }, notes: str(1000) };
const item = { type: 'object', required: ['qty'], additionalProperties: false, properties: {
  variantId: id, description: { type: 'string', minLength: 2, maxLength: 200 }, qty: { type: 'integer', minimum: 1, maximum: 10000 },
  unitPricePyg: { type: 'integer', minimum: 0, maximum: 1000000000000 }, discountPyg: { type: 'integer', minimum: 0, maximum: 1000000000000 } } };
const qBody = { eventId: { type: ['integer', 'null'], minimum: 1 }, customerId: id, validUntil: { type: ['string', 'null'], format: 'date' }, notes: str(1000), items: { type: 'array', minItems: 1, maxItems: 100, items: item } };

module.exports = async function eventsRoutes(app) {
  const { pool } = app;

  /* ───────── Eventos ───────── */
  const evRow = (e) => ({ id: e.id, number: e.number, name: e.name, type: e.type, customer: { id: e.customer_id, name: e.customer_name }, eventDate: e.event_date, venue: e.venue, guests: e.guests, status: e.status, notes: e.notes });
  app.get('/api/v1/events', { config: access.perm('eventos.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties, status: { type: 'string', enum: ['all', ...EV_STATUS], default: 'all' } } } } }, async (req) => {
    const q = req.query; const args = []; const conds = [];
    if (q.status !== 'all') { args.push(q.status); conds.push(`e.status = $${args.length}`); }
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(e.name ILIKE $${args.length} OR e.number ILIKE $${args.length} OR c.name ILIKE $${args.length})`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS n FROM events e JOIN customers c ON c.id = e.customer_id ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(`SELECT e.*, c.name AS customer_name FROM events e JOIN customers c ON c.id = e.customer_id ${where} ORDER BY e.event_date NULLS LAST, e.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map(evRow), meta: meta(q, total) };
  });
  app.get('/api/v1/events/:id', { config: access.perm('eventos.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query('SELECT e.*, c.name AS customer_name FROM events e JOIN customers c ON c.id = e.customer_id WHERE e.id = $1', [req.params.id]);
    if (!rows.length) throw notFound('Evento no encontrado');
    const qs = (await pool.query('SELECT id, number, status, total_pyg, valid_until FROM quotations WHERE event_id = $1 ORDER BY id DESC', [req.params.id])).rows;
    return { ...evRow(rows[0]), quotations: qs.map((x) => ({ id: x.id, number: x.number, status: x.status, totalPyg: x.total_pyg, validUntil: x.valid_until })) };
  });
  app.post('/api/v1/events', { config: access.perm('eventos.create'), schema: { body: { type: 'object', required: ['name', 'customerId'], additionalProperties: false, properties: evBody } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM customers WHERE id = $1 AND archived_at IS NULL', [b.customerId])).rowCount) throw badRequest('Cliente inexistente o archivado', undefined, 'UNKNOWN_CUSTOMER');
      const number = await nextNumber(tx, 'event', 'E');
      const { rows: [e] } = await tx.query('INSERT INTO events(number, name, type, customer_id, event_date, venue, guests, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [number, b.name.trim(), b.type ?? 'otro', b.customerId, b.eventDate ?? null, b.venue?.trim() || null, b.guests ?? null, b.notes?.trim() || null, req.user.id]);
      await audit(tx, req, { action: 'event.created', entity: 'event', entityId: e.id, after: { number, name: b.name, customerId: b.customerId } });
      return { id: e.id, number };
    });
    reply.code(201); return out;
  });
  app.patch('/api/v1/events/:id', { config: access.perm('eventos.edit'), schema: { params: idParams, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { ...evBody, status: { type: 'string', enum: EV_STATUS } } } } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [req.params.id]); if (!rows.length) throw notFound('Evento no encontrado');
    const map = { name: 'name', type: 'type', customerId: 'customer_id', eventDate: 'event_date', venue: 'venue', guests: 'guests', notes: 'notes', status: 'status' };
    const sets = []; const args = [req.params.id];
    for (const [k, col] of Object.entries(map)) if (req.body[k] !== undefined) { args.push(typeof req.body[k] === 'string' ? (req.body[k].trim() || null) : req.body[k]); sets.push(`${col} = $${args.length}`); }
    await tx.query(`UPDATE events SET ${sets.join(', ')} WHERE id = $1`, args);
    await audit(tx, req, { action: 'event.updated', entity: 'event', entityId: req.params.id, before: { status: rows[0].status, name: rows[0].name }, after: req.body }); return { ok: true };
  }));

  /* ───────── Cotizaciones ───────── */
  /** Precios de ítems de catálogo SIEMPRE del servidor; ítems libres con precio manual (negociado). */
  async function priceItems(tx, req, items) {
    const vids = [...new Set(items.filter((i) => i.variantId).map((i) => i.variantId))];
    const { rows } = vids.length ? await tx.query(`SELECT v.id, v.label, v.price_pyg, p.name, p.archived_at, p.is_sellable FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::bigint[])`, [vids]) : { rows: [] };
    const vm = new Map(rows.map((r) => [r.id, r]));
    return items.map((it) => {
      const d = it.discountPyg ?? 0;
      if (it.variantId) {
        const v = vm.get(it.variantId); if (!v || v.archived_at || !v.is_sellable) throw badRequest('Hay productos inexistentes o no vendibles', { variantId: it.variantId }, 'UNKNOWN_VARIANT');
        if (it.unitPricePyg !== undefined) throw badRequest('El precio de un producto del catálogo lo define el sistema', undefined, 'PRICE_FORBIDDEN');
        const gross = it.qty * v.price_pyg; if (d > gross) throw badRequest('El descuento supera el importe de la línea', undefined, 'DISCOUNT_TOO_HIGH');
        return { variantId: v.id, description: v.label && v.label !== 'Único' ? `${v.name} (${v.label})` : v.name, qty: it.qty, unit: v.price_pyg, discount: d, total: gross - d };
      }
      if (!it.description?.trim() || it.unitPricePyg === undefined) throw badRequest('Un ítem libre necesita descripción y precio', undefined, 'FREE_ITEM_INVALID');
      const gross = it.qty * it.unitPricePyg; if (d > gross) throw badRequest('El descuento supera el importe de la línea', undefined, 'DISCOUNT_TOO_HIGH');
      return { variantId: null, description: it.description.trim(), qty: it.qty, unit: it.unitPricePyg, discount: d, total: gross - d };
    }).map((l) => { if (l.discount > 0 && !req.permissions.has('ventas.discount')) throw forbidden('No tenés permiso para aplicar descuentos', 'DISCOUNT_FORBIDDEN'); return l; });
  }
  const writeItems = async (tx, qid, lines) => {
    await tx.query('DELETE FROM quotation_items WHERE quotation_id = $1', [qid]);
    for (const l of lines) await tx.query('INSERT INTO quotation_items(quotation_id, variant_id, description, qty, unit_price_pyg, discount_pyg, line_total_pyg) VALUES ($1,$2,$3,$4,$5,$6,$7)', [qid, l.variantId, l.description, l.qty, l.unit, l.discount, l.total]);
    const subtotal = lines.reduce((s, l) => s + l.qty * l.unit, 0); const discount = lines.reduce((s, l) => s + l.discount, 0);
    await tx.query('UPDATE quotations SET subtotal_pyg = $2, discount_pyg = $3, total_pyg = $4 WHERE id = $1', [qid, subtotal, discount, subtotal - discount]);
  };
  const expired = (q) => q.status === 'enviada' && q.valid_until && String(q.valid_until).slice(0, 10) < today();
  const qRow = (q) => ({ id: q.id, number: q.number, status: q.status, expired: !!expired(q), customer: { id: q.customer_id, name: q.customer_name }, event: q.event_id ? { id: q.event_id, name: q.event_name } : null, validUntil: q.valid_until, totalPyg: q.total_pyg, createdAt: q.created_at });
  const QBASE = `FROM quotations q JOIN customers c ON c.id = q.customer_id LEFT JOIN events e ON e.id = q.event_id`;

  app.get('/api/v1/quotations', { config: access.perm('eventos.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties, status: { type: 'string', enum: ['all', 'borrador', 'enviada', 'aceptada', 'rechazada', 'convertida'], default: 'all' }, eventId: id, customerId: id } } } }, async (req) => {
    const q = req.query; const args = []; const conds = [];
    if (q.status !== 'all') { args.push(q.status); conds.push(`q.status = $${args.length}`); } if (q.eventId) { args.push(q.eventId); conds.push(`q.event_id = $${args.length}`); } if (q.customerId) { args.push(q.customerId); conds.push(`q.customer_id = $${args.length}`); }
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(q.number ILIKE $${args.length} OR c.name ILIKE $${args.length})`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS n ${QBASE} ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(`SELECT q.*, c.name AS customer_name, e.name AS event_name ${QBASE} ${where} ORDER BY q.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map(qRow), meta: meta(q, total) };
  });
  app.get('/api/v1/quotations/:id', { config: access.perm('eventos.view'), schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(`SELECT q.*, c.name AS customer_name, e.name AS event_name, o.number AS order_number ${QBASE} LEFT JOIN orders o ON o.id = q.order_id WHERE q.id = $1`, [req.params.id]);
    if (!rows.length) throw notFound('Cotización no encontrada');
    const items = (await pool.query('SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY id', [req.params.id])).rows;
    return { ...qRow(rows[0]), notes: rows[0].notes, subtotalPyg: rows[0].subtotal_pyg, discountPyg: rows[0].discount_pyg, decisionNote: rows[0].decision_note, decidedAt: rows[0].decided_at, order: rows[0].order_id ? { id: rows[0].order_id, number: rows[0].order_number } : null,
      items: items.map((i) => ({ id: i.id, variantId: i.variant_id, description: i.description, qty: i.qty, unitPricePyg: i.unit_price_pyg, discountPyg: i.discount_pyg, totalPyg: i.line_total_pyg })) };
  });
  app.post('/api/v1/quotations', { config: access.perm('eventos.create'), schema: { body: { type: 'object', required: ['customerId', 'items'], additionalProperties: false, properties: qBody } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM customers WHERE id = $1 AND archived_at IS NULL', [b.customerId])).rowCount) throw badRequest('Cliente inexistente o archivado', undefined, 'UNKNOWN_CUSTOMER');
      if (b.eventId && !(await tx.query('SELECT 1 FROM events WHERE id = $1 AND customer_id = $2', [b.eventId, b.customerId])).rowCount) throw badRequest('El evento no existe o es de otro cliente', undefined, 'UNKNOWN_EVENT');
      const lines = await priceItems(tx, req, b.items); const number = await nextNumber(tx, 'quotation', 'C');
      const { rows: [q] } = await tx.query('INSERT INTO quotations(number, event_id, customer_id, valid_until, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [number, b.eventId ?? null, b.customerId, b.validUntil ?? null, b.notes?.trim() || null, req.user.id]);
      await writeItems(tx, q.id, lines);
      const total = lines.reduce((s, l) => s + l.total, 0);
      await audit(tx, req, { action: 'quotation.created', entity: 'quotation', entityId: q.id, after: { number, totalPyg: total, items: lines.length } });
      return { id: q.id, number, totalPyg: total };
    });
    reply.code(201); return out;
  });
  const lockQ = async (tx, id) => { const { rows } = await tx.query('SELECT * FROM quotations WHERE id = $1 FOR UPDATE', [id]); if (!rows.length) throw notFound('Cotización no encontrada'); return rows[0]; };
  app.put('/api/v1/quotations/:id', { config: access.perm('eventos.edit'), schema: { params: idParams, body: { type: 'object', required: ['items'], additionalProperties: false, properties: { validUntil: qBody.validUntil, notes: qBody.notes, items: qBody.items } } } }, async (req) => withTransaction(pool, async (tx) => {
    const q = await lockQ(tx, req.params.id); if (q.status !== 'borrador') throw conflict('Solo se puede editar una cotización en borrador', 'NOT_EDITABLE', { status: q.status });
    const lines = await priceItems(tx, req, req.body.items); await writeItems(tx, q.id, lines);
    await tx.query('UPDATE quotations SET valid_until = $2, notes = $3 WHERE id = $1', [q.id, req.body.validUntil ?? q.valid_until, req.body.notes === undefined ? q.notes : (req.body.notes?.trim() || null)]);
    await audit(tx, req, { action: 'quotation.updated', entity: 'quotation', entityId: q.id, after: { items: lines.length, totalPyg: lines.reduce((s, l) => s + l.total, 0) } }); return { ok: true };
  }));
  const step = (path, from, to, extra) => app.post(`/api/v1/quotations/:id/${path}`, { config: access.perm('eventos.edit'), schema: { params: idParams } }, async (req) => withTransaction(pool, async (tx) => {
    const q = await lockQ(tx, req.params.id);
    if (!from.includes(q.status)) throw conflict(`No se puede pasar de “${q.status}” a “${to}”`, 'INVALID_TRANSITION', { status: q.status });
    if (extra) await extra(tx, q, req);
    await tx.query(`UPDATE quotations SET status = $2, decided_at = CASE WHEN $2 = 'aceptada' THEN now() ELSE decided_at END WHERE id = $1`, [q.id, to]);
    await audit(tx, req, { action: `quotation.${to}`, entity: 'quotation', entityId: q.id, before: { status: q.status }, after: { status: to } }); return { ok: true, status: to };
  }));
  step('send', ['borrador'], 'enviada', async (tx, q) => {
    if (!(await tx.query('SELECT 1 FROM quotation_items WHERE quotation_id = $1', [q.id])).rowCount) throw badRequest('La cotización no tiene ítems', undefined, 'EMPTY');
    if (!q.valid_until) throw badRequest('Indicá hasta cuándo es válida la cotización', undefined, 'VALIDITY_REQUIRED');
    if (String(q.valid_until).slice(0, 10) < today()) throw badRequest('La fecha de validez ya pasó', undefined, 'VALIDITY_PAST');
  });
  step('accept', ['enviada'], 'aceptada', async (tx, q) => { if (expired(q)) throw conflict('La cotización venció: duplicala o renovala antes de aceptarla', 'QUOTATION_EXPIRED'); });
  app.post('/api/v1/quotations/:id/reject', { config: access.perm('eventos.edit'), schema: { params: idParams, body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 3, maxLength: 300 } } } } }, async (req) => withTransaction(pool, async (tx) => {
    const q = await lockQ(tx, req.params.id); if (!['enviada', 'borrador'].includes(q.status)) throw conflict(`No se puede rechazar una cotización “${q.status}”`, 'INVALID_TRANSITION', { status: q.status });
    await tx.query(`UPDATE quotations SET status = 'rechazada', decided_at = now(), decision_note = $2 WHERE id = $1`, [q.id, req.body.reason.trim()]);
    await audit(tx, req, { action: 'quotation.rechazada', entity: 'quotation', entityId: q.id, before: { status: q.status }, after: { reason: req.body.reason.trim() } }); return { ok: true };
  }));

  // Convierte una cotización aceptada en pedido (pendiente). Solo si TODOS los ítems son del catálogo: los libres no tienen stock ni receta.
  app.post('/api/v1/quotations/:id/convert', { config: access.perm('pedidos.create'), schema: { params: idParams, body: { type: 'object', required: ['requestedDate'], additionalProperties: false, properties: {
    requestedDate: { type: 'string', format: 'date' }, timeSlot: str(60), deliveryType: { type: 'string', enum: ['delivery', 'retiro'], default: 'retiro' }, shipping: { type: 'object', additionalProperties: false, properties: { name: str(120), phone: str(40), address: str(300), zone: str(80), reference: str(300) } } } } } },
  async (req, reply) => {
    const out = await withTransaction(pool, async (tx) => {
      if (!req.permissions.has('eventos.edit')) throw forbidden('Convertir requiere permiso de edición de cotizaciones');
      const q = await lockQ(tx, req.params.id); if (q.status !== 'aceptada') throw conflict('Solo se convierte una cotización aceptada', 'INVALID_TRANSITION', { status: q.status });
      const { rows: items } = await tx.query('SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY id', [q.id]);
      if (items.some((i) => !i.variant_id)) throw conflict('La cotización tiene ítems libres (servicios/decoración) que no se pueden convertir en pedido', 'FREE_ITEMS', { count: items.filter((i) => !i.variant_id).length });
      // El descuento ya fue autorizado al cotizar (exigía ventas.discount); acá se traslada tal cual.
      const asQuoter = { ...req, permissions: new Set([...req.permissions, 'ventas.discount']) };
      const o = await orders.createOrder(tx, asQuoter, { customerId: q.customer_id, channel: 'evento', status: 'pendiente', deliveryType: req.body.deliveryType ?? 'retiro', requestedDate: req.body.requestedDate, timeSlot: req.body.timeSlot, shipping: req.body.shipping,
        notes: `Cotización ${q.number}`, items: items.map((i) => ({ variantId: i.variant_id, qty: i.qty, discountPyg: i.discount_pyg })) });
      await tx.query(`UPDATE quotations SET status = 'convertida', order_id = $2 WHERE id = $1`, [q.id, o.id]);
      await audit(tx, req, { action: 'quotation.convertida', entity: 'quotation', entityId: q.id, after: { orderId: o.id, orderNumber: o.number } });
      return { orderId: o.id, orderNumber: o.number, totalPyg: o.totalPyg };
    });
    reply.code(201); return out;
  });
};
