/**
 * The status values the API will accept, and the tab lists built from them.
 *
 * WHY THIS EXISTS
 *
 * Every filter tab in these dashboards used to spell its own status strings.
 * The Yield Verification page spelled one of them `unverified`, and the
 * column it filters is of Postgres type `yield_verification_status`, whose
 * labels are `pending | verified | rejected`. A comparison against a label
 * that does not exist is error 22P02 — the request fails outright — so the
 * page returned 400 on the tab it opens on, for every administrator, from the
 * day it shipped. Under the error banner the table read "No unverified
 * production records", which is also what a working, empty list looks like.
 *
 * The word was wrong in one place and nothing could tell. So the values live
 * here once, `statusTabs` refuses a value that is not one of them, and
 * `npm run check:contract` compares this file against the backend's own
 * `src/utils/enums.js` — which is itself checked against the migrations. A
 * label added to the database and not here fails the build.
 *
 * The DISPLAY name is still free. "Unverified" is a better word than
 * "Pending" for an unchecked yield, and it stays — as a label, over the value
 * `pending`. That split is the whole point: what an administrator reads and
 * what the database is asked for are different things.
 */

/** Postgres enum type -> its labels. Checked against the backend. */
export const STATUS_LABELS = Object.freeze({
  user_status: Object.freeze(['pending', 'active', 'suspended', 'rejected']),
  yield_verification_status: Object.freeze(['pending', 'verified', 'rejected']),
  financing_status: Object.freeze(['pending', 'approved', 'rejected', 'disbursed', 'completed']),
  payment_status: Object.freeze(['pending', 'paid', 'overdue', 'defaulted']),
  transaction_status: Object.freeze(['pending', 'completed', 'failed', 'reversed']),
  settlement_status: Object.freeze(['pending', 'approved', 'rejected', 'completed']),
  change_request_status: Object.freeze(['pending', 'approved', 'rejected']),
  consent_status: Object.freeze(['active', 'pending_verification', 'withdrawn', 'superseded']),
});

/**
 * The same guard for a plain list of values, where the display name is
 * derived (capitalised in CSS) rather than written out.
 *
 * @param {keyof typeof STATUS_LABELS} type
 * @param {string[]} values
 * @returns {string[]}
 */
export function statusValues(type, values) {
  statusTabs(type, values.map((value) => [value, value]));
  return values;
}

/**
 * One status value, checked.
 *
 * For the places that filter by a fixed status rather than offering tabs —
 * "the active partners", "the active agents". Those look too obvious to get
 * wrong, which is precisely the argument that let `unverified` through.
 *
 * @param {keyof typeof STATUS_LABELS} type
 * @param {string} value
 * @returns {string}
 */
export function statusFilter(type, value) {
  statusValues(type, [value]);
  return value;
}

/**
 * Builds a tab list, refusing any value that is not a label on `type`.
 *
 * `''` is allowed and means "no filter" — the All tab, which sends nothing.
 *
 * Called at module scope by each page, so a wrong value is a loud error the
 * moment the page is imported rather than a 400 the user sees instead of
 * their data.
 *
 * @param {keyof typeof STATUS_LABELS} type
 * @param {Array<[string, string]>} pairs [value, display label]
 * @returns {Array<[string, string]>}
 */
export function statusTabs(type, pairs) {
  const allowed = STATUS_LABELS[type];
  if (!allowed) {
    throw new Error(`statusTabs: "${type}" is not a known status type`);
  }
  for (const [value] of pairs) {
    if (value !== '' && !allowed.includes(value)) {
      throw new Error(
        `statusTabs(${type}): "${value}" is not a valid status. ` +
          `Allowed: ${allowed.join(', ')} (or '' for no filter).`,
      );
    }
  }
  return pairs;
}
