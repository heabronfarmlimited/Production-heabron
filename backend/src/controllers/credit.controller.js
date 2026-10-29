'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, notFound, forbidden, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { recalculateFarmerScore, recalculateCooperativeScore } = require('../services/credit-score');
const { partnerMaySeeFarmer, partnerMaySeeCooperative, isPartner } = require('../utils/ownership');

async function listFarmerScores(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { tier, cooperativeId } = req.query;

  let q = sb.from('credit_scores').select(
    `*, farmers(id, full_name, cooperative_id, cooperatives(name))`,
    { count: 'exact' }
  );
  if (tier) q = q.eq('credit_tier', tier);

  // FIXED — `cooperativeId` was applied with a JS `.filter()` AFTER
  // `.range()`, so the database returned page N of ALL scored farmers and the
  // filter then discarded the ones outside the cooperative. Filtering a
  // 40-farmer cooperative out of 2000 scores returned an empty first page
  // while `meta.total` reported 2000 — the admin saw "2000 results" and no
  // rows, and paging forward hit scattered single entries. The filter is now
  // part of the query, so both the page and the total are correct.
  if (cooperativeId) {
    const { data: members, error: memberErr } = await sb
      .from('farmers')
      .select('id')
      .eq('cooperative_id', cooperativeId)
      .limit(5000);
    if (memberErr) throw memberErr;
    const ids = (members || []).map((m) => m.id);
    if (ids.length === 0) return paginated(res, [], { page, pageSize, total: 0 });
    q = q.in('farmer_id', ids);
  }

  const { data, count, error } = await q
    .order('final_credit_score', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function getFarmerScore(req, res) {
  const sb = supabaseAdmin();
  const [scoreRes, histRes, farmerRes] = await Promise.all([
    sb.from('credit_scores').select('*').eq('farmer_id', req.params.farmerId).maybeSingle(),
    sb.from('credit_score_history').select('*').eq('farmer_id', req.params.farmerId).order('calculated_at', { ascending: false }).limit(50),
    sb.from('farmers').select(`*, cooperatives(*), farm_profiles(*)`).eq('id', req.params.farmerId).maybeSingle(),
  ]);
  // FIXED — all three queries discarded their error. A failed score lookup
  // rendered as `current: null`, which the admin UI shows as "not yet scored"
  // for a farmer who is in fact scored.
  for (const r of [scoreRes, histRes, farmerRes]) {
    if (r.error) throw r.error;
  }
  if (!farmerRes.data) return notFound(res, 'Farmer not found');
  return ok(res, {
    farmer: farmerRes.data,
    current: scoreRes.data,
    history: histRes.data || [],
  });
}

async function listCooperativeScores(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { tier } = req.query;
  let q = sb.from('cooperative_credit_scores').select(`*, cooperatives(id, name, state, lga)`, { count: 'exact' });
  if (tier) q = q.eq('cooperative_tier', tier);
  q = q.order('average_score', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function getCooperativeScore(req, res) {
  const sb = supabaseAdmin();
  const [scoreRes, coopRes, members] = await Promise.all([
    sb.from('cooperative_credit_scores').select('*').eq('cooperative_id', req.params.cooperativeId).maybeSingle(),
    sb.from('cooperatives').select('*').eq('id', req.params.cooperativeId).maybeSingle(),
    sb.from('farmers').select(`id, full_name, credit_scores(final_credit_score, credit_tier)`).eq('cooperative_id', req.params.cooperativeId),
  ]);
  for (const r of [scoreRes, coopRes, members]) {
    if (r.error) throw r.error;
  }
  if (!coopRes.data) return notFound(res, 'Cooperative not found');
  return ok(res, {
    cooperative: coopRes.data,
    score: scoreRes.data,
    members: members.data || [],
  });
}

async function recalcFarmer(req, res) {
  const result = await recalculateFarmerScore(req.params.farmerId, { triggerReason: 'admin_manual' });
  return ok(res, result);
}

async function recalcCooperative(req, res) {
  const result = await recalculateCooperativeScore(req.params.cooperativeId);
  return ok(res, result);
}

/**
 * Credit Report — the lender-facing aggregated report for one cooperative or farmer.
 * Includes score, breakdown, trends, loan + repayment history, risk flags.
 */
async function farmerCreditReport(req, res) {
  const sb = supabaseAdmin();
  const farmerId = req.params.farmerId;

  // FIXED — AUTHORISATION HOLE. `partner.routes.js` mounts this endpoint under
  // the comment "Credit reports — partner-scoped (enforced in
  // credit.controller.js)". Nothing here enforced anything: any partner user
  // could pull the complete credit file for ANY farmer in the system by id,
  // including the raw `farmers` row (NIN, BVN, phone, address, date of birth),
  // every loan, every repayment, every field note.
  //
  // The scope applied is the same one `partner.controller.search` already
  // uses: a farmer named in a financing request forwarded to this partner, or
  // a member of a cooperative so forwarded. Partners keep their read-only
  // directory browse (`/partner/farmers`) — that is deliberate per the route
  // comments — but the full credit file is now restricted to their portfolio.
  if (isPartner(req.user)) {
    const allowed = await partnerMaySeeFarmer(sb, req.user.partnerId, farmerId);
    if (!allowed) {
      return forbidden(res, 'This farmer is not in your organization\'s portfolio');
    }
  }

  const [farmer, score, history, financings, repayments, deliveries, productions, marketAccess, fieldNotes] = await Promise.all([
    sb.from('farmers').select(`*, cooperatives(name, state, lga), farm_profiles(*)`).eq('id', farmerId).maybeSingle(),
    sb.from('credit_scores').select('*').eq('farmer_id', farmerId).maybeSingle(),
    // FIXED — these five had no `.limit()`. PostgREST silently truncates an
    // un-ranged select at `db-max-rows` (1000 by default) with NO error, so a
    // long-running farmer's report quietly dropped the oldest history and the
    // report presented the remainder as complete. Explicit limits make the
    // cap visible and intentional.
    sb.from('credit_score_history').select('final_score, credit_tier, calculated_at').eq('farmer_id', farmerId).order('calculated_at', { ascending: true }).limit(500),
    sb.from('financing_requests').select('*').eq('farmer_id', farmerId).order('created_at', { ascending: false }).limit(200),
    sb.from('repayment_records').select('*').eq('farmer_id', farmerId).eq('voided', false).order('payment_date', { ascending: false }).limit(1000),
    sb.from('produce_deliveries').select('*').eq('farmer_id', farmerId).order('date_delivered', { ascending: false }).limit(20),
    sb.from('seasonal_productions').select('*').eq('farmer_id', farmerId).order('expected_harvest_date', { ascending: true, nullsFirst: true }).limit(200),
    sb.from('market_access_records').select('*').eq('farmer_id', farmerId).order('season_year', { ascending: true, nullsFirst: true }).limit(200),
    sb.from('field_notes').select('*').eq('farmer_id', farmerId).order('event_date', { ascending: false }).limit(500),
  ]);
  for (const r of [farmer, score, history, financings, repayments, deliveries, productions, marketAccess, fieldNotes]) {
    if (r.error) throw r.error;
  }
  if (!farmer.data) return notFound(res, 'Farmer not found');

  const flags = [];
  if (score.data?.has_active_default) flags.push({ type: 'active_default', severity: 'high', message: 'Has an outstanding loan past its due date' });
  if (score.data?.credit_tier === 'D') flags.push({ type: 'low_tier', severity: 'medium', message: 'Score is in the At-Risk tier' });
  // FIXED — `Number(h.final_score)` on a NULL history row produced NaN, and
  // `NaN < x - 10` is false, so a score drop immediately after a NULL entry
  // was never flagged. Non-numeric entries are dropped before comparing.
  const recentScores = (history.data || [])
    .map((h) => Number(h.final_score))
    .filter((n) => Number.isFinite(n))
    .slice(-3);
  if (recentScores.length === 3 && recentScores[2] < recentScores[0] - 10) {
    flags.push({ type: 'score_drop', severity: 'medium', message: 'Score dropped 10+ points over the last 3 calculations' });
  }

  return ok(res, {
    subject: farmer.data,
    score: score.data,
    trend: history.data || [],
    financingHistory: financings.data || [],
    repaymentHistory: repayments.data || [],
    recentDeliveries: deliveries.data || [],
    seasonalProductions: productions.data || [],
    marketAccess: marketAccess.data || [],
    fieldNotes: fieldNotes.data || [],
    riskFlags: flags,
  });
}

async function cooperativeCreditReport(req, res) {
  const sb = supabaseAdmin();
  const id = req.params.cooperativeId;

  // Same authorisation hole as `farmerCreditReport` — see the note there.
  if (isPartner(req.user)) {
    const allowed = await partnerMaySeeCooperative(sb, req.user.partnerId, id);
    if (!allowed) {
      return forbidden(res, 'This cooperative is not in your organization\'s portfolio');
    }
  }

  const [coop, score, farmers, financings, history] = await Promise.all([
    sb.from('cooperatives').select('*').eq('id', id).maybeSingle(),
    sb.from('cooperative_credit_scores').select('*').eq('cooperative_id', id).maybeSingle(),
    sb.from('farmers').select(`id, full_name, gender, lga, nin_verification_status, credit_scores(final_credit_score, credit_tier), farm_profiles(crop_type, farm_size_acres)`).eq('cooperative_id', id).limit(5000),
    sb.from('financing_requests').select('*').eq('cooperative_id', id).order('created_at', { ascending: false }).limit(500),
    // NOTE (not fixed — see AUDIT_BACKEND.md "Open"): `credit_score_history`
    // holds one row PER FARMER per recalculation, tagged with the farmer's
    // cooperative. So this "cooperative score trend" is actually a stream of
    // individual farmers' scores interleaved, not the cooperative average over
    // time. Correcting it needs a cooperative-level history table; changing
    // the shape here would break the dashboard chart that consumes it.
    sb.from('credit_score_history').select('final_score, calculated_at').eq('cooperative_id', id).order('calculated_at', { ascending: true }).limit(1000),
  ]);
  for (const r of [coop, score, farmers, financings, history]) {
    if (r.error) throw r.error;
  }
  if (!coop.data) return notFound(res, 'Cooperative not found');
  return ok(res, {
    cooperative: coop.data,
    score: score.data,
    members: farmers.data || [],
    financingHistory: financings.data || [],
    scoreTrend: history.data || [],
  });
}

module.exports = {
  listFarmerScores,
  getFarmerScore,
  listCooperativeScores,
  getCooperativeScore,
  recalcFarmer,
  recalcCooperative,
  farmerCreditReport,
  cooperativeCreditReport,
};
