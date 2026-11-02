'use strict';

/**
 * Credit report endpoints — the lender-facing document.
 *
 * The payload is built in services/credit-report and is identical for every
 * caller, so a farmer's report reads the same in the mobile app and in the
 * dashboards. Rendering to PDF happens client-side.
 *
 * Access follows the same rules as the rest of the app: a field agent sees
 * only farmers and cooperatives they created; an admin sees everything; a
 * partner is handled by the partner routes, which apply their own scoping and
 * the third-party-sharing consent gate.
 */

const { supabaseAdmin } = require('../config/supabase');
const { ok, notFound, forbidden } = require('../utils/response');
const reports = require('../services/credit-report');

/** Field agents may only report on records they created. */
async function assertFarmerVisible(sb, farmerId, user) {
  if (user.role !== 'field_agent') return { ok: true };
  const { data, error } = await sb
    .from('farmers')
    .select('created_by_agent_id')
    .eq('id', farmerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: 'not_found' };
  if (data.created_by_agent_id !== user.userId) return { ok: false, reason: 'forbidden' };
  return { ok: true };
}

async function assertCooperativeVisible(sb, cooperativeId, user) {
  if (user.role !== 'field_agent') return { ok: true };
  const { data, error } = await sb
    .from('cooperatives')
    .select('created_by_agent_id')
    .eq('id', cooperativeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: 'not_found' };
  if (data.created_by_agent_id !== user.userId) return { ok: false, reason: 'forbidden' };
  return { ok: true };
}

async function farmerCreditReport(req, res) {
  const sb = supabaseAdmin();
  const farmerId = req.params.farmerId;

  const access = await assertFarmerVisible(sb, farmerId, req.user);
  if (access.reason === 'not_found') return notFound(res, 'Farmer not found');
  if (access.reason === 'forbidden') return forbidden(res, 'That farmer was not onboarded by you');

  const report = await reports.buildFarmerReport(farmerId);
  if (!report) return notFound(res, 'Farmer not found');
  return ok(res, report);
}

async function cooperativeCreditReport(req, res) {
  const sb = supabaseAdmin();
  const cooperativeId = req.params.cooperativeId;

  const access = await assertCooperativeVisible(sb, cooperativeId, req.user);
  if (access.reason === 'not_found') return notFound(res, 'Cooperative not found');
  if (access.reason === 'forbidden') {
    return forbidden(res, 'That cooperative was not created by you');
  }

  const report = await reports.buildCooperativeReport(cooperativeId);
  if (!report) return notFound(res, 'Cooperative not found');
  return ok(res, report);
}

module.exports = { farmerCreditReport, cooperativeCreditReport };
