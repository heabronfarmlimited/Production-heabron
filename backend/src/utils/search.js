'use strict';

/**
 * Escape the characters PostgREST treats as special inside an `ilike` pattern.
 *
 * FIXED — every search endpoint interpolated the user's term straight into
 * `` `%${search}%` ``:
 *
 *   farmers.list, cooperatives.list, partner.search,
 *   partner.browseCooperatives, partner.browseFarmers,
 *   admin.agents.listAgents, admin.partners.listPartners
 *
 * In a PostgREST filter value:
 *   `%` and `_` are SQL LIKE wildcards — searching "100%" or "_" matched
 *       every row, so the UI showed the whole table as if it were a result.
 *   `,` separates values in the query string — a name with a comma
 *       ("Okafor, Emeka") terminated the filter early and produced a
 *       malformed query, which came back as a 400 that the dashboards
 *       rendered as "no results".
 *   `\` is the escape character itself.
 *
 * This is not an injection into SQL (supabase-js parameterises the request),
 * but it is an injection into the filter grammar, and it made search
 * unreliable in exactly the cases users notice.
 */
function escapeLikePattern(term) {
  return String(term ?? '').replace(/[\\%_,]/g, (c) => `\\${c}`);
}

/** `%term%` — a contains-match pattern with the term's metacharacters escaped. */
function containsPattern(term) {
  return `%${escapeLikePattern(term)}%`;
}

module.exports = { escapeLikePattern, containsPattern };
