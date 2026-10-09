'use strict';
const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');

/**
 * Object storage. La base guarda solo la referencia (storage_key); los bytes viven acá.
 * Interfaz: put(key, buffer, {mime}) / remove(key) / publicUrl(key) / signedUrl(key, seconds)
 */
function createStorage(config) {
  const { driver, s3 } = config.storage;
  if (driver === 's3') return s3Driver(s3);
  if (driver === 'memory') return memoryDriver();
  return noneDriver();
}

const notConfigured = () => new AppError(503, 'STORAGE_NOT_CONFIGURED', 'El almacenamiento de archivos no está configurado');

function noneDriver() {
  return { name: 'none', configured: false, publicUrl: () => { throw notConfigured(); }, put: async () => { throw notConfigured(); },
    remove: async () => { throw notConfigured(); }, signedUrl: async () => { throw notConfigured(); } };
}

function memoryDriver() { // solo desarrollo/tests
  const objects = new Map();
  return { name: 'memory', configured: true, objects, canServePublic: true,
    put: async (key, buf, { mime }) => { objects.set(key, { buf, mime }); },
    remove: async (key) => { objects.delete(key); },
    publicUrl: (key) => `https://cdn.test/${key}`,
    signedUrl: async (key, s = 300) => `https://cdn.test/${key}?sig=${crypto.randomBytes(6).toString('hex')}&exp=${s}` };
}

function s3Driver(cfg) {
  const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });
  return {
    name: 's3', configured: true, canServePublic: !!cfg.publicBaseUrl,
    put: (key, buf, { mime }) => client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: buf, ContentType: mime,
      CacheControl: 'public, max-age=31536000, immutable', ContentDisposition: 'inline' })),
    remove: (key) => client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })),
    publicUrl: (key) => { if (!cfg.publicBaseUrl) throw new AppError(503, 'STORAGE_PUBLIC_URL_MISSING', 'Falta S3_PUBLIC_BASE_URL para servir archivos públicos'); return `${cfg.publicBaseUrl}/${key}`; },
    signedUrl: (key, s = 300) => getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: s }),
  };
}
module.exports = { createStorage };
