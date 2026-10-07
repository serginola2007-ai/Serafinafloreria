'use strict';
const cookie = require('@fastify/cookie');
const helmet = require('@fastify/helmet');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');

async function register(app, config) {
  await app.register(helmet, {
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:', new URL(config.publicUrl).origin], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // la API pública sirve datos a Netlify
  });
  const allowed = new Set(config.allowedOrigins);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.global,
    timeWindow: config.rateLimit.windowMs,
    // Nota: el contador vive en memoria del proceso. Con varias instancias, moverlo a un store compartido (Redis).
  });
}
module.exports = { register };
