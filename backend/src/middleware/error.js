'use strict';

const logger = require('../utils/logger');
const { notFound, serverError, fail } = require('../utils/response');
const { parseEnumViolation } = require('../utils/enums');

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

 
/**
 * Unique constraints worth naming.
 *
 * A 23505 reaching the client as "That record already exists" is true and
 * useless: the agent is looking at a form of fifteen fields and is not told
 * which one collided. The flow's exception list calls out duplicate
 * registration number specifically, and the constraint name is right there in
 * the Postgres message — so it is translated into the field the agent must
 * change, in the camelCase the form uses, which lets the app highlight the
 * field through `applyServerFieldErrors` instead of only toasting.
 *
 * Keyed by constraint name; anything not listed keeps the generic message.
 */
const UNIQUE_CONSTRAINTS = {
  cooperatives_registration_number_key: {
    field: 'registrationNumber',
    message:
      'A cooperative with that registration number already exists. Check the number, or open the existing cooperative instead of registering it again.',
  },
  profiles_user_id_key: {
    field: null,
    message: 'That account already has a profile.',
  },
  partners_organization_email_key: {
    field: 'organizationEmail',
    message: 'A partner with that organisation email already exists.',
  },
  uq_farm_profiles_one_primary: {
    field: null,
    message:
      'That farmer already has a main farm. Promote the new one instead of adding a second main farm.',
  },
  uq_consent_one_active: {
    field: null,
    message: 'That record already has an active consent. Withdraw it before recording another.',
  },
  yield_benchmarks_crop_state_lga_season_key: {
    field: null,
    message: 'A benchmark already exists for that crop, state, LGA and season.',
  },
};

/**
 * Pulls the constraint name out of a Postgres unique-violation.
 *
 * Postgres puts it in `constraint`, but PostgREST does not always pass that
 * through — it often arrives only inside the message or details text, as
 * `duplicate key value violates unique constraint "..."`. Both are checked
 * rather than relying on the structured field that may not be there.
 */
function uniqueConstraintName(err) {
  if (typeof err?.constraint === 'string' && err.constraint.length > 0) {
    return err.constraint;
  }
  const text = `${err?.message || ''} ${err?.details || ''}`;
  const match = /unique constraint "([^"]+)"/.exec(text);
  return match ? match[1] : null;
}

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

  if (err && err.code === '23505') {
    const constraint = uniqueConstraintName(err);
    const known = constraint ? UNIQUE_CONSTRAINTS[constraint] : null;
    if (known) {
      // `details` must be the ARRAY the client parses into field errors —
      // `fail` assigns it straight to `error.details`, and the app's
      // `AppError` only reads it when `Array.isArray`. Wrapping it in an
      // object would leave the field unmarked and the message toast-only.
      return fail(
        res,
        409,
        'CONFLICT',
        known.message,
        known.field ? [{ field: known.field, message: known.message }] : undefined
      );
    }
  }

  /**
   * 22P02 on an enum column, said in words.
   *
   * The generic mapping is "A value had the wrong type", which is true and
   * undiagnosable: it names neither the field, the value, nor what was
   * allowed. On a list endpoint it reads as a screen that will not load.
   *
   * Every status filter this API exposes is now pinned to its enum's labels
   * in the validators, so this branch should be unreachable from a query
   * string — but a body field, a sub-resource or a value written straight
   * through from an import can still reach Postgres, and when it does the
   * response should say which value was refused and what is accepted.
   */
  if (err && err.code === '22P02') {
    const violation = parseEnumViolation(err);
    if (violation) {
      const allowed = violation.allowed
        ? ` Allowed values are: ${violation.allowed.join(', ')}.`
        : '';
      return fail(
        res,
        400,
        'BAD_REQUEST',
        `"${violation.value}" is not a valid ${violation.type.replace(/_/g, ' ')}.${allowed}`
      );
    }
  }

  if (mapped) {
    const [status, code, message] = mapped;
    return fail(res, status, code, message);
  }

  return serverError(res, 'Something went wrong');
}

module.exports = { notFoundHandler, errorHandler };
