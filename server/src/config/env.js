'use strict';
/**
 * Lectura y validación de variables de entorno. El proceso NO arranca si falta
 * una variable obligatoria o es inválida. Nunca se loguean los valores secretos.
 */

class EnvError extends Error {
  constructor(problems) {
    super('Configuración inválida:\n - ' + problems.join('\n - '));
    this.name = 'EnvError';
    this.problems = problems;
  }
}

const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

function parseEnv(src = process.env) {
  const problems = [];
  const nodeEnv = src.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) problems.push('NODE_ENV debe ser development, test o production');
  const isProd = nodeEnv === 'production';

  const int = (name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = src[name];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) { problems.push(`${name} debe ser un entero entre ${min} y ${max}`); return def; }
    return n;
  };
  const url = (name, devDefault) => {
    let v = src[name];
    if (!v) {
      if (isProd) { problems.push(`${name} es obligatoria en producción (pendiente de configurar)`); return null; }
      v = devDefault;
    }
    try {
      const u = new URL(v);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protocolo');
      if (isProd && u.protocol !== 'https:') problems.push(`${name} debe usar https en producción`);
      return v.replace(/\/+$/, '');
    } catch { problems.push(`${name} no es una URL válida`); return null; }
  };

  if (!src.DATABASE_URL) problems.push('DATABASE_URL es obligatoria');

  const storageDriver = src.STORAGE_DRIVER || 'none';
  if (!['none', 's3', 'memory'].includes(storageDriver)) problems.push('STORAGE_DRIVER debe ser none, s3 o memory');
  if (storageDriver === 'memory' && isProd) problems.push('STORAGE_DRIVER=memory no está permitido en producción');
  const s3 = {
    endpoint: src.S3_ENDPOINT || undefined,
    region: src.S3_REGION || 'auto',
    bucket: src.S3_BUCKET,
    accessKeyId: src.S3_ACCESS_KEY,
    secretAccessKey: src.S3_SECRET_KEY,
    forcePathStyle: bool(src.S3_FORCE_PATH_STYLE, false),
    publicBaseUrl: src.S3_PUBLIC_BASE_URL ? src.S3_PUBLIC_BASE_URL.replace(/\/+$/, '') : undefined,
  };
  if (storageDriver === 's3') {
    for (const [k, n] of [['bucket', 'S3_BUCKET'], ['accessKeyId', 'S3_ACCESS_KEY'], ['secretAccessKey', 'S3_SECRET_KEY']]) {
      if (!s3[k]) problems.push(`${n} es obligatoria con STORAGE_DRIVER=s3`);
    }
  }

  const publicUrl = url('PUBLIC_URL', 'http://localhost:8080');
  const apiUrl = url('API_URL', 'http://localhost:3000');
  const adminUrl = url('ADMIN_URL', 'http://localhost:3000/admin');

  // En producción el hashing nunca baja de los mínimos recomendados por OWASP (m=19 MiB, t=2).
  const argonMemoryKiB = int('ARGON_MEMORY_KIB', 65536, { min: 1024 });
  if (isProd && argonMemoryKiB < 19456) problems.push('ARGON_MEMORY_KIB debe ser >= 19456 en producción');

  if (problems.length) throw new EnvError(problems);

  const origins = new Set();
  for (const u of [publicUrl, adminUrl, apiUrl]) origins.add(new URL(u).origin);

  return Object.freeze({
    nodeEnv, isProd, isTest: nodeEnv === 'test',
    host: src.HOST || '0.0.0.0',
    port: int('PORT', 3000, { min: 1, max: 65535 }),
    databaseUrl: src.DATABASE_URL,
    databaseSsl: bool(src.DATABASE_SSL, false),
    dbPoolMax: int('DB_POOL_MAX', 10, { min: 1, max: 100 }),
    publicUrl, apiUrl, adminUrl,
    allowedOrigins: Object.freeze([...origins]),
    trustProxy: bool(src.TRUST_PROXY, isProd),
    logLevel: src.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    rateLimit: { global: int('RATE_LIMIT_MAX', 300, { min: 1 }), login: int('RATE_LIMIT_LOGIN_MAX', 10, { min: 1 }), windowMs: int('RATE_LIMIT_WINDOW_MS', 60000, { min: 1000 }) },
    session: { ttlHours: int('SESSION_TTL_HOURS', 12, { min: 1, max: 168 }), idleMinutes: int('SESSION_IDLE_MINUTES', 120, { min: 5 }) },
    lockout: { maxAttempts: int('LOGIN_MAX_ATTEMPTS', 5, { min: 3 }), minutes: int('LOGIN_LOCK_MINUTES', 15, { min: 1 }) },
    upload: { maxBytes: int('UPLOAD_MAX_BYTES', 8 * 1024 * 1024, { min: 1024, max: 50 * 1024 * 1024 }) },
    storage: { driver: storageDriver, s3 },
    argonMemoryKiB,
    secrets: Object.freeze(['DATABASE_URL', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']),
  });
}

module.exports = { parseEnv, EnvError };
