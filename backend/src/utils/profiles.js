'use strict';

const logger = require('./logger');

/**
 * Profile lookups.
 *
 * FIXED — three controllers (wallet, admin.wallet, activity) each carried a
 * private copy of `getProfilesForMany`, and two carried `getProfileFor`. They
 * had drifted (different `select` lists, none checking the query error). This
 * is the single implementation.
 *
 * Why these exist at all: `user_roles.user_id` and every `*_by_agent_id`
 * column reference `auth.users(id)`, NOT `profiles(user_id)`. PostgREST cannot
 * infer that relationship, so an embed like
 * `user_roles.select('user_id, profiles(email, full_name)')` resolves to
 * `profiles: null` rather than erroring — which is why several notification
 * emails were never sent. Always resolve profiles in a second query.
 */

/** Postgres caps URL length; keep `.in()` lists well under it. */
const IN_CHUNK = 200;

function chunk(arr, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const DEFAULT_COLUMNS = 'user_id, email, full_name';

/** One profile, or null. */
async function getProfileFor(sb, userId, columns = DEFAULT_COLUMNS) {
  if (!userId) return null;
  const { data, error } = await sb.from('profiles').select(columns).eq('user_id', userId).maybeSingle();
  if (error) {
    logger.error({ err: error.message, code: error.code, userId }, 'profile lookup failed');
    return null;
  }
  return data || null;
}

/**
 * Map of user_id -> profile for many ids, chunked so a long id list can never
 * blow the request URL limit (which previously returned an error that was
 * discarded, silently dropping every profile from the response).
 */
async function getProfilesForMany(sb, userIds, columns = DEFAULT_COLUMNS) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = new Map();
  if (ids.length === 0) return map;

  for (const group of chunk(ids)) {
    const { data, error } = await sb.from('profiles').select(columns).in('user_id', group);
    if (error) {
      logger.error({ err: error.message, code: error.code, count: group.length }, 'bulk profile lookup failed');
      continue;
    }
    for (const p of data || []) map.set(p.user_id, p);
  }
  return map;
}

/**
 * Every user_id holding one of `roles`, with their profile attached.
 * Replaces the broken `user_roles.select('user_id, profiles(...)')` embed.
 */
async function getUsersWithRoles(sb, roles) {
  const { data, error } = await sb.from('user_roles').select('user_id').in('role', roles);
  if (error) {
    logger.error({ err: error.message, code: error.code, roles }, 'role lookup failed');
    return [];
  }
  const ids = [...new Set((data || []).map((r) => r.user_id).filter(Boolean))];
  const profiles = await getProfilesForMany(sb, ids);
  return ids.map((id) => ({ userId: id, profile: profiles.get(id) || null }));
}

/** Every user seat linked to a partner organisation, with profiles attached. */
async function getPartnerUsers(sb, partnerId) {
  if (!partnerId) return [];
  const { data, error } = await sb.from('user_roles').select('user_id').eq('partner_id', partnerId);
  if (error) {
    logger.error({ err: error.message, code: error.code, partnerId }, 'partner user lookup failed');
    return [];
  }
  const ids = [...new Set((data || []).map((r) => r.user_id).filter(Boolean))];
  const profiles = await getProfilesForMany(sb, ids);
  return ids.map((id) => ({ userId: id, profile: profiles.get(id) || null }));
}

module.exports = { getProfileFor, getProfilesForMany, getUsersWithRoles, getPartnerUsers, chunk, IN_CHUNK };
