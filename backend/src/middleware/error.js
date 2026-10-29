'use strict';

const logger = require('../utils/logger');
const { notFound, serverError, fail } = require('../utils/response');

function notFoundHandler(req, res) {
  return notFound(res, `Route not found: ${req.method} ${req.originalUrl}`);
}

/**
 * Postgres / PostgREST error codes worth translating. Supabase errors are
 * thrown as plain objects (`throw error`) by the controllers, so they arrive
 * here with `code`/`details`/`hint` and no stack.
 *
 * FIXED — every one of these used to collapse into a 500 "Something went
 * wrong". A duplicate NIN, a deleted cooperative still referenced by a loan,
 * or a `.single()` that matched no rows all looked identical to a crash, both
 * to the client and in the logs.
 */
const PG_STATUS = {
  '23505': [409, 'CONFLICT', 'That record already exists'],
  '23503': [409, 'CONFLICT', 'Another record still references this one'],
  '23502': [400, 'BAD_REQUEST', 'A required field was missing'],
  '23514': [400, 'BAD_REQUEST', 'A value failed a database constraint'],
  '22P02': [400, 'BAD_REQUEST', 'A value had the wrong type'],
  '22003': [400, 'BAD_REQUEST', 'A number was out of range'],
  PGRST116: [404, 'NOT_FOUND', 'Resource not found'],
  PGRST204: [400, 'BAD_REQUEST', 'Unknown column in request'],
  '42501': [403, 'FORBIDDEN', 'Database permission denied'],
};

 
function errorHandler(err, req, res, next) {
  // Multer file size / count / type errors
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Uploaded file is too large');
  }
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return fail(res, 400, 'BAD_REQUEST', 'Unexpected file field');
  }
  if (err && err.code === 'INVALID_FILE_TYPE') {
    return fail(res, 400, 'BAD_REQUEST', err.message);
  }
  if (err && err.type === 'entity.parse.failed') {
    return fail(res, 400, 'BAD_REQUEST', 'Invalid JSON body');
  }
  // A rejected cross-origin request is a client problem, not a server crash.
  if (err && /^CORS: /.test(err.message || '')) {
    return fail(res, 403, 'FORBIDDEN', err.message);
  }

  const mapped = err && err.code ? PG_STATUS[err.code] : null;

  logger.error(
    {
      err: err?.message,
      code: err?.code,
      details: err?.details,
      hint: err?.hint,
      stack: err?.stack,
      path: req.originalUrl,
      method: req.method,
      mappedStatus: mapped ? mapped[0] : 500,
    },
    'unhandled error'
  );

  if (mapped) {
    const [status, code, message] = mapped;
    return fail(res, status, code, message);
  }

  return serverError(res, 'Something went wrong');
}

module.exports = { notFoundHandler, errorHandler };
