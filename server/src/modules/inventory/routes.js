'use strict';
const access = require('../../lib/access');
const { badRequest, notFound, conflict } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { querySchema, offset, meta } = require('../../lib/pagination');
const { assertPYG } = require('../../lib/money');
const { mediaUrl } = require('../media/urls');
const inv = require('./service');

const id = { type: 'integer', minimum: 1 };
const qty = { type: 'number', exclusiveMinimum: 0, maximum: 1000000000 };
const date = { type: 'string', format: 'date' };

/** Estado de stock a partir de cantidades (SQL lo calcula igual para filtrar). */
const STATUS_SQL = `CASE WHEN l.on_hand = 0 THEN 'out'
                         WHEN l.on_hand - l.reserved <= l.min_stock AND l.min_stock > 0 THEN 'low'
                         WHEN l.max_stock IS NOT NULL AND l.on_hand > l.max_stock THEN 'excess' ELSE 'ok' END`;

module.exports = async function inventoryRoutes(app) {
  const { pool } = app;
  const loc = () => inv.defaultLocationId(pool);

  /* ───────── Ítems de inventario ───────── */
  const SORTS = { name: 'p.name', onHand: 'l.on_hand', value: 'value', updated: 'l.updated_at' };
  app.get('/api/v1/inventory/items', { config: access.perm('inventario.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    status: { type: 'string', enum: ['all', 'out', 'low', 'ok', 'excess'], default: 'all' }, kind: { type: 'string', enum: ['finished', 'raw_flower', 'foliage', 'supply', 'accessory', 'packaging'] },
    categoryId: id, sort: { type: 'string', enum: Object.keys(SORTS), default: 'name' }, dir: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } } } } }, async (req) => {
    const q = req.query; const location = await loc(); const args = [location]; const conds = ['p.is_stockable', 'p.archived_at IS NULL'];
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(p.name ILIKE $${args.length} OR p.sku ILIKE $${args.length})`); }
    if (q.kind) { args.push(q.kind); conds.push(`p.kind = $${args.length}`); }
    if (q.categoryId) { args.push(q.categoryId); conds.push(`p.category_id = $${args.length}`); }
    if (q.status !== 'all') { args.push(q.status); conds.push(`(${STATUS_SQL}) = $${args.length}`); }
    const where = 'WHERE ' + conds.join(' AND ');
    const from = `FROM products p JOIN inventory_levels l ON l.product_id = p.id AND l.location_id = $1 LEFT JOIN product_categories c ON c.id = p.category_id`;
    const total = (await pool.query(`SELECT count(*)::int AS n ${from} ${where}`, args)).rows[0].n;
    const sum = (await pool.query(`SELECT COALESCE(sum(round(l.on_hand * p.avg_cost_pyg)), 0)::bigint AS v ${from} ${where}`, args)).rows[0].v;
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.kind, p.unit, p.sku, p.avg_cost_pyg, c.name AS category, l.on_hand, l.reserved, l.min_stock, l.max_stock,
              round(l.on_hand * p.avg_cost_pyg)::bigint AS value, (${STATUS_SQL}) AS status
         ${from} ${where} ORDER BY ${SORTS[q.sort]} ${q.dir === 'desc' ? 'DESC' : 'ASC'}, p.id LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, unit: r.unit, sku: r.sku, category: r.category, onHand: r.on_hand, reserved: r.reserved,
      available: Number((r.on_hand - r.reserved).toFixed(3)), minStock: r.min_stock, maxStock: r.max_stock, avgCostPyg: r.avg_cost_pyg, valuePyg: r.value, status: r.status })),
      meta: meta(q, total), totalValuePyg: sum };
  });

  // Incorpora un producto existente al control de stock.
  app.post('/api/v1/inventory/items', { config: access.perm('inventario.create'), schema: { body: { type: 'object', required: ['productId'], additionalProperties: false, properties: {
    productId: id, unit: { type: 'string', minLength: 1, maxLength: 20 }, minStock: { type: 'number', minimum: 0, maximum: 1e9 }, maxStock: { type: ['number', 'null'], minimum: 0, maximum: 1e9 } } } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query('SELECT id, name, is_stockable, archived_at FROM products WHERE id = $1 FOR UPDATE', [b.productId]);
      if (!rows.length) throw notFound('Producto no encontrado');
      if (rows[0].archived_at) throw conflict('El producto está archivado', 'ARCHIVED');
      if (rows[0].is_stockable) throw conflict('El producto ya está en inventario', 'ALREADY_STOCKABLE');
      if (b.maxStock != null && b.maxStock < (b.minStock ?? 0)) throw badRequest('El stock máximo no puede ser menor que el mínimo', undefined, 'INVALID_LIMITS');
      await tx.query('UPDATE products SET is_stockable = true, unit = COALESCE($2, unit) WHERE id = $1', [b.productId, b.unit ?? null]);
      await tx.query('INSERT INTO inventory_levels(product_id, location_id, min_stock, max_stock) VALUES ($1,$2,$3,$4)', [b.productId, await inv.defaultLocationId(tx), b.minStock ?? 0, b.maxStock ?? null]);
      await audit(tx, req, { action: 'inventory.item_enrolled', entity: 'product', entityId: b.productId, after: b });
      return { productId: b.productId };
    });
    reply.code(201); return out;
  });

  app.put('/api/v1/inventory/items/:productId/settings', { config: access.perm('inventario.edit'), schema: { params: { type: 'object', required: ['productId'], properties: { productId: id } },
    body: { type: 'object', required: ['minStock'], additionalProperties: false, properties: { minStock: { type: 'number', minimum: 0, maximum: 1e9 }, maxStock: { type: ['number', 'null'], minimum: 0, maximum: 1e9 }, unit: { type: 'string', minLength: 1, maxLength: 20 } } } } }, async (req) => {
    const b = req.body; const pid = req.params.productId;
    if (b.maxStock != null && b.maxStock < b.minStock) throw badRequest('El stock máximo no puede ser menor que el mínimo', undefined, 'INVALID_LIMITS');
    return withTransaction(pool, async (tx) => {
      const p = await inv.lockProduct(tx, pid); const location = await inv.defaultLocationId(tx);
      const { rows: [before] } = await tx.query('SELECT min_stock, max_stock FROM inventory_levels WHERE product_id = $1 AND location_id = $2', [pid, location]);
      await tx.query('UPDATE inventory_levels SET min_stock = $3, max_stock = $4, updated_at = now() WHERE product_id = $1 AND location_id = $2', [pid, location, b.minStock, b.maxStock ?? null]);
      if (b.unit) await tx.query('UPDATE products SET unit = $2 WHERE id = $1', [pid, b.unit]);
      await audit(tx, req, { action: 'inventory.settings_changed', entity: 'product', entityId: pid, before: { minStock: before?.min_stock, maxStock: before?.max_stock, unit: p.unit }, after: b });
      return { ok: true };
    });
  });

  app.get('/api/v1/inventory/items/:productId', { config: access.perm('inventario.view'), schema: { params: { type: 'object', required: ['productId'], properties: { productId: id } } } }, async (req) => {
    const pid = req.params.productId; const location = await loc();
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.kind, p.unit, p.sku, p.avg_cost_pyg, l.on_hand, l.reserved, l.min_stock, l.max_stock, round(l.on_hand * p.avg_cost_pyg)::bigint AS value, (${STATUS_SQL}) AS status
         FROM products p JOIN inventory_levels l ON l.product_id = p.id AND l.location_id = $2 WHERE p.id = $1 AND p.is_stockable`, [pid, location]);
    if (!rows.length) throw notFound('El producto no está en inventario');
    const r = rows[0];
    const lots = (await pool.query(
      `SELECT lt.id, lt.qty_initial, lt.qty_remaining, lt.unit_cost_pyg, lt.received_at, lt.expires_at, lt.purchased_at, s.name AS supplier
         FROM inventory_lots lt LEFT JOIN suppliers s ON s.id = lt.supplier_id WHERE lt.product_id = $1 AND lt.qty_remaining > 0 ORDER BY lt.expires_at NULLS LAST, lt.received_at, lt.id`, [pid])).rows;
    return { id: r.id, name: r.name, kind: r.kind, unit: r.unit, sku: r.sku, avgCostPyg: r.avg_cost_pyg, onHand: r.on_hand, reserved: r.reserved,
      available: Number((r.on_hand - r.reserved).toFixed(3)), minStock: r.min_stock, maxStock: r.max_stock, valuePyg: r.value, status: r.status,
      lots: lots.map((l) => ({ id: l.id, qtyInitial: l.qty_initial, qtyRemaining: l.qty_remaining, unitCostPyg: l.unit_cost_pyg, receivedAt: l.received_at, expiresAt: l.expires_at, purchasedAt: l.purchased_at, supplier: l.supplier })) };
  });

  /* ───────── Movimientos (historial completo, inmutable) ───────── */
  app.get('/api/v1/inventory/movements', { config: access.perm('inventario.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    productId: id, type: { type: 'string', maxLength: 30 }, userId: id, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    const add = (sql, v) => { args.push(v); conds.push(sql.replace('?', `$${args.length}`)); };
    if (q.productId) add('m.product_id = ?', q.productId); if (q.type) add('m.type = ?', q.type); if (q.userId) add('m.user_id = ?', q.userId);
    if (q.from) add('m.occurred_at >= ?', q.from); if (q.to) add('m.occurred_at <= ?', q.to);
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS n FROM inventory_movements m ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(
      `SELECT m.id, m.product_id, p.name AS product, p.unit, m.type, m.qty, m.unit_cost_pyg, m.reason, m.reference_type, m.reference_id, m.note, m.occurred_at, m.lot_id, u.full_name AS user_name
         FROM inventory_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id ${where} ORDER BY m.occurred_at DESC, m.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((m) => ({ id: m.id, productId: m.product_id, product: m.product, unit: m.unit, type: m.type, qty: m.qty, unitCostPyg: m.unit_cost_pyg, reason: m.reason,
      referenceType: m.reference_type, referenceId: m.reference_id, note: m.note, lotId: m.lot_id, user: m.user_name, occurredAt: m.occurred_at })), meta: meta(q, total) };
  });

  /* ───────── Ajustes manuales (siempre con motivo; quedan en movimientos y auditoría) ───────── */
  app.post('/api/v1/inventory/adjustments', { config: access.perm('inventario.adjust'), schema: { body: { type: 'object', required: ['productId', 'direction', 'qty', 'reason'], additionalProperties: false, properties: {
    productId: id, direction: { type: 'string', enum: ['in', 'out'] }, qty, reason: { type: 'string', minLength: 3, maxLength: 200 }, note: { type: ['string', 'null'], maxLength: 500 },
    unitCostPyg: { type: 'integer', minimum: 0, maximum: 1000000000000 }, expiresAt: date } } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      const locationId = await inv.defaultLocationId(tx);
      let result;
      if (b.direction === 'in') {
        const p = await inv.lockProduct(tx, b.productId);
        const cost = b.unitCostPyg ?? p.avg_cost_pyg;
        if (b.unitCostPyg === undefined && p.avg_cost_pyg === 0) throw badRequest('Indicá el costo unitario: el producto todavía no tiene costo promedio', undefined, 'COST_REQUIRED');
        result = await inv.receiveStock(tx, { productId: b.productId, locationId, qty: b.qty, unitCostPyg: cost, type: 'ajuste_positivo', reason: b.reason, note: b.note, userId: req.user.id, expiresAt: b.expiresAt ?? null });
      } else {
        result = await inv.consumeStock(tx, { productId: b.productId, locationId, qty: b.qty, type: 'ajuste_negativo', reason: b.reason, note: b.note, userId: req.user.id });
      }
      await audit(tx, req, { action: b.direction === 'in' ? 'inventory.adjust_in' : 'inventory.adjust_out', entity: 'product', entityId: b.productId, after: { qty: b.qty, reason: b.reason, costPyg: result.totalCostPyg ?? b.unitCostPyg ?? null } });
      return { ok: true, ...result };
    });
    reply.code(201); return out;
  });

  /* ───────── Merma ───────── */
  app.get('/api/v1/waste-reasons', { config: access.anyPerm('inventario.view', 'inventario.merma') }, async () => {
    const { rows } = await pool.query('SELECT id, code, name, active FROM waste_reasons ORDER BY sort_order, id');
    return { data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, active: r.active })) };
  });
  app.post('/api/v1/waste-reasons', { config: access.perm('inventario.edit'), schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 60 } } } } }, async (req, reply) => {
    const code = req.body.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    if (!code) throw badRequest('Nombre inválido');
    const row = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query('INSERT INTO waste_reasons(code, name, sort_order) VALUES ($1,$2,(SELECT COALESCE(max(sort_order),0)+1 FROM waste_reasons)) RETURNING id, code, name, active', [code, req.body.name.trim()]);
      await audit(tx, req, { action: 'waste_reason.created', entity: 'waste_reason', entityId: rows[0].id, after: rows[0] }); return rows[0];
    });
    reply.code(201); return row;
  });
  app.patch('/api/v1/waste-reasons/:id', { config: access.perm('inventario.edit'), schema: { params: { type: 'object', required: ['id'], properties: { id } },
    body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 60 }, active: { type: 'boolean' } } } } }, async (req) => withTransaction(pool, async (tx) => {
    const { rows: cur } = await tx.query('SELECT * FROM waste_reasons WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!cur.length) throw notFound('Motivo no encontrado');
    await tx.query('UPDATE waste_reasons SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1', [req.params.id, req.body.name?.trim() ?? null, req.body.active ?? null]);
    await audit(tx, req, { action: 'waste_reason.updated', entity: 'waste_reason', entityId: req.params.id, before: { name: cur[0].name, active: cur[0].active }, after: req.body });
    return { ok: true };
  }));

  app.post('/api/v1/inventory/waste', { config: access.perm('inventario.merma'), schema: { body: { type: 'object', required: ['productId', 'qty', 'reasonCode'], additionalProperties: false, properties: {
    productId: id, qty, reasonCode: { type: 'string', pattern: '^[a-z_0-9]+$', maxLength: 40 }, note: { type: ['string', 'null'], maxLength: 500 } } } } }, async (req, reply) => {
    const b = req.body;
    const out = await withTransaction(pool, async (tx) => {
      const { rows: rs } = await tx.query('SELECT id, name FROM waste_reasons WHERE code = $1 AND active', [b.reasonCode]);
      if (!rs.length) throw badRequest('Motivo de merma inexistente o inactivo', { reasonCode: b.reasonCode }, 'UNKNOWN_REASON');
      const locationId = await inv.defaultLocationId(tx);
      const { rows: [w] } = await tx.query('INSERT INTO waste_records(product_id, location_id, reason_id, qty, cost_pyg, note, user_id) VALUES ($1,$2,$3,$4,0,$5,$6) RETURNING id',
        [b.productId, locationId, rs[0].id, inv.fromMilli(inv.assertQty(b.qty)), b.note ?? null, req.user.id]);
      const r = await inv.consumeStock(tx, { productId: b.productId, locationId, qty: b.qty, type: 'merma', reason: rs[0].name, referenceType: 'waste', referenceId: w.id, userId: req.user.id, note: b.note });
      await tx.query('UPDATE waste_records SET cost_pyg = $2 WHERE id = $1', [w.id, r.totalCostPyg]);
      await audit(tx, req, { action: 'inventory.waste', entity: 'product', entityId: b.productId, after: { wasteId: w.id, qty: b.qty, reason: rs[0].name, costPyg: r.totalCostPyg } });
      return { id: w.id, costPyg: r.totalCostPyg };
    });
    reply.code(201); return out;
  });

  // Reporte de merma: por producto, categoría, motivo, usuario y total, para un período.
  app.get('/api/v1/inventory/waste', { config: access.anyPerm('inventario.view', 'reportes.view'), schema: { querystring: { ...querySchema, properties: { ...querySchema.properties,
    from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' }, productId: id, reasonCode: { type: 'string', maxLength: 40 }, userId: id } } } }, async (req) => {
    const q = req.query; const conds = []; const args = [];
    const add = (sql, v) => { args.push(v); conds.push(sql.replace('?', `$${args.length}`)); };
    if (q.from) add('w.occurred_at >= ?', q.from); if (q.to) add('w.occurred_at <= ?', q.to); if (q.productId) add('w.product_id = ?', q.productId);
    if (q.reasonCode) add('r.code = ?', q.reasonCode); if (q.userId) add('w.user_id = ?', q.userId);
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const base = `FROM waste_records w JOIN products p ON p.id = w.product_id JOIN waste_reasons r ON r.id = w.reason_id LEFT JOIN users u ON u.id = w.user_id LEFT JOIN product_categories c ON c.id = p.category_id ${where}`;
    const total = (await pool.query(`SELECT count(*)::int AS n, COALESCE(sum(w.cost_pyg),0)::bigint AS cost ${base}`, args)).rows[0];
    const by = async (expr, label) => (await pool.query(`SELECT ${expr} AS key, count(*)::int AS records, COALESCE(sum(w.cost_pyg),0)::bigint AS cost ${base} GROUP BY 1 ORDER BY cost DESC LIMIT 20`, args)).rows.map((r) => ({ [label]: r.key, records: r.records, costPyg: r.cost }));
    const { rows } = await pool.query(
      `SELECT w.id, w.occurred_at, p.name AS product, p.unit, w.qty, w.cost_pyg, r.name AS reason, w.note, u.full_name AS user_name ${base} ORDER BY w.occurred_at DESC, w.id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map((w) => ({ id: w.id, occurredAt: w.occurred_at, product: w.product, unit: w.unit, qty: w.qty, costPyg: w.cost_pyg, reason: w.reason, note: w.note, user: w.user_name })),
      meta: meta(q, total.n), totalCostPyg: total.cost,
      byProduct: await by('p.name', 'product'), byCategory: await by(`COALESCE(c.name, 'Sin categoría')`, 'category'), byReason: await by('r.name', 'reason'), byUser: await by(`COALESCE(u.full_name, 'Sistema')`, 'user') };
  });

  /* ───────── Alertas de stock ───────── */
  app.get('/api/v1/inventory/alerts', { config: access.perm('inventario.view') }, async () => {
    const location = await loc();
    const items = (await pool.query(
      `SELECT p.id, p.name, p.unit, l.on_hand, l.reserved, l.min_stock, l.max_stock, (${STATUS_SQL}) AS status
         FROM products p JOIN inventory_levels l ON l.product_id = p.id AND l.location_id = $1 WHERE p.is_stockable AND p.archived_at IS NULL ORDER BY p.name`, [location])).rows;
    const pick = (s) => items.filter((i) => i.status === s).map((i) => ({ id: i.id, name: i.name, unit: i.unit, onHand: i.on_hand, available: Number((i.on_hand - i.reserved).toFixed(3)), minStock: i.min_stock, maxStock: i.max_stock }));
    const expiring = (await pool.query(
      `SELECT lt.id, lt.product_id, p.name, p.unit, lt.qty_remaining, lt.expires_at, (lt.expires_at - CURRENT_DATE) AS days_left
         FROM inventory_lots lt JOIN products p ON p.id = lt.product_id WHERE lt.qty_remaining > 0 AND lt.expires_at IS NOT NULL AND lt.expires_at <= CURRENT_DATE + 3 ORDER BY lt.expires_at, lt.id LIMIT 50`)).rows;
    const slow = (await pool.query(
      `SELECT p.id, p.name, p.unit, l.on_hand, (SELECT max(m.occurred_at) FROM inventory_movements m WHERE m.product_id = p.id AND m.qty < 0) AS last_out
         FROM products p JOIN inventory_levels l ON l.product_id = p.id AND l.location_id = $1
        WHERE p.is_stockable AND p.archived_at IS NULL AND l.on_hand > 0
          AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id AND m.qty < 0 AND m.occurred_at > now() - interval '60 days')
          AND EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id AND m.qty > 0 AND m.occurred_at < now() - interval '60 days')
        ORDER BY l.on_hand DESC LIMIT 20`, [location])).rows;
    const out = pick('out'), low = pick('low'), excess = pick('excess');
    return { counts: { out: out.length, low: low.length, excess: excess.length, expiring: expiring.length, slow: slow.length }, out, low, excess,
      expiring: expiring.map((e) => ({ lotId: e.id, productId: e.product_id, name: e.name, unit: e.unit, qty: e.qty_remaining, expiresAt: e.expires_at, daysLeft: e.days_left })),
      slow: slow.map((s) => ({ id: s.id, name: s.name, unit: s.unit, onHand: s.on_hand, lastOutAt: s.last_out })) };
  });
};
