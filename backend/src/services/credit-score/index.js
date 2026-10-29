'use strict';

/**
 * Heabron Credit Score Engine — v2.1  (Yield 60 / Repayment 40)
 *
 *   Final Credit Score = Yield Performance (0-60) + Repayment (0-40)
 *
 *   Yield Performance (0-60)
 *     = clamp(actual_yield_per_ha / benchmark_yield_per_ha, 0, 1) * 60
 *
 *   Repayment (0-40), broken down exactly as the admin UI shows it:
 *     Repayment Rate     0-25   = clamp(total_paid / principal, 0, 1) * 25
 *     Timeliness         0-10   = on-time 10 | <=30d late 8 | >30d late 2
 *                                 (context-flagged late = not penalised -> 10)
 *                                 (no assessable due date -> 0, see below)
 *     Default History    0-5    = no defaults 5 | recovered>=2 cycles 5
 *                                 | recovered 1 cycle 3 | active default 0
 *
 *   First cycle (no disbursed/completed loan yet): score = Yield only.
 *     A farmer can therefore reach at most 60 (Tier C/"Risk") on yield alone;
 *     Tiers B and A require a proven repayment record.
 *
 *   Tier bands — adopted to match the live grade display (100->A, 65->B,
 *   60->C "Risk", 40/46->D "High Risk"). Tune TIER_THRESHOLDS in one place if
 *   the team wants the older spec bands (A90/B85/C75) back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v2.1 — audit corrections. Each is marked `FIXED —` at the site.
 *   • Every Supabase error was discarded. A failed production lookup, benchmark
 *     lookup, history insert or farmers update was indistinguishable from "this
 *     farmer has no data", so a transient fault wrote a 0 score to a real
 *     farmer and reported success.
 *   • A merely *approved* (not disbursed) loan ended the first cycle and handed
 *     the farmer 15 unearned repayment points, contradicting the rule
 *     documented above.
 *   • Timeliness and default history defaulted to full marks on no evidence.
 *   • The repayment rate was measured against `loan_amount` (what was asked
 *     for) rather than what was actually approved/disbursed.
 *   • A negative or NaN yield escaped the 0-60 band and the final score escaped
 *     0-100.
 *   • The cooperative average was computed from at most 1000 member rows and
 *     poisoned by a single NULL score.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { fetchAllRows } = require('../../utils/pagination');
const { chunk } = require('../../utils/profiles');
const logger = require('../../utils/logger');

const MODEL_VERSION = 'v2.1';

// Component weights (kept as named constants so the model is auditable).
const YIELD_MAX = 60;
const REPAYMENT_MAX = 40;
const REPAY_RATE_MAX = 25;
const REPAY_TIMELINESS_MAX = 10;
const REPAY_DEFAULT_MAX = 5;
const SCORE_MAX = YIELD_MAX + REPAYMENT_MAX; // 100

// Tier thresholds (inclusive lower bound). Evidence-based from the live UI.
//   Spec-original alternative: A:90, B:85, C:75  (swap if preferred)
const TIER_THRESHOLDS = { A: 80, B: 65, C: 50 };

const ACRES_TO_HECTARES = 0.404686;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** A loan cycle only counts once the money has actually moved. */
const CYCLE_STATUSES = ['disbursed', 'completed'];

function tierForScore(score) {
  if (score >= TIER_THRESHOLDS.A) return 'A';
  if (score >= TIER_THRESHOLDS.B) return 'B';
  if (score >= TIER_THRESHOLDS.C) return 'C';
  return 'D';
}

function truncateOneDecimal(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n * 10) / 10;
}

/** Clamp to [lo, hi], mapping NaN/Infinity to lo rather than letting it spread. */
function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/**
 * The principal a loan should be measured against.
 *
 * FIXED — the repayment rate divided by `loan_amount`, the amount the agent
 * ASKED for. If an admin approved ₦200k against a ₦500k request, a farmer who
 * repaid every naira scored 10/25 instead of 25/25 and was pushed a tier down.
 * `financing.controller` and `farmers.getFinancingHistory` each had their own
 * (different) idea of the principal; this is now the single definition, used
 * by all three.
 *
 * Order: what was handed over, else what was approved, else what was asked.
 * `0` and `null` both mean "not set" — no loan is legitimately zero.
 */
