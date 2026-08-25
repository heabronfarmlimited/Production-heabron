'use strict';

/**
 * Heabron Credit Score Engine — v2.0  (Yield 60 / Repayment 40)
 *
 *   Final Credit Score = Yield Performance (0-60) + Repayment (0-40)
 *
 *   Yield Performance (0-60)
 *     = min(actual_yield_per_ha / benchmark_yield_per_ha, 1.0) * 60
 *
 *   Repayment (0-40), broken down exactly as the admin UI shows it:
 *     Repayment Rate     0-25   = min(total_paid / loan_amount, 1.0) * 25
 *     Timeliness         0-10   = on-time 10 | <=30d late 8 | >30d late 2
 *                                 (context-flagged late = not penalised -> 10)
 *     Default History    0-5    = no defaults 5 | recovered>=2 cycles 5
 *                                 | recovered 1 cycle 3 | active default 0
 *
 *   First cycle (no disbursed/completed loan yet): score = Yield only.
 *     A farmer can therefore reach at most 60 (Tier C/"Risk") on yield alone;
 *     Tiers B and A require a proven repayment record. This matches the
 *     admin "Yield /60 + Repayment /40" table (e.g. 25+40=65, 0+40=40).
 *
 *   Tier bands — adopted to match the live grade display (100->A, 65->B,
 *   60->C "Risk", 40/46->D "High Risk"). Tune TIER_THRESHOLDS in one place if
 *   the team wants the older spec bands (A90/B85/C75) back.
 */

const { supabaseAdmin } = require('../../config/supabase');
const logger = require('../../utils/logger');

const MODEL_VERSION = 'v2.0';

// Component weights (kept as named constants so the model is auditable).
const YIELD_MAX = 60;
const REPAYMENT_MAX = 40;
const REPAY_RATE_MAX = 25;
const REPAY_TIMELINESS_MAX = 10;
const REPAY_DEFAULT_MAX = 5;

// Tier thresholds (inclusive lower bound). Evidence-based from the live UI.
//   Spec-original alternative: A:90, B:85, C:75  (swap if preferred)
const TIER_THRESHOLDS = { A: 80, B: 65, C: 50 };

const ACRES_TO_HECTARES = 0.404686;

function tierForScore(score) {
  if (score >= TIER_THRESHOLDS.A) return 'A';
  if (score >= TIER_THRESHOLDS.B) return 'B';
  if (score >= TIER_THRESHOLDS.C) return 'C';
  return 'D';
}

function truncateOneDecimal(n) {
  return Math.floor(n * 10) / 10;
}

/**
 * Yield Performance — returns points on the 0-60 scale.
 * (Field name `score` is retained for backwards compatibility with callers.)
 */
function computeProductionScore({ actualYield, benchmarkYield }) {
  if (!actualYield || !benchmarkYield || benchmarkYield <= 0) {
    return { score: 0, yieldRatio: 0 };
  }
  const ratio = Math.min(actualYield / benchmarkYield, 1.0);
  return {
    score: truncateOneDecimal(ratio * YIELD_MAX),
    yieldRatio: Number(ratio.toFixed(4)),
  };
}

/**
 * Repayment — returns points on the 0-40 scale with the Rate/Time/Default
 * sub-breakdown the admin UI renders (Rate /25, Time /10, Def /5).
 */
