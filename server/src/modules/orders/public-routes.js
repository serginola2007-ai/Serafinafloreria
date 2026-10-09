'use strict';
const access = require('../../lib/access');
const { badRequest } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const S = require('./service');

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const tag = (max) => ({ type: 'string', maxLength: max, pattern: '^[A-Za-z0-9_.\\- ]*$' });

/**
 * Pedido desde la web pública. Sin sesión: validación estricta, precios SIEMPRE desde la base,
 * límite de pedidos por IP y campo trampa anti-bots. Devuelve solo el número y el total (ningún dato personal).
 */
module.exports = async function publicOrdersRoutes(app) {
  const { pool, config } = app;
  app.post('/api/v1/public/orders', {
    config: { ...access.public, rateLimit: { max: Math.max(3, Math.floor(config.rateLimit.login)), timeWindow: 3600000 } },
    schema: { body: { type: 'object', required: ['customer', 'recipient', 'items', 'requestedDate'], additionalProperties: false, properties: {
      customer: { type: 'object', required: ['name', 'phone'], additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 120 }, phone: { type: 'string', minLength: 6, maxLength: 40 }, email: { type: ['string', 'null'], format: 'email', maxLength: 254 } } },
      recipient: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 120 }, phone: { type: ['string', 'null'], maxLength: 40 }, address: { type: ['string', 'null'], maxLength: 300 }, zone: { type: ['string', 'null'], maxLength: 80 }, reference: { type: ['string', 'null'], maxLength: 300 } } },
      deliveryType: { type: 'string', enum: ['delivery', 'retiro'], default: 'delivery' }, requestedDate: { type: 'string', format: 'date' }, timeSlot: { type: ['string', 'null'], maxLength: 60 },
      cardMessage: { type: ['string', 'null'], maxLength: 500 }, notes: { type: ['string', 'null'], maxLength: 1000 },
      items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', required: ['variantId', 'qty'], additionalProperties: false, properties: { variantId: { type: 'integer', minimum: 1 }, qty: { type: 'integer', minimum: 1, maximum: 50 } } } },
      attribution: { type: 'object', additionalProperties: false, properties: { source: tag(100), medium: tag(100), campaign: tag(100) } },
      website: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const b = req.body;
    if (b.website) throw badRequest('Solicitud inválida', undefined, 'BAD_REQUEST'); // campo trampa: los humanos no lo ven
    if (b.deliveryType === 'delivery' && !b.recipient.address?.trim()) throw badRequest('Indicá la dirección de entrega', undefined, 'ADDRESS_REQUIRED');
    const pseudoReq = { user: null, permissions: new Set(), ip: req.ip, headers: req.headers, id: req.id };
    const out = await withTransaction(pool, async (tx) => {
      // cliente: se reutiliza si el teléfono ya existe (solo coincidencia exacta de dígitos); nunca se pisan sus datos
      const phone = digits(b.customer.phone);
      const { rows: found } = await tx.query(`SELECT id FROM customers WHERE archived_at IS NULL AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1 ORDER BY id LIMIT 1`, [phone]);
      let customerId = found[0]?.id;
      if (!customerId) { const r = await tx.query('INSERT INTO customers(name, phone, email, notes) VALUES ($1,$2,$3,$4) RETURNING id', [b.customer.name.trim(), b.customer.phone.trim(), b.customer.email?.trim() || null, 'Alta automática desde pedido web']); customerId = r.rows[0].id; }
      const { rows: [rc] } = await tx.query('INSERT INTO recipients(customer_id, name, phone, address, zone, reference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [customerId, b.recipient.name.trim(), b.recipient.phone?.trim() || null, b.recipient.address?.trim() || null, b.recipient.zone?.trim() || null, b.recipient.reference?.trim() || null]);
      return S.createOrder(tx, pseudoReq, { customerId, recipientId: rc.id, channel: 'web', status: 'pendiente', deliveryType: b.deliveryType, requestedDate: b.requestedDate, timeSlot: b.timeSlot, cardMessage: b.cardMessage, notes: b.notes,
        items: b.items, attribution: b.attribution ?? {} }, { isPublic: true });
    });
    reply.code(201); return { number: out.number, totalPyg: out.totalPyg };
  });
};
