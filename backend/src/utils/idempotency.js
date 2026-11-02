'use strict';

/**
 * Duplicate-safe creation (v2 user flow: "duplicate-safe client UUID").
 *
 * Onboarding happens on a field connection. A request can take long enough
 * that the agent taps again, or the connection can drop after the server has
 * committed but before the response arrives — and the offline queue then
 * retries it. Both produce two records for one person or one cooperative:
 * same details, two ids, two credit scores, and a member count that is wrong.
 *
 * The client sends `clientRequestId`, one UUID per form session, on every
 * attempt. This module turns that into "create once":
 *
 *   1. look for an existing row with the key, and return it if found;
 *   2. otherwise insert — and if the unique index rejects the insert because
 *      a concurrent retry won the race, read that row and return it.
 *
 * Step 2 is the part that matters. A check-then-insert alone races: two
 * retries can both read "nothing there" before either writes. The partial
 * unique index is what makes this correct rather than usually correct, and
 * catching its 23505 is what turns correctness into a useful response instead
 * of a 409 the agent cannot act on.
 */

const UNIQUE_VIOLATION = '23505';

/**
 * Finds a row already created under this key.
 *
 * Returns `{ row, error }`. A missing key is not an error — it means the
 * client is an older build, and creation proceeds unprotected exactly as it
 * did before.
 */
async function findByClientRequestId(sb, table, clientRequestId, select = '*') {
  if (!clientRequestId) return { row: null, error: null };

  const { data, error } = await sb
    .from(table)
    .select(select)
    .eq('client_request_id', clientRequestId)
    .limit(1);

  if (error) return { row: null, error };
  return { row: data?.[0] || null, error: null };
}

/**
 * True when this error is the client_request_id index rejecting a duplicate.
 *
 * Checked specifically rather than treating every 23505 as a replay: a
 * duplicate registration number is also a 23505, and that one is a real
 * conflict the agent has to resolve, not a retry to absorb.
 */
function isClientRequestIdConflict(err, table) {
  if (!err || err.code !== UNIQUE_VIOLATION) return false;
  const name = `uq_${table}_client_request_id`;
  if (typeof err.constraint === 'string' && err.constraint === name) return true;
  // PostgREST does not always pass `constraint` through; the name is in the
  // message text when it does not.
  const text = `${err.message || ''} ${err.details || ''}`;
  return text.includes(name);
}

/**
 * Runs `insert` unless the key has already produced a row.
 *
 * `insert` must be a function returning the Supabase `{ data, error }` of the
 * insert itself, so this module does not need to know the row shape.
 *
 * Returns `{ row, replayed, error }`. `replayed` is true when the row already
 * existed, which lets the caller answer 200 rather than 201 and skip the side
 * effects — the notification, the activity log, the score recalculation —
 * that already ran the first time. Firing those again is how one farmer ends
 * up with three "farmer onboarded" entries in the audit log.
 */
async function createOnce(sb, table, clientRequestId, insert, select = '*') {
  const existing = await findByClientRequestId(sb, table, clientRequestId, select);
  if (existing.error) return { row: null, replayed: false, error: existing.error };
  if (existing.row) return { row: existing.row, replayed: true, error: null };

  const { data, error } = await insert();

  if (error && isClientRequestIdConflict(error, table)) {
    // A concurrent retry committed first. Its row is the canonical one.
    const winner = await findByClientRequestId(sb, table, clientRequestId, select);
    if (winner.error) return { row: null, replayed: false, error: winner.error };
    if (winner.row) return { row: winner.row, replayed: true, error: null };
    // The index rejected the insert but the row cannot be read back. Rather
    // than invent a success, hand the original error up.
    return { row: null, replayed: false, error };
  }

  if (error) return { row: null, replayed: false, error };

  const row = Array.isArray(data) ? data[0] || null : data;
  return { row, replayed: false, error: null };
}

module.exports = {
  UNIQUE_VIOLATION,
  findByClientRequestId,
  isClientRequestIdConflict,
  createOnce,
};
