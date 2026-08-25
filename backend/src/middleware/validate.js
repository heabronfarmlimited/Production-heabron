'use strict';

const { unprocessable, badRequest } = require('../utils/response');

/**
 * Recursively convert empty-string ('') values to `undefined` so that
 * OPTIONAL Joi string fields treat "field left blank" as "not provided"
 * instead of failing with "is not allowed to be empty".
 *
 * Mobile/web clients commonly send `{ referenceNumber: '', altPhone: '' }`
 * for untouched optional inputs. Without this, every such request 422s.
 * Required fields sent as '' still correctly fail (they become undefined →
 * Joi "required"). Only '' is touched — null/0/false are left intact.
 */
function stripEmptyStrings(value) {
  if (Array.isArray(value)) {
    return value.map(stripEmptyStrings);
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = stripEmptyStrings(v);
      if (cleaned !== '') out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/**
 * Validate a Joi schema against a request property (body/query/params).
 *   validate(schema, 'body')   // default
 *   validate(schema, 'query')
 */
function validate(schema, source = 'body') {
  return function (req, res, next) {
    if (!schema) return next();

    // Treat blank optional inputs as "not provided" (mobile/web send '').
    const input = source === 'body' ? stripEmptyStrings(req[source]) : req[source];

    const { error, value } = schema.validate(input, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return unprocessable(res, 'Validation failed', details);
    }

    req[source] = value;
    return next();
  };
}

function validateMany(specs) {
  return function (req, res, next) {
    for (const spec of specs) {
      const { error, value } = spec.schema.validate(req[spec.source], {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });
      if (error) {
        const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
        return unprocessable(res, `Validation failed (${spec.source})`, details);
      }
      req[spec.source] = value;
    }
    return next();
  };
}

function requireParamUuid(name) {
  return function (req, res, next) {
    const v = req.params[name];
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!v || !uuidRe.test(v)) {
      return badRequest(res, `Invalid ${name}: must be a UUID`);
    }
    return next();
  };
}

module.exports = { validate, validateMany, requireParamUuid };