function computeRepaymentScore({
  repayments = [],
  loanAmount = 0,
  dueDate,
  priorDefaults = { active: false, recoveredCleanCycles: 0 },
}) {
  const totalPaid = repayments.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
  const rate = loanAmount > 0 ? Math.min(totalPaid / loanAmount, 1.0) : 0;
  const repaymentRate = truncateOneDecimal(rate * REPAY_RATE_MAX);

  let timeliness = REPAY_TIMELINESS_MAX;
  if (dueDate) {
    const due = new Date(dueDate);
    let payoffDate = null;
    let cumulative = 0;
    for (const r of repayments
      .slice()
      .sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date))) {
      cumulative += Number(r.amount_paid || 0);
      if (cumulative >= loanAmount) {
        payoffDate = new Date(r.payment_date);
        break;
      }
    }
    if (!payoffDate) payoffDate = new Date();

    const daysLate = Math.max(0, Math.floor((payoffDate - due) / (1000 * 60 * 60 * 24)));
    if (daysLate <= 0) timeliness = REPAY_TIMELINESS_MAX;
    else if (daysLate <= 30) timeliness = 8;
    else timeliness = 2;

    // Context-flagged late repayments (weather / market / health) are
    // documented but NOT penalised — per spec section 3.2B.
    const anyContext = repayments.some((r) => r.context_flag && r.context_flag !== 'none');
    if (anyContext && daysLate > 0) timeliness = REPAY_TIMELINESS_MAX;
  }

  let defaultHistory = REPAY_DEFAULT_MAX;
  if (priorDefaults.active) defaultHistory = 0;
  else if (priorDefaults.recoveredCleanCycles >= 2) defaultHistory = REPAY_DEFAULT_MAX;
  else if (priorDefaults.recoveredCleanCycles >= 1) defaultHistory = 3;

  const total = truncateOneDecimal(repaymentRate + timeliness + defaultHistory);
  return { score: total, components: { repaymentRate, timeliness, defaultHistory } };
}

/**
 * Recommended loan limit — simple, tunable heuristic for the financing
 * summary card. Scales with farm capacity, tier, and proven cycles.
 */
function computeRecommendedLoan({ farmSizeAcres = 0, tier = 'D', cycleCount = 0, hasActiveDefault = false }) {
  if (hasActiveDefault || farmSizeAcres <= 0) {
    return { min: 0, max: 0, reason: hasActiveDefault ? 'Active default — new financing on hold' : 'Insufficient farm data' };
  }
  const PER_ACRE = 35000; // ₦ per acre baseline capacity (tunable)
  const tierMult = { A: 1.0, B: 0.85, C: 0.6, D: 0.35 }[tier] || 0.35;
  const cycleMult = Math.min(1 + cycleCount * 0.15, 1.6); // grows with repayment track record
  const base = farmSizeAcres * PER_ACRE * tierMult * cycleMult;
  const min = Math.round((base * 0.8) / 1000) * 1000;
  const max = Math.round((base * 1.0) / 1000) * 1000;
  const reason =
    cycleCount > 0
      ? `Based on ${cycleCount}-cycle repayment history + ${farmSizeAcres} acre yield capacity`
      : `Based on ${farmSizeAcres} acre yield capacity (no repayment history yet)`;
  return { min, max, reason };
}

async function lookupBenchmark(sb, { crop, state, lga, season }) {
  const tries = [
    { crop, state, lga, season },
    { crop, state, lga },
    { crop, state },
    { crop, state: 'default' },
  ];
  for (const t of tries) {
    let q = sb.from('regional_benchmarks').select('*').eq('crop', t.crop);
    if (t.state !== undefined) q = q.eq('state', t.state);
    if (t.lga !== undefined) q = q.eq('lga', t.lga);
    if (t.season !== undefined) q = q.eq('season', t.season);
    const { data } = await q.limit(1).maybeSingle();
    if (data) return Number(data.benchmark_yield_tonnes_per_hectare);
  }
  return null;
}

