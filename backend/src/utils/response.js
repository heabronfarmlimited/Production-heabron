'use strict';

/**
 * Standardized API response envelope.
 *
 * Every endpoint returns either:
 *   { success: true, data: <any>, meta?: <object> }
 *   { success: false, error: { code: string, message: string, details?: any } }
 */

function ok(res, data, meta) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(200).json(body);
}

function created(res, data) {
  return res.status(201).json({ success: true, data });
}

function noContent(res) {
  return res.status(204).send();
}

function paginated(res, data, { page, pageSize, total }) {
  return res.status(200).json({
    success: true,
    data,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

function fail(res, status, code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return res.status(status).json({ success: false, error });
}

const badRequest = (res, message, details) => fail(res, 400, 'BAD_REQUEST', message, details);
const unauthorized = (res, message = 'Authentication required') => fail(res, 401, 'UNAUTHORIZED', message);
const forbidden = (res, message = 'Forbidden') => fail(res, 403, 'FORBIDDEN', message);
const notFound = (res, message = 'Resource not found', details) => fail(res, 404, 'NOT_FOUND', message, details);
const conflict = (res, message, details) => fail(res, 409, 'CONFLICT', message, details);
const unprocessable = (res, message, details) => fail(res, 422, 'UNPROCESSABLE_ENTITY', message, details);
const tooManyRequests = (res, message = 'Too many requests') => fail(res, 429, 'TOO_MANY_REQUESTS', message);
const serverError = (res, message = 'Internal server error', details) => fail(res, 500, 'INTERNAL_ERROR', message, details);

module.exports = {
  ok,
  created,
  noContent,
  paginated,
  fail,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  tooManyRequests,
  serverError,
};
