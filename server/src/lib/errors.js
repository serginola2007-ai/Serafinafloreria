'use strict';

class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}
const badRequest = (m, d, c = 'BAD_REQUEST') => new AppError(400, c, m, d);
const unauthorized = (m = 'No autenticado', c = 'UNAUTHENTICATED') => new AppError(401, c, m);
const forbidden = (m = 'No tenés permiso para realizar esta acción', c = 'FORBIDDEN') => new AppError(403, c, m);
const notFound = (m = 'No encontrado', c = 'NOT_FOUND') => new AppError(404, c, m);
const conflict = (m, c = 'CONFLICT', d) => new AppError(409, c, m, d);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
