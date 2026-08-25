'use strict';

const logger = require('../utils/logger');
const { notFound, serverError, fail } = require('../utils/response');

function notFoundHandler(req, res) {
  return notFound(res, `Route not found: ${req.method} ${req.originalUrl}`);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Multer file size / count errors
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Uploaded file is too large');
  }
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return fail(res, 400, 'BAD_REQUEST', 'Unexpected file field');
  }
  if (err && err.type === 'entity.parse.failed') {
    return fail(res, 400, 'BAD_REQUEST', 'Invalid JSON body');
  }

  logger.error(
    { err: err.message, stack: err.stack, path: req.originalUrl },
    'unhandled error'
  );

  return serverError(res, 'Something went wrong');
}

module.exports = { notFoundHandler, errorHandler };
