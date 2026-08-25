'use strict';

/**
 * Wrap async route handlers so thrown errors flow to the global
 * error middleware instead of crashing the request.
 */
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
