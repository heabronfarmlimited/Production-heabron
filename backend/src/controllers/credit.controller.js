'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, notFound, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { recalculateFarmerScore, recalculateCooperativeScore } = require('../services/credit-score');

async function listFarmerScores(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { tier, cooperativeId } = req.query;

  let q = sb.from('credit_scores').select(
    `*, farmers(id, full_name, cooperative_id, cooperatives(name))`,
    { count: 'exact' }
  );
  if (tier) q = q.eq('credit_tier', tier);
  q = q.order('final_credit_score', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  let rows = data || [];
  if (cooperativeId) rows = rows.filter((r) => r.farmers?.cooperative_id === cooperativeId);
  return paginated(res, rows, { page, pageSize, total: count || 0 });
}

async function getFarmerScore(req, res) {
  const sb = supabaseAdmin();
  const [scoreRes, histRes, farmerRes] = await Promise.all([
    sb.from('credit_scores').select('*').eq('farmer_id', req.params.farmerId).maybeSingle(),
    sb.from('credit_score_history').select('*').eq('farmer_id', req.params.farmerId).order('calculated_at', { ascending: false }).limit(50),
    sb.from('farmers').select(`*, cooperatives(*), farm_profiles(*)`).eq('id', req.params.farmerId).maybeSingle(),
  ]);
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
  if (!coopRes.data) return notFound(res);
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
  const [farmer, score, history, financings, repayments, deliveries, productions, marketAccess, fieldNotes] = await Promise.all([
    sb.from('farmers').select(`*, cooperatives(name, state, lga), farm_profiles(*)`).eq('id', farmerId).maybeSingle(),
    sb.from('credit_scores').select('*').eq('farmer_id', farmerId).maybeSingle(),
    sb.from('credit_score_history').select('final_score, credit_tier, calculated_at').eq('farmer_id', farmerId).order('calculated_at', { ascending: true }),
    sb.from('financing_requests').select('*').eq('farmer_id', farmerId).order('created_at', { ascending: false }),
    sb.from('repayment_records').select('*').eq('farmer_id', farmerId).eq('voided', false).order('payment_date', { ascending: false }),
    sb.from('produce_deliveries').select('*').eq('farmer_id', farmerId).order('date_delivered', { ascending: false }).limit(20),
    sb.from('seasonal_productions').select('*').eq('farmer_id', farmerId).order('expected_harvest_date', { ascending: true, nullsFirst: true }),
    sb.from('market_access_records').select('*').eq('farmer_id', farmerId).order('season_year', { ascending: true, nullsFirst: true }),
    sb.from('field_notes').select('*').eq('farmer_id', farmerId).order('event_date', { ascending: false }),
  ]);
  if (!farmer.data) return notFound(res);

  const flags = [];
  if (score.data?.has_active_default) flags.push({ type: 'active_default', severity: 'high', message: 'Has an outstanding loan past its due date' });
  if (score.data?.credit_tier === 'D') flags.push({ type: 'low_tier', severity: 'medium', message: 'Score is in the At-Risk tier' });
  const recentScores = (history.data || []).slice(-3).map((h) => Number(h.final_score));
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
  const [coop, score, farmers, financings, history] = await Promise.all([
    sb.from('cooperatives').select('*').eq('id', id).maybeSingle(),
    sb.from('cooperative_credit_scores').select('*').eq('cooperative_id', id).maybeSingle(),
    sb.from('farmers').select(`id, full_name, gender, lga, nin_verification_status, credit_scores(final_credit_score, credit_tier), farm_profiles(crop_type, farm_size_acres)`).eq('cooperative_id', id),
    sb.from('financing_requests').select('*').eq('cooperative_id', id).order('created_at', { ascending: false }),
    sb.from('credit_score_history').select('final_score, calculated_at').eq('cooperative_id', id).order('calculated_at', { ascending: true }),
  ]);
  if (!coop.data) return notFound(res);
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