function loanPrincipal(financing) {
  if (!financing) return 0;
  for (const key of ['disbursed_amount', 'approved_amount', 'loan_amount']) {
    const n = Number(financing[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * The date a loan became overdue.
 *
 * FIXED — timeliness was awarded the full 10 points whenever `due_date` was
 * NULL, which is the common case (the admin decision schema makes `dueDate`
 * optional). A farmer with a disbursed loan, zero repayments and no due date
 * collected 0 + 10 + 5 = 15 points for nothing. Where the due date is missing
 * we now derive it from the disbursement date plus the repayment window that
 * the request already carries, and only fall back to "unassessable" when
 * neither exists.
 */
function effectiveDueDate(financing) {
  if (!financing) return null;
  if (financing.due_date) {
    const d = new Date(financing.due_date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (financing.disbursed_at) {
    const start = new Date(financing.disbursed_at);
    const days = Number(financing.repayment_window_days);
    if (!Number.isNaN(start.getTime()) && Number.isFinite(days) && days > 0) {
      return new Date(start.getTime() + days * MS_PER_DAY);
    }
  }
  return null;
}

/**
 * Yield Performance — returns points on the 0-60 scale.
 * (Field name `score` is retained for backwards compatibility with callers.)
 */
function computeProductionScore({ actualYield, benchmarkYield }) {
  const actual = Number(actualYield);
  const benchmark = Number(benchmarkYield);
  // FIXED — a non-finite or negative actual yield used to pass straight into
  // `Math.min(actual / benchmark, 1)`, which happily returns a NEGATIVE ratio.
  // That produced a negative production score, a final score below 0, and a
  // tier of 'D' that looked like a real assessment.
  if (!Number.isFinite(actual) || !Number.isFinite(benchmark) || benchmark <= 0 || actual <= 0) {
    return { score: 0, yieldRatio: 0 };
  }
  const ratio = clamp(actual / benchmark, 0, 1);
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
  const principal = Number(loanAmount) > 0 ? Number(loanAmount) : 0;
  const totalPaid = repayments.reduce((s, r) => {
    const n = Number(r.amount_paid);
    // A negative or non-numeric amount_paid would otherwise drag the rate
    // below zero (or NaN it) and take the whole score with it.
    return Number.isFinite(n) && n > 0 ? s + n : s;
  }, 0);
  const rate = principal > 0 ? clamp(totalPaid / principal, 0, 1) : 0;
  const repaymentRate = truncateOneDecimal(rate * REPAY_RATE_MAX);

  // FIXED — was `let timeliness = REPAY_TIMELINESS_MAX`, i.e. full marks for
  // an unassessable loan. No due date and no proof of payment is not evidence
  // of punctuality, so it scores 0 and the reason is reported to the caller.
  let timeliness = 0;
  let timelinessBasis = 'no_due_date';

  const due = dueDate ? new Date(dueDate) : null;
  if (due && !Number.isNaN(due.getTime())) {
    let payoffDate = null;
    let cumulative = 0;
    const ordered = repayments
      .filter((r) => r.payment_date)
      .slice()
      .sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date));
    for (const r of ordered) {
      const n = Number(r.amount_paid);
      if (Number.isFinite(n) && n > 0) cumulative += n;
      if (principal > 0 && cumulative >= principal) {
        payoffDate = new Date(r.payment_date);
        break;
      }
    }
    // Not yet paid off: measure against today, so an overdue loan is penalised
    // while it is still overdue rather than only after it settles.
    if (!payoffDate) payoffDate = new Date();

    const daysLate = Math.max(0, Math.floor((payoffDate - due) / MS_PER_DAY));
    if (daysLate <= 0) timeliness = REPAY_TIMELINESS_MAX;
    else if (daysLate <= 30) timeliness = 8;
    else timeliness = 2;
    timelinessBasis = daysLate <= 0 ? 'on_time' : daysLate <= 30 ? 'late_within_30d' : 'late_over_30d';

    // Context-flagged late repayments (weather / market / health) are
    // documented but NOT penalised — per spec section 3.2B.
    const anyContext = repayments.some((r) => r.context_flag && r.context_flag !== 'none');
    if (anyContext && daysLate > 0) {
      timeliness = REPAY_TIMELINESS_MAX;
      timelinessBasis = 'late_context_excused';
    }
  }

  // FIXED — default history also started at full marks. A farmer with no
  // repayment record at all is not a farmer with a clean record; 5/5 is only
  // awarded where there is a completed cycle to vouch for it.
  let defaultHistory;
  if (priorDefaults.active) defaultHistory = 0;
  else if (priorDefaults.recoveredCleanCycles >= 2) defaultHistory = REPAY_DEFAULT_MAX;
  else if (priorDefaults.recoveredCleanCycles >= 1) defaultHistory = 3;
  else defaultHistory = 0;

  const total = truncateOneDecimal(clamp(repaymentRate + timeliness + defaultHistory, 0, REPAYMENT_MAX));
  return {
    score: total,
    components: { repaymentRate, timeliness, defaultHistory },
    timelinessBasis,
    totalPaid: Math.round(totalPaid * 100) / 100,
  };
}

/**
 * Recommended loan limit — tunable heuristic for the financing summary card.
 * Scales with farm capacity, tier, and proven cycles.
 *
 * NOTE: PER_ACRE is a business constant, not measured data. It is named and
 * kept in one place so the team can tune it; it is NOT derived from anything
 * in the database, and the UI should present the range as indicative.
 */
const PER_ACRE_NGN = 35000;

function computeRecommendedLoan({ farmSizeAcres = 0, tier = 'D', cycleCount = 0, hasActiveDefault = false }) {
  const acres = Number(farmSizeAcres);
  if (hasActiveDefault || !Number.isFinite(acres) || acres <= 0) {
    return {
      min: 0,
      max: 0,
      reason: hasActiveDefault ? 'Active default — new financing on hold' : 'Insufficient farm data',
    };
  }
  const tierMult = { A: 1.0, B: 0.85, C: 0.6, D: 0.35 }[tier] || 0.35;
  const cycleMult = Math.min(1 + cycleCount * 0.15, 1.6); // grows with repayment track record
  const base = acres * PER_ACRE_NGN * tierMult * cycleMult;
  const min = Math.round((base * 0.8) / 1000) * 1000;
  const max = Math.round(base / 1000) * 1000;
  const reason =
    cycleCount > 0
      ? `Based on ${cycleCount}-cycle repayment history + ${acres} acre yield capacity`
      : `Based on ${acres} acre yield capacity (no repayment history yet)`;
  return { min, max, reason };
}

/**
 * Resolve a regional yield benchmark, narrowest match first.
 *
 * FIXED — two bugs.
 *  1. `const { data } = await q` discarded the error. A renamed column or an
 *     RLS change meant "no benchmark found" for every crop in the country, and
 *     every farmer's production score silently became 0. The error is now
 *     logged and aborts the lookup instead of being read as "no match".
 *  2. The broader attempts simply omitted the `lga`/`season` filters, so
 *     `{crop, state}` matched ANY lga row and `.limit(1)` picked an arbitrary
 *     one with no ORDER BY — the same farmer could score differently between
 *     two runs. Each attempt is now ordered so the most general row wins
 *     deterministically.
 */
async function lookupBenchmark(sb, { crop, state, lga, season }) {
  if (!crop) return null;
  const attempts = [
    { crop, state, lga, season },
    { crop, state, lga },
    { crop, state },
    { crop, state: 'default' }, // documented catch-all row convention
  ];

  for (const t of attempts) {
    if (t.state === undefined || t.state === null) continue;
    let q = sb
      .from('regional_benchmarks')
      .select('benchmark_yield_tonnes_per_hectare, lga, season')
      .eq('crop', t.crop)
      .eq('state', t.state);
    if (t.lga !== undefined && t.lga !== null) q = q.eq('lga', t.lga);
    if (t.season !== undefined && t.season !== null) q = q.eq('season', t.season);

    const { data, error } = await q
      .order('lga', { ascending: true, nullsFirst: true })
      .order('season', { ascending: true, nullsFirst: true })
      .limit(1);

    if (error) {
      logger.error(
        { err: error.message, code: error.code, hint: error.hint, crop: t.crop, state: t.state },
        'regional_benchmarks lookup failed — production score cannot be computed'
      );
      return null;
    }
    const value = Number(data?.[0]?.benchmark_yield_tonnes_per_hectare);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/** Most recent production row carrying an actual yield, verified if possible. */
async function latestActualProduction(sb, farmerId) {
  const base = (verifiedOnly) => {
    let q = sb
      .from('seasonal_productions')
      .select('crop, season, farm_size_acres, actual_yield_tonnes, benchmark_yield_tonnes, verification_status')
      .eq('farmer_id', farmerId)
      .not('actual_yield_tonnes', 'is', null);
    if (verifiedOnly) q = q.eq('verification_status', 'verified');
    return q.order('expected_harvest_date', { ascending: false, nullsFirst: false }).limit(1);
  };

  // Prefer a VERIFIED actual-yield record (the yield-verification module is
  // the primary source); fall back to any record with an actual yield.
  // FIXED — both queries discarded their error, so a failed lookup scored the
  // farmer 0 on yield and recorded that as a real assessment.
  const verified = await base(true);
  if (verified.error) {
    logger.error({ err: verified.error.message, code: verified.error.code, farmerId }, 'verified production lookup failed');
    return { error: verified.error };
  }
  if (verified.data?.length) return { production: verified.data[0], verified: true };

  const any = await base(false);
  if (any.error) {
    logger.error({ err: any.error.message, code: any.error.code, farmerId }, 'production lookup failed');
    return { error: any.error };
  }
  return { production: any.data?.[0] || null, verified: false };
}

async function recalculateFarmerScore(farmerId, { triggerReason = 'manual' } = {}) {
  const sb = supabaseAdmin();

  const { data: farmer, error: ferr } = await sb
    .from('farmers')
    .select('id, state, lga, cooperative_id, farm_profiles(farm_size_acres, computed_area_acres)')
    .eq('id', farmerId)
    .maybeSingle();
  if (ferr) throw ferr;
  if (!farmer) throw new Error('Farmer not found');

  const prodResult = await latestActualProduction(sb, farmerId);
  if (prodResult.error) throw prodResult.error;
  const prod = prodResult.production;

  const farm = farmer.farm_profiles?.[0] || farmer.farm_profiles || null;
  const farmSize = Number(farm?.farm_size_acres || farm?.computed_area_acres || 0);
  const farmSizeHa = Number.isFinite(farmSize) && farmSize > 0 ? farmSize * ACRES_TO_HECTARES : 0;

  let production = { score: 0, yieldRatio: 0 };
  let benchmarkUsed = null;
  if (prod && farmSizeHa > 0) {
    const seasonAcres = Number(prod.farm_size_acres);
    const seasonSizeHa =
      Number.isFinite(seasonAcres) && seasonAcres > 0 ? seasonAcres * ACRES_TO_HECTARES : farmSizeHa;
    const actualPerHa = Number(prod.actual_yield_tonnes) / seasonSizeHa;

    const rowBenchmark = Number(prod.benchmark_yield_tonnes);
    benchmarkUsed =
      Number.isFinite(rowBenchmark) && rowBenchmark > 0
        ? rowBenchmark
        : await lookupBenchmark(sb, {
            crop: prod.crop,
            state: farmer.state,
            lga: farmer.lga,
            season: prod.season,
          });

    production = computeProductionScore({ actualYield: actualPerHa, benchmarkYield: benchmarkUsed });
  }

  // FIXED — this query included `'approved'`, so a request an admin had merely
  // approved (no money moved, no due date, no repayments possible) ended the
  // farmer's first cycle. The farmer immediately banked the unearned
  // timeliness + default-history points, which is exactly the "an unscored
  // farmer looks good" failure. The documented rule is "no disbursed/completed
  // loan yet", and that is now what the query asks for.
  const { data: financingRows, error: finErr } = await sb
    .from('financing_requests')
    .select('id, loan_amount, approved_amount, disbursed_amount, due_date, disbursed_at, repayment_window_days, status')
    .eq('farmer_id', farmerId)
    .in('status', CYCLE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(50);
  if (finErr) throw finErr;

  const financing = financingRows || [];
  const isFirstCycle = financing.length === 0;

  let repayment = {
    score: 0,
    components: { repaymentRate: 0, timeliness: 0, defaultHistory: 0 },
    timelinessBasis: 'no_cycle',
  };
  let hasActiveDefault = false;
  let cycleCount = 0;

  if (!isFirstCycle) {
    const current = financing[0];
    cycleCount = financing.length;

    const { data: repayments, error: repErr } = await sb
      .from('repayment_records')
      .select('amount_paid, payment_date, context_flag')
      .eq('financing_request_id', current.id)
      .eq('voided', false)
      .limit(1000);
    if (repErr) throw repErr;

    const principal = loanPrincipal(current);
    const due = effectiveDueDate(current);
    const totalPaid = (repayments || []).reduce((s, r) => {
      const n = Number(r.amount_paid);
      return Number.isFinite(n) && n > 0 ? s + n : s;
    }, 0);
    const repaymentRatio = principal > 0 ? totalPaid / principal : 0;
    hasActiveDefault = Boolean(due) && due < new Date() && repaymentRatio < 1;

    // Cycles that are both finished and clean. The current cycle only counts
    // once it is marked completed, so an in-flight loan can't vouch for itself.
    const recoveredCleanCycles = financing.filter(
      (f) => f.status === 'completed' && f.id !== current.id
    ).length + (current.status === 'completed' && !hasActiveDefault ? 1 : 0);

    repayment = computeRepaymentScore({
      repayments: repayments || [],
      loanAmount: principal,
      dueDate: due ? due.toISOString() : null,
      priorDefaults: { active: hasActiveDefault, recoveredCleanCycles },
    });
  }

  // Final = Yield (0-60) + Repayment (0-40). First cycle = Yield only.
  // The outer clamp is defence-in-depth: every component is already bounded,
  // but a score outside 0-100 must never reach a lender's screen.
  const rawFinal = isFirstCycle ? production.score : production.score + repayment.score;
  const finalScore = truncateOneDecimal(clamp(rawFinal, 0, SCORE_MAX));
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

  // FIXED — these two writes discarded their errors. The denormalised columns
  // on `farmers` are what every list screen and the partner directory read, so
  // a failure here left the lists showing a stale score indefinitely while
  // `credit_scores` held the new one, with nothing logged.
  const { error: denormErr } = await sb
    .from('farmers')
    .update({ credit_score: finalScore, credit_tier: tier })
    .eq('id', farmerId);
  if (denormErr) {
    logger.error(
      { err: denormErr.message, code: denormErr.code, farmerId },
      'farmers.credit_score denormalisation failed — list views will show a stale score'
    );
  }

  const { error: histErr } = await sb.from('credit_score_history').insert({
    farmer_id: farmerId,
    cooperative_id: farmer.cooperative_id,
    final_score: finalScore,
    credit_tier: tier,
    component_scores: {
      yield: production.score,
      yieldRatio: production.yieldRatio,
      benchmarkUsed,
      repayment: repayment.score,
      repaymentRate: repayment.components.repaymentRate,
      timeliness: repayment.components.timeliness,
      timelinessBasis: repayment.timelinessBasis,
      defaultHistory: repayment.components.defaultHistory,
      isFirstCycle,
      hasActiveDefault,
    },
    trigger_reason: triggerReason,
    model_version: MODEL_VERSION,
  });
  if (histErr) {
    logger.error({ err: histErr.message, code: histErr.code, farmerId }, 'credit_score_history insert failed');
  }

  if (farmer.cooperative_id) {
    await recalculateCooperativeScore(farmer.cooperative_id);
  }

  return { farmerId, finalScore, tier, production, repayment, isFirstCycle, hasActiveDefault };
}

async function recalculateCooperativeScore(cooperativeId) {
  const sb = supabaseAdmin();

  // FIXED — `select('id').eq('cooperative_id', ...)` with no range is capped
  // at PostgREST's db-max-rows (1000) and returns the truncated list with NO
  // error, so a large cooperative's average was computed from an arbitrary
  // subset. The error was discarded too, which read as "this cooperative has
  // no members" and wrote a 0 average over a real score.
  const { rows: farmers, error: farmersErr } = await fetchAllRows(() =>
    sb.from('farmers').select('id').eq('cooperative_id', cooperativeId)
  );
  if (farmersErr) throw farmersErr;

  const emptyRollup = {
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
  };

  if (farmers.length === 0) {
    const { error: upErr } = await sb
      .from('cooperative_credit_scores')
      .upsert(emptyRollup, { onConflict: 'cooperative_id' });
    if (upErr) throw upErr;
    const { error: coopErr } = await sb
      .from('cooperatives')
      .update({ average_credit_score: 0, cooperative_tier: 'D', total_members: 0 })
      .eq('id', cooperativeId);
    if (coopErr) throw coopErr;
    return { cooperativeId, averageScore: 0, tier: 'D', counts: { A: 0, B: 0, C: 0, D: 0 } };
  }

  const ids = farmers.map((f) => f.id);
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  let sum = 0;
  let scored = 0;

  // Chunked: a 3000-member cooperative would otherwise build an `in(...)` list
  // long enough for PostgREST to reject the request URL outright.
  for (const group of chunk(ids)) {
    const { data: scores, error } = await sb
      .from('credit_scores')
      .select('farmer_id, final_credit_score, credit_tier')
      .in('farmer_id', group);
    if (error) throw error;

    for (const s of scores || []) {
      // FIXED — `sum += Number(s.final_credit_score)` turned the whole average
      // into NaN if a single row had a NULL score, and NaN was then written to
      // `cooperatives.average_credit_score` and rendered to lenders.
      const v = Number(s.final_credit_score);
      if (!Number.isFinite(v)) continue;
      sum += v;
      scored += 1;
      if (s.credit_tier && counts[s.credit_tier] !== undefined) counts[s.credit_tier] += 1;
    }
  }

  const avg = scored > 0 ? truncateOneDecimal(clamp(sum / scored, 0, SCORE_MAX)) : 0;
  const tier = tierForScore(avg);

  const { error: upErr } = await sb.from('cooperative_credit_scores').upsert(
    {
      ...emptyRollup,
      average_score: avg,
      cooperative_tier: tier,
      total_farmers: farmers.length,
      scored_farmers: scored,
      tier_a_count: counts.A,
      tier_b_count: counts.B,
      tier_c_count: counts.C,
      tier_d_count: counts.D,
    },
    { onConflict: 'cooperative_id' }
  );
  if (upErr) throw upErr;

  const { error: coopErr } = await sb
    .from('cooperatives')
    .update({ average_credit_score: avg, cooperative_tier: tier, total_members: farmers.length })
    .eq('id', cooperativeId);
  if (coopErr) throw coopErr;

  return { cooperativeId, averageScore: avg, tier, counts };
}

/**
 * Non-throwing wrappers.
 *
 * IMPORTANT — these return a promise and MUST be awaited. They were being
 * called without `await` from nine controllers; on Vercel the lambda is frozen
 * the moment the response is written, so the recalculation was killed
 * mid-query and credit scores silently stopped updating in production. The
 * point of `safe*` is that the caller can await it without a failure breaking
 * the request, not that the caller can forget about it.
 */
async function safeRecalculateFarmer(farmerId, opts) {
  try {
    return await recalculateFarmerScore(farmerId, opts);
  } catch (err) {
    logger.warn({ err: err.message, code: err.code, farmerId }, 'farmer score recalc failed');
    return null;
  }
}

async function safeRecalculateCooperative(cooperativeId) {
  try {
    return await recalculateCooperativeScore(cooperativeId);
  } catch (err) {
    logger.warn({ err: err.message, code: err.code, cooperativeId }, 'cooperative score recalc failed');
    return null;
  }
}

/** Recalculate a bounded batch of farmers sequentially (bulk import, etc). */
async function safeRecalculateMany(farmerIds, opts, { max = 500 } = {}) {
  const unique = [...new Set((farmerIds || []).filter(Boolean))].slice(0, max);
  const results = [];
  for (const id of unique) {
    results.push(await safeRecalculateFarmer(id, opts));
  }
  return results;
}

module.exports = {
  MODEL_VERSION,
  TIER_THRESHOLDS,
  SCORE_MAX,
  tierForScore,
  loanPrincipal,
  effectiveDueDate,
  computeProductionScore,
  computeRepaymentScore,
  computeRecommendedLoan,
  recalculateFarmerScore,
  recalculateCooperativeScore,
  safeRecalculateFarmer,
  safeRecalculateCooperative,
  safeRecalculateMany,
};