async function recalculateFarmerScore(farmerId, { triggerReason = 'manual' } = {}) {
  const sb = supabaseAdmin();

  const { data: farmer, error: ferr } = await sb
    .from('farmers')
    .select('*, farm_profiles(*), cooperative_id')
    .eq('id', farmerId)
    .maybeSingle();
  if (ferr) throw ferr;
  if (!farmer) throw new Error('Farmer not found');

  // Prefer a VERIFIED actual-yield record (yield-verification module is the
  // primary source); fall back to any record with an actual yield.
  const { data: verifiedProd } = await sb
    .from('seasonal_productions')
    .select('*')
    .eq('farmer_id', farmerId)
    .eq('verification_status', 'verified')
    .not('actual_yield_tonnes', 'is', null)
    .order('expected_harvest_date', { ascending: false })
    .limit(1);

  let prod = verifiedProd;
  if (!prod || prod.length === 0) {
    const { data: anyProd } = await sb
      .from('seasonal_productions')
      .select('*')
      .eq('farmer_id', farmerId)
      .not('actual_yield_tonnes', 'is', null)
      .order('expected_harvest_date', { ascending: false })
      .limit(1);
    prod = anyProd;
  }

  const farm = farmer.farm_profiles?.[0] || farmer.farm_profiles || null;
  const farmSize = Number(farm?.farm_size_acres || farm?.computed_area_acres || 0);
  const farmSizeHa = farmSize > 0 ? farmSize * ACRES_TO_HECTARES : 0;

  let production = { score: 0, yieldRatio: 0 };
  if (prod && prod.length > 0 && farmSizeHa > 0) {
    const p = prod[0];
    const seasonSize = Number(p.farm_size_acres || 0) * ACRES_TO_HECTARES || farmSizeHa;
    const actualPerHa = Number(p.actual_yield_tonnes) / seasonSize;
    const benchmark =
      Number(p.benchmark_yield_tonnes) ||
      (await lookupBenchmark(sb, { crop: p.crop, state: farmer.state, lga: farmer.lga, season: p.season })) ||
      0;
    production = computeProductionScore({ actualYield: actualPerHa, benchmarkYield: benchmark });
  }

  const { data: financing } = await sb
    .from('financing_requests')
    .select('id, loan_amount, due_date, status')
    .eq('farmer_id', farmerId)
    .in('status', ['disbursed', 'completed', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1);

  let repayment = { score: 0, components: { repaymentRate: 0, timeliness: 0, defaultHistory: 0 } };
  let hasActiveDefault = false;
  let cycleCount = 0;
  const isFirstCycle = !financing || financing.length === 0;

  if (!isFirstCycle) {
    const f = financing[0];
    const { data: repayments } = await sb
      .from('repayment_records')
      .select('amount_paid, payment_date, context_flag')
      .eq('financing_request_id', f.id)
      .eq('voided', false);

    const { data: prior } = await sb
      .from('financing_requests')
      .select('id, loan_amount, due_date')
      .eq('farmer_id', farmerId)
      .in('status', ['disbursed', 'completed']);

    cycleCount = (prior || []).length;
    const totalPaid = (repayments || []).reduce((s, r) => s + Number(r.amount_paid || 0), 0);
    const repaymentRatio = f.loan_amount > 0 ? totalPaid / f.loan_amount : 1;
    hasActiveDefault = f.due_date && new Date(f.due_date) < new Date() && repaymentRatio < 1.0;

    repayment = computeRepaymentScore({
      repayments: repayments || [],
      loanAmount: Number(f.loan_amount || 0),
      dueDate: f.due_date,
      priorDefaults: {
        active: hasActiveDefault,
        recoveredCleanCycles: Math.max(0, cycleCount - (hasActiveDefault ? 1 : 0)),
      },
    });
  }

  // Final = Yield (0-60) + Repayment (0-40). First cycle = Yield only.
  const finalScore = isFirstCycle
    ? truncateOneDecimal(production.score)
    : truncateOneDecimal(production.score + repayment.score);
  const tier = tierForScore(finalScore);

  const loan = computeRecommendedLoan({ farmSizeAcres: farmSize, tier, cycleCount, hasActiveDefault });

  const { error: upsertErr } = await sb.from('credit_scores').upsert(
    {
      farmer_id: farmerId,
      production_score: production.score, // 0-60
      repayment_score: repayment.score, // 0-40
      repayment_rate_score: repayment.components.repaymentRate, // 0-25
      timeliness_score: repayment.components.timeliness, // 0-10
      default_history_score: repayment.components.defaultHistory, // 0-5
      final_credit_score: finalScore,
      credit_tier: tier,
      cycle_count: cycleCount,
      is_first_cycle: isFirstCycle,
      has_active_default: hasActiveDefault,
      recommended_loan_min: loan.min,
      recommended_loan_max: loan.max,
      recommended_loan_reason: loan.reason,
      model_version: MODEL_VERSION,
      last_calculated_at: new Date().toISOString(),
    },
    { onConflict: 'farmer_id' }
  );
  if (upsertErr) throw upsertErr;

  await sb.from('farmers').update({ credit_score: finalScore, credit_tier: tier }).eq('id', farmerId);

  await sb.from('credit_score_history').insert({
    farmer_id: farmerId,
    cooperative_id: farmer.cooperative_id,
    final_score: finalScore,
    credit_tier: tier,
    component_scores: {
      yield: production.score,
      yieldRatio: production.yieldRatio,
      repayment: repayment.score,
      repaymentRate: repayment.components.repaymentRate,
      timeliness: repayment.components.timeliness,
      defaultHistory: repayment.components.defaultHistory,
      isFirstCycle,
      hasActiveDefault,
    },
    trigger_reason: triggerReason,
    model_version: MODEL_VERSION,
  });

  if (farmer.cooperative_id) {
    await recalculateCooperativeScore(farmer.cooperative_id);
  }

  return { farmerId, finalScore, tier, production, repayment, isFirstCycle, hasActiveDefault };
}

async function recalculateCooperativeScore(cooperativeId) {
  const sb = supabaseAdmin();

  const { data: farmers } = await sb.from('farmers').select('id').eq('cooperative_id', cooperativeId);

  if (!farmers || farmers.length === 0) {
    await sb.from('cooperative_credit_scores').upsert(
      {
        cooperative_id: cooperativeId,
        average_score: 0,
        cooperative_tier: 'D',
        total_farmers: 0,
        scored_farmers: 0,
        tier_a_count: 0,
        tier_b_count: 0,
        tier_c_count: 0,
        tier_d_count: 0,
        last_calculated_at: new Date().toISOString(),
      },
      { onConflict: 'cooperative_id' }
    );
    await sb
      .from('cooperatives')
      .update({ average_credit_score: 0, cooperative_tier: 'D', total_members: 0 })
      .eq('id', cooperativeId);
    return { cooperativeId, averageScore: 0, tier: 'D' };
  }

  const ids = farmers.map((f) => f.id);
  const { data: scores } = await sb
    .from('credit_scores')
    .select('farmer_id, final_credit_score, production_score, is_first_cycle, credit_tier')
    .in('farmer_id', ids);

  const counts = { A: 0, B: 0, C: 0, D: 0 };
  let sum = 0;
  let scored = 0;
  for (const s of scores || []) {
    // final_credit_score already reflects first-cycle (yield-only) logic.
    const v = Number(s.final_credit_score);
    sum += v;
    scored += 1;
    if (s.credit_tier) counts[s.credit_tier] = (counts[s.credit_tier] || 0) + 1;
  }
  const avg = scored > 0 ? truncateOneDecimal(sum / scored) : 0;
  const tier = tierForScore(avg);

  await sb.from('cooperative_credit_scores').upsert(
    {
      cooperative_id: cooperativeId,
      average_score: avg,
      cooperative_tier: tier,
      total_farmers: farmers.length,
      scored_farmers: scored,
      tier_a_count: counts.A,
      tier_b_count: counts.B,
      tier_c_count: counts.C,
      tier_d_count: counts.D,
      last_calculated_at: new Date().toISOString(),
    },
    { onConflict: 'cooperative_id' }
  );

  await sb
    .from('cooperatives')
    .update({ average_credit_score: avg, cooperative_tier: tier, total_members: farmers.length })
    .eq('id', cooperativeId);

  return { cooperativeId, averageScore: avg, tier, counts };
}

async function safeRecalculateFarmer(farmerId, opts) {
  try {
    return await recalculateFarmerScore(farmerId, opts);
  } catch (err) {
    logger.warn({ err: err.message, farmerId }, 'farmer score recalc failed');
    return null;
  }
}

async function safeRecalculateCooperative(cooperativeId) {
  try {
    return await recalculateCooperativeScore(cooperativeId);
  } catch (err) {
    logger.warn({ err: err.message, cooperativeId }, 'cooperative score recalc failed');
    return null;
  }
}

module.exports = {
  MODEL_VERSION,
  TIER_THRESHOLDS,
  tierForScore,
  computeProductionScore,
  computeRepaymentScore,
  computeRecommendedLoan,
  recalculateFarmerScore,
  recalculateCooperativeScore,
  safeRecalculateFarmer,
  safeRecalculateCooperative,
};
