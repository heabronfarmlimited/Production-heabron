'use strict';

const logger = require('./logger');
const { ADMIN_ROLES, PARTNER_ROLES } = require('../middleware/auth');

/**
 * Row-level ownership checks.
 *
 * FIXED — `assertFarmerAccess` was copy-pasted into productions,
 * marketAccess and fieldNotes with three slightly different `select` lists,
 * and several endpoints that needed the same check had none at all
 * (see AUDIT_BACKEND.md: farmers.getCreditScore, cooperatives.listFarmers).
 * One implementation, used everywhere, so a new endpoint cannot forget it.
 *
 * Returns `{ error: 'not_found' | 'forbidden' | 'lookup_failed' }` or
 * `{ farmer }` / `{ cooperative }`. Callers map the code to a response.
 */

const BASE_FARMER_COLUMNS = 'id, full_name, created_by_agent_id, cooperative_id';

async function assertFarmerAccess(sb, farmerId, user, columns = BASE_FARMER_COLUMNS) {
  if (!farmerId) return { error: 'not_found' };
  const { data: farmer, error } = await sb.from('farmers').select(columns).eq('id', farmerId).maybeSingle();
  if (error) {
    // Previously discarded: a transient error read as "farmer not found",
    // so the agent was told their own farmer did not exist.
    logger.error({ err: error.message, code: error.code, farmerId }, 'farmer ownership lookup failed');
    return { error: 'lookup_failed' };
  }
  if (!farmer) return { error: 'not_found' };
  if (user.role === 'field_agent' && farmer.created_by_agent_id !== user.userId) {
    return { error: 'forbidden' };
  }
  return { farmer };
}

const BASE_COOP_COLUMNS = 'id, name, created_by_agent_id';

async function assertCooperativeAccess(sb, cooperativeId, user, columns = BASE_COOP_COLUMNS) {
  if (!cooperativeId) return { error: 'not_found' };
  const { data: cooperative, error } = await sb
    .from('cooperatives')
    .select(columns)
    .eq('id', cooperativeId)
    .maybeSingle();
  if (error) {
    logger.error({ err: error.message, code: error.code, cooperativeId }, 'cooperative ownership lookup failed');
    return { error: 'lookup_failed' };
  }
  if (!cooperative) return { error: 'not_found' };
  if (user.role === 'field_agent' && cooperative.created_by_agent_id !== user.userId) {
    return { error: 'forbidden' };
  }
  return { cooperative };
}

/**
 * The cooperative + farmer ids a partner organisation may see: those named in,
 * or whose cooperative was named in, a financing request forwarded to them.
 *
 * Used to scope the credit reports, which `partner.routes.js` documents as
 * "partner-scoped (enforced in credit.controller.js)" but which enforced
 * nothing — any partner could pull any farmer's full credit file.
 */
async function partnerVisibleScope(sb, partnerId) {
  const scope = { coopIds: new Set(), farmerIds: new Set() };
  if (!partnerId) return scope;

  const { data, error } = await sb
    .from('financing_requests')
    .select('cooperative_id, farmer_id')
    .eq('forwarded_to_partner_id', partnerId);
  if (error) {
    logger.error({ err: error.message, code: error.code, partnerId }, 'partner scope lookup failed');
    return scope;
  }
  for (const r of data || []) {
    if (r.cooperative_id) scope.coopIds.add(r.cooperative_id);
    if (r.farmer_id) scope.farmerIds.add(r.farmer_id);
  }
  return scope;
}

/** True when this partner may read the given farmer's credit file. */
async function partnerMaySeeFarmer(sb, partnerId, farmerId) {
  const { coopIds, farmerIds } = await partnerVisibleScope(sb, partnerId);
  if (farmerIds.has(farmerId)) return true;
  if (coopIds.size === 0) return false;

  const { data, error } = await sb.from('farmers').select('cooperative_id').eq('id', farmerId).maybeSingle();
  if (error || !data) return false;
  return data.cooperative_id ? coopIds.has(data.cooperative_id) : false;
}

/** True when this partner may read the given cooperative's credit file. */
async function partnerMaySeeCooperative(sb, partnerId, cooperativeId) {
  const { coopIds } = await partnerVisibleScope(sb, partnerId);
  return coopIds.has(cooperativeId);
}

const isAdmin = (user) => ADMIN_ROLES.includes(user?.role);
const isPartner = (user) => PARTNER_ROLES.includes(user?.role);

module.exports = {
  assertFarmerAccess,
  assertCooperativeAccess,
  partnerVisibleScope,
  partnerMaySeeFarmer,
  partnerMaySeeCooperative,
  isAdmin,
  isPartner,
};
