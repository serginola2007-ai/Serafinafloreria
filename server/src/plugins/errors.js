'use strict';
const { AppError } = require('../lib/errors');

const PG = {
  '23505': [409, 'CONFLICT', 'Ya existe un registro con esos datos'],
  '23503': [409, 'REFERENCE_CONFLICT', 'La operación viola una relación con otros registros'],
  '23514': [400, 'CONSTRAINT_VIOLATION', 'Los datos no cumplen las reglas del sistema'],
  '23502': [400, 'CONSTRAINT_VIOLATION', 'Falta un dato obligatorio'],
  '22P02': [400, 'BAD_REQUEST', 'Formato de dato inválido'],
  '42501': [403, 'FORBIDDEN', 'Operación no permitida'],
};

function register(app) {
  app.setErrorHandler((err, req, reply) => {
    let status = 500; let body;
    if (err.validation) {
      status = 400;
      body = { code: 'VALIDATION_ERROR', message: 'Los datos enviados no son válidos',
        details: err.validation.map((v) => ({ field: (v.instancePath || '').replace(/^\//, '').replace(/\//g, '.') || v.params?.missingProperty || v.params?.additionalProperty || '', message: v.message })) };
    } else if (err instanceof AppError) {
      status = err.statusCode; body = { code: err.code, message: err.message, details: err.details };
    } else if (err.statusCode === 429) {
      status = 429; body = { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intentá de nuevo en un momento.' };
    } else if (err.statusCode === 413 || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || err.code === 'FST_REQ_FILE_TOO_LARGE') {
      status = 413; body = { code: 'PAYLOAD_TOO_LARGE', message: 'El contenido enviado supera el tamaño permitido' };
    } else if (err.statusCode === 415) {
      status = 415; body = { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Tipo de contenido no soportado' };
    } else if (err.statusCode >= 400 && err.statusCode < 500) {
      status = err.statusCode; body = { code: 'BAD_REQUEST', message: 'Solicitud inválida' };
    } else if (err.code && PG[err.code]) {
      [status, , ] = PG[err.code]; body = { code: PG[err.code][1], message: PG[err.code][2] };
    }
    if (!body) {
      req.log.error({ err }, 'error no controlado');
      status = 500; body = { code: 'INTERNAL', message: 'Error interno del servidor' };
    } else if (status >= 500) {
      req.log.error({ err }, 'error');
    }
    body.requestId = req.id;
    reply.status(status).send({ error: body });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado', requestId: req.id } });
  });
}
module.exports = { register };
