'use strict';
const crypto = require('node:crypto');
const multipart = require('@fastify/multipart');
const access = require('../../lib/access');
const { badRequest, notFound, conflict, AppError } = require('../../lib/errors');
const { withTransaction } = require('../../db/pool');
const { audit } = require('../audit/audit');
const { inspectUpload, safeOriginalName } = require('./validate');
const { querySchema, offset, meta } = require('../../lib/pagination');
const { mediaUrl } = require('./urls');

module.exports = async function mediaRoutes(app) {
  const { pool, config, storage } = app;
  await app.register(multipart, { limits: { fileSize: config.upload.maxBytes, files: 1, fields: 4, fieldSize: 500, parts: 6 } });
  const shape = (r) => ({ id: r.id, mime: r.mime, sizeBytes: r.size_bytes, altText: r.alt_text, originalName: r.original_name, isPublic: r.is_public,
    storage: r.storage, url: r.is_public ? mediaUrl(app, r) : null, createdAt: r.created_at });

  app.post('/api/v1/media', { config: access.perm('media.upload') }, async (req, reply) => {
    if (!storage.configured) throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'El almacenamiento de archivos no está configurado');
    if (!req.isMultipart()) throw badRequest('Se esperaba multipart/form-data');
    const part = await req.file();
    if (!part) throw badRequest('Falta el archivo');
    const buffer = await part.toBuffer(); // lanza FST_REQ_FILE_TOO_LARGE si supera el límite
    if (part.file.truncated) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'El archivo supera el tamaño permitido');
    const field = (n) => (part.fields[n] && 'value' in part.fields[n] ? part.fields[n].value : undefined);
    const isPublic = field('isPublic') === undefined ? true : String(field('isPublic')) === 'true';
    const altText = field('altText') ? String(field('altText')).slice(0, 300) : null;

    const info = inspectUpload({ filename: part.filename, mimetype: part.mimetype, buffer, isPublic });
    if (info.error) throw badRequest(info.error, undefined, 'INVALID_FILE');
    if (isPublic && !storage.canServePublic) throw new AppError(503, 'STORAGE_PUBLIC_URL_MISSING', 'Falta S3_PUBLIC_BASE_URL para servir archivos públicos');

    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    const dup = await pool.query(`SELECT * FROM media WHERE sha256 = $1 AND storage = 'object' AND is_public = $2 AND archived_at IS NULL LIMIT 1`, [sha, isPublic]);
    if (dup.rows.length) return { ...shape(dup.rows[0]), reused: true }; // misma imagen: se reutiliza

    const d = new Date();
    const key = `uploads/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${info.ext}`;
    await storage.put(key, buffer, { mime: info.mime });
    try {
      const row = await withTransaction(pool, async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO media(storage, storage_key, mime, size_bytes, sha256, original_name, alt_text, is_public, created_by)
           VALUES ('object',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [key, info.mime, buffer.length, sha, safeOriginalName(part.filename), altText, isPublic, req.user.id]);
        await audit(tx, req, { action: 'media.uploaded', entity: 'media', entityId: rows[0].id, after: { key, mime: info.mime, size: buffer.length, isPublic } });
        return rows[0];
      });
      reply.code(201);
      return { ...shape(row), reused: false };
    } catch (err) {
      await storage.remove(key).catch(() => {}); // no dejar objetos huérfanos si falló la base
      throw err;
    }
  });

  app.get('/api/v1/media', { config: access.perm('media.view'), schema: { querystring: querySchema } }, async (req) => {
    const q = req.query; const args = []; let where = 'WHERE archived_at IS NULL';
    if (q.q) { args.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`); where += ` AND (original_name ILIKE $1 OR alt_text ILIKE $1)`; }
    const total = (await pool.query(`SELECT count(*)::int AS n FROM media ${where}`, args)).rows[0].n;
    const { rows } = await pool.query(`SELECT * FROM media ${where} ORDER BY id DESC LIMIT ${q.limit} OFFSET ${offset(q)}`, args);
    return { data: rows.map(shape), meta: meta(q, total) };
  });

  // Archivos privados: URL firmada y temporal, solo para quien tiene permiso.
  app.get('/api/v1/media/:id/url', { config: access.perm('media.view'), schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } } }, async (req) => {
    const { rows } = await pool.query('SELECT * FROM media WHERE id = $1 AND archived_at IS NULL', [req.params.id]);
    if (!rows.length) throw notFound('Archivo no encontrado');
    const m = rows[0];
    if (m.storage === 'legacy' || m.is_public) return { url: mediaUrl(app, m), expiresInSeconds: null };
    return { url: await storage.signedUrl(m.storage_key, 300), expiresInSeconds: 300 };
  });

  app.delete('/api/v1/media/:id', { config: access.perm('media.delete'), schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } } }, async (req) => {
    const id = req.params.id;
    const m = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM media WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [id]);
      if (!rows.length) throw notFound('Archivo no encontrado');
      if (rows[0].storage === 'legacy') throw conflict('Los archivos originales del sitio no se pueden eliminar desde el panel', 'LEGACY_MEDIA');
      const used = await tx.query(
        `SELECT (SELECT count(*) FROM product_media WHERE media_id = $1) + (SELECT count(*) FROM product_categories WHERE cover_media_id = $1) AS n`, [id]);
      if (Number(used.rows[0].n) > 0) throw conflict('El archivo está en uso por productos o categorías', 'MEDIA_IN_USE');
      await tx.query('UPDATE media SET archived_at = now() WHERE id = $1', [id]);
      await audit(tx, req, { action: 'media.deleted', entity: 'media', entityId: id, before: { key: rows[0].storage_key } });
      return rows[0];
    });
    await storage.remove(m.storage_key).catch((err) => req.log.warn({ err }, 'no se pudo borrar el objeto (queda archivado en la base)'));
    return { ok: true };
  });
};
