'use strict';

/**
 * The Postgres ENUM types this API filters on, and their labels.
 *
 * These exist because an enum comparison against a label that does not exist
 * is not a soft failure. Postgres raises 22P02 (`invalid input value for enum
 * …`), PostgREST passes it through, and this API's error middleware turns it
 * into a flat 400 "A value had the wrong type" with nothing naming the field
 * or the value. On a list endpoint that reads as a screen that simply will not
 * load — which is how the admin Yield Verification page shipped broken: it
 * sent `status=unverified`, and `yield_verification_status` has no such label
 * (it is `pending | verified | rejected`).
 *
 * Two users:
 *
 *   1. `validators/domain.js` narrows each list endpoint's `status` filter to
 *      the labels of the column it actually filters, so a wrong value fails in
 *      Joi with a 422 naming the field and the allowed values, before a query
 *      is ever built.
 *   2. `middleware/error.js` uses them to turn a 22P02 that still gets through
 *      — from a body field, a sub-resource, anything not covered above — into
 *      a message that names the value and lists what was allowed.
 *
 * `npm run check:enums` asserts this file against the `CREATE TYPE` and
 * `ALTER TYPE … ADD VALUE` statements in the consolidated schema, so it cannot
 * drift from the database. Add a label to the migration and the check fails
 * until it is added here too.
 */
const ENUM_LABELS = Object.freeze({
  app_role: ['super_admin', 'ops_admin', 'finance_admin', 'field_agent', 'partner_admin', 'partner_analyst'],
  user_status: ['pending', 'active', 'suspended', 'rejected'],
  gender_type: ['male', 'female', 'other'],
  verification_status: ['pending', 'verified', 'mismatch', 'failed'],
  yield_verification_status: ['pending', 'verified', 'rejected'],
  financing_status: ['pending', 'approved', 'rejected', 'disbursed', 'completed'],
  payment_status: ['pending', 'paid', 'overdue', 'defaulted'],
  credit_tier: ['A', 'B', 'C', 'D'],
  wallet_status: ['active', 'frozen', 'suspended'],
  transaction_type: ['credit', 'debit', 'settlement'],
  transaction_status: ['pending', 'completed', 'failed', 'reversed'],
  settlement_status: ['pending', 'approved', 'rejected', 'completed'],
  change_request_status: ['pending', 'approved', 'rejected'],
  consent_entity_type: ['cooperative', 'farmer'],
  consent_status: ['active', 'pending_verification', 'withdrawn', 'superseded'],
  consent_otp_status: ['verified', 'pending', 'failed', 'not_required'],
});

/**
 * Reads the enum name and the offending value out of a Postgres 22P02.
 *
 * The message is `invalid input value for enum <type>: "<value>"`. PostgREST
 * puts it in `message`, sometimes in `details`, so both are searched. Returns
 * null for any other 22P02 — a malformed UUID, say — which keeps the generic
 * message for those rather than claiming an enum problem.
 */
function parseEnumViolation(err) {
  const text = `${err?.message || ''} ${err?.details || ''}`;
  const match = /invalid input (?:value|syntax) for (?:type )?enum (\w+)\s*:\s*"([^"]*)"/i.exec(text);
  if (!match) return null;
  const [, type, value] = match;
  return { type, value, allowed: ENUM_LABELS[type] || null };
}

module.exports = { ENUM_LABELS, parseEnumViolation };
