'use strict';

/**
 * Heabron Credit Score Engine — v3.0
 *
 * Implements "Heabron Credit Score System — Technical Specification &
 * Methodology" v1.0. Two independent scores, each out of 100, averaged:
 *
 *   Production Score (0-100)   — can this farmer produce consistently?
 *     = min(actual_yield / benchmark_yield, 1.0) * 100
 *     Benchmark is set per crop, LGA and season from cooperative history plus
 *     extension data, so a farmer is measured against their own community
 *     rather than a national average.
 *
 *   Repayment Score (0-100)    — does this farmer honour obligations?
 *     Repayment Rate    0-60   = clamp(total_paid / principal, 0, 1) * 60
 *     Timeliness        0-25   = on time 25 | <=30d late 20 | >30d late 5
 *                                (context-flagged late -> not penalised)
 *                                (no assessable due date -> 0)
 *     Default History   0-15   = no defaults 15 | recovered 8 | active 0
 *
 *   Final Credit Score = (Production + Repayment) / 2, truncated to one
 *     decimal — truncated, not rounded, so a score cannot be inflated across a
 *     tier boundary (spec section 4).
 *
 *   Tiers: A 90-100 | B 85-89 | C 75-84 | D 0-74
 *
 *   First cycle (no disbursed/completed loan yet): Production only, capped at
 *     84 so a new borrower cannot reach Tier A or B limits before showing any
 *     repayment behaviour (spec section 7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v3.0 — replaces v2.1 (Yield 60 / Repayment 40, tiers A80/B65/C50), which
 * predated this specification. Scores and tiers MOVE on the first
 * recalculation after this ships; `model_version` distinguishes them in
 * `credit_score_history` so the two are never compared as like for like.
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
 *   • A negative or NaN yield escaped its band and the final score escaped
 *     0-100.
 *   • The cooperative average was computed from at most 1000 member rows and
 *     poisoned by a single NULL score.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { fetchAllRows } = require('../../utils/pagination');
const { chunk } = require('../../utils/profiles');
const { summarizeFarms } = require('../farms');
const logger = require('../../utils/logger');

const MODEL_VERSION = 'v3.0';

/**
 * Component weights, from the technical specification.
 *
 * Two independent scores, each out of 100, averaged into the final:
 *
 *   Production Score  = min(actual yield / benchmark yield, 1.0) x 100
 *   Repayment Score   = Repayment Rate (60) + Timeliness (25) + Defaults (15)
 *   Final             = (Production + Repayment) / 2
 */
const PRODUCTION_MAX = 100;
const REPAYMENT_MAX = 100;
const REPAY_RATE_MAX = 60;
const SCORE_MAX = 100;

/** Timeliness bands (spec 3.2B). */
const TIMELINESS_ON_TIME = 25;
const TIMELINESS_LATE_30 = 20;
const TIMELINESS_LATE_OVER_30 = 5;

/** Default-history levels (spec 3.2C). Three levels, so a recovered
 *  defaulter can rehabilitate rather than being marked for life. */
const DEFAULT_NONE = 15;
const DEFAULT_RECOVERED = 8;
const DEFAULT_ACTIVE = 0;
/** Clean cycles required after a default before the recovered score applies. */
const RECOVERY_CLEAN_CYCLES = 2;

/** Tier thresholds, inclusive lower bound (spec section 5). */
const TIER_THRESHOLDS = { A: 90, B: 85, C: 75 };

/**
 * First-cycle ceiling (spec section 7).
 *
 * A farmer with no repayment history is scored on production alone and held at
 * the top of Tier C until a repayment exists, so a first-cycle farmer cannot
 * reach Tier A or B limits before showing any repayment behaviour.
 */
const FIRST_CYCLE_SCORE_CAP = 84;

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
 * Production Score — points on the 0-100 scale (spec section 2).
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
  // The ratio is capped at 1.0: beating the benchmark does not score above
  // 100, so an over-performing season cannot offset a weak one (spec 2.2).
  const ratio = clamp(actual / benchmark, 0, 1);
  return {
    score: truncateOneDecimal(ratio * PRODUCTION_MAX),
    yieldRatio: Number(ratio.toFixed(4)),
  };
}

/**
 * Repayment Score — points on the 0-100 scale with the Rate/Time/Default
 * sub-breakdown the admin UI renders (Rate /60, Time /25, Default /15).
 */
function computeRepaymentScore({
  repayments = [],
  loanAmount = 0,
  dueDate,
  priorDefaults = { active: false, everDefaulted: false, cleanCyclesSinceDefault: 0 },
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
    let lastPaymentDate = null;
    for (const r of ordered) {
      const n = Number(r.amount_paid);
      if (Number.isFinite(n) && n > 0) {
        cumulative += n;
        lastPaymentDate = new Date(r.payment_date);
      }
      if (principal > 0 && cumulative >= principal) {
        payoffDate = new Date(r.payment_date);
        break;
      }
    }

    /**
     * Which date to measure against (spec 3.2B: "Did the farmer repay within
     * the agreed window?").
     *
     *   fully repaid        -> the date the balance was cleared
     *   partially repaid    -> the date of their most recent payment
     *   nothing paid at all -> today, so an overdue loan is penalised while it
     *                          is still overdue rather than only once it settles
     *
     * FIXED — this previously measured a partially repaid loan against TODAY,
     * which double-penalised the farmer. The specification's own worked
     * example (3.3) is a farmer who repaid 95% of a loan before the deadline
     * and scores the full 25/25 for timeliness: the 5% shortfall is already
     * reflected in the Repayment Rate component (57/60 rather than 60/60), and
     * charging it a second time on timeliness counts the same shortfall twice.
     * Under the old logic that farmer scored 5/25 and the engine disagreed with
     * the document it implements.
     *
     * Timeliness answers "did they pay when they said they would"; Rate
     * answers "how much did they pay". Keeping the two questions separate is
     * what stops one shortfall being charged twice.
     */
    if (!payoffDate) payoffDate = lastPaymentDate || new Date();

    const daysLate = Math.max(0, Math.floor((payoffDate - due) / MS_PER_DAY));
    if (daysLate <= 0) timeliness = TIMELINESS_ON_TIME;
    else if (daysLate <= 30) timeliness = TIMELINESS_LATE_30;
    else timeliness = TIMELINESS_LATE_OVER_30;
    timelinessBasis = daysLate <= 0 ? 'on_time' : daysLate <= 30 ? 'late_within_30d' : 'late_over_30d';

    // Context-flagged late repayments (weather event, market price collapse,
    // health emergency) are documented but NOT penalised the way an unexcused
    // delay is, so the model does not punish farmers for events outside their
    // control (spec 3.2B).
    const anyContext = repayments.some((r) => r.context_flag && r.context_flag !== 'none');
    if (anyContext && daysLate > 0) {
      timeliness = TIMELINESS_ON_TIME;
      timelinessBasis = 'late_context_excused';
    }
  }

  /**
   * Default history (spec 3.2C) — three levels, so a recovered defaulter can
   * rehabilitate rather than carrying the mark for life:
   *
   *   no defaults on record                       15
   *   recovered: 2+ clean cycles since the default  8
   *   active (unresolved) default                   0
   *
   * DATA LIMITATION — the middle level is implemented but cannot currently be
   * reached. Detecting "recovered" needs a recorded default history, and the
   * schema has nowhere to record one: `financing_status` is
   * pending|approved|rejected|disbursed|completed, with no defaulted state,
   * and nothing stamps the date a loan fell into default. So a farmer who
   * defaulted and recovered is indistinguishable from one who never defaulted,
   * and scores 15 rather than 8.
   *
   * The alternative — treating completed cycles as evidence of recovery —
   * would be worse: it would hand the 8-point "recovered defaulter" score to
   * every farmer who has simply finished two loans cleanly and never defaulted
   * at all, which understates them.
   *
   * To switch the middle level on, add a defaulted state (or a `defaulted_at`
   * stamp) to financing_requests and pass `everDefaulted` plus
   * `cleanCyclesSinceDefault` in. The branch below is ready for it.
   */
  const everDefaulted = Boolean(priorDefaults.everDefaulted) || Boolean(priorDefaults.active);
  let defaultHistory;
  let defaultHistoryBasis;

  if (priorDefaults.active) {
    defaultHistory = DEFAULT_ACTIVE;
    defaultHistoryBasis = 'active_default';
  } else if (!everDefaulted) {
    defaultHistory = DEFAULT_NONE;
    defaultHistoryBasis = 'no_defaults_on_record';
  } else if ((priorDefaults.cleanCyclesSinceDefault || 0) >= RECOVERY_CLEAN_CYCLES) {
    defaultHistory = DEFAULT_RECOVERED;
    defaultHistoryBasis = 'recovered';
  } else {
    // Defaulted before and not yet two clean cycles past it.
    defaultHistory = DEFAULT_ACTIVE;
    defaultHistoryBasis = 'recovering';
  }

  const total = truncateOneDecimal(clamp(repaymentRate + timeliness + defaultHistory, 0, REPAYMENT_MAX));
  return {
    score: total,
    components: { repaymentRate, timeliness, defaultHistory },
    timelinessBasis,
    defaultHistoryBasis,
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
    .select(
      'id, state, lga, cooperative_id, farm_profiles(id, farm_size_acres, computed_area_acres, is_primary, created_at)'
    )
    .eq('id', farmerId)
    .maybeSingle();
  if (ferr) throw ferr;
  if (!farmer) throw new Error('Farmer not found');

  const prodResult = await latestActualProduction(sb, farmerId);
  if (prodResult.error) throw prodResult.error;
  const prod = prodResult.production;

  // FIXED — this took `farm_profiles[0]`, one arbitrary plot, as the farmer's
  // land. A farmer with two farms had their whole season's output divided by
  // one farm's acreage, which inflated yield-per-hectare and so the
  // production score. The farmer's land is the SUM of their farms.
  //
  // This is only the fallback: a production record that carries its own
  // `farm_size_acres` (the land that season's yield actually came off) still
  // wins below, which is the more precise figure when the agent recorded it.
  const farmSize = summarizeFarms(farmer.farm_profiles).totalAcres;
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
      priorDefaults: {
        active: hasActiveDefault,
        // See the DATA LIMITATION note in computeRepaymentScore: there is no
        // recorded default history to read, so "recovered" is not detectable
        // yet and `cleanCyclesSinceDefault` is carried for when it is.
        everDefaulted: hasActiveDefault,
        cleanCyclesSinceDefault: recoveredCleanCycles,
      },
    });
  }

  /**
   * Final Credit Score = (Production + Repayment) / 2, each out of 100
   * (spec section 4). Both carry equal weight: a farmer must be able to
   * produce (capacity) and willing to repay (character).
   *
   * First cycle (spec section 7): no repayment behaviour exists to score, so
   * the score is Production alone, held at the top of Tier C until a first
   * repayment is recorded. That stops a brand-new borrower reaching Tier A or
   * B limits before showing any repayment behaviour at all.
   *
   * The outer clamp is defence-in-depth: every component is already bounded,
   * but a score outside 0-100 must never reach a lender's screen.
   */
  const rawFinal = isFirstCycle
    ? Math.min(production.score, FIRST_CYCLE_SCORE_CAP)
    : (production.score + repayment.score) / 2;
  const finalScore = truncateOneDecimal(clamp(rawFinal, 0, SCORE_MAX));
  const tier = tierForScore(finalScore);

  const loan = computeRecommendedLoan({ farmSizeAcres: farmSize, tier, cycleCount, hasActiveDefault });

  const { error: upsertErr } = await sb.from('credit_scores').upsert(
    {
      farmer_id: farmerId,
      production_score: production.score, // 0-100
      repayment_score: repayment.score, // 0-100
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
      .select('farmer_id, final_credit_score, production_score, is_first_cycle, credit_tier')
      .in('farmer_id', group);
    if (error) throw error;

    for (const s of scores || []) {
      /**
       * Spec section 7: a first-cycle member who has not yet completed a
       * repayment contributes their PRODUCTION score to the cooperative
       * average — not their final score, which is held at the Tier C ceiling
       * (84). Using the capped final would let a cohort of new members drag a
       * strong cooperative down toward 84, or flatter a weak one, before any
       * repayment data exists to justify either.
       */
      const useProduction = s.is_first_cycle === true;
      const raw = useProduction ? s.production_score : s.final_credit_score;

      // FIXED — `sum += Number(s.final_credit_score)` turned the whole average
      // into NaN if a single row had a NULL score, and NaN was then written to
      // `cooperatives.average_credit_score` and rendered to lenders.
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      sum += v;
      scored += 1;
      if (s.credit_tier && counts[s.credit_tier] !== undefined) counts[s.credit_tier] += 1;
    }
  }

  /**
   * Cooperative Average Score = sum of contributing member scores / number of
   * contributing members (spec 6.1).
   *
   * AMBIGUITY, resolved deliberately: the formula line reads "divided by Total
   * number of farmers in cooperative", but the sentence after it says only
   * members who have a score contribute, and the worked example has every
   * member scored, so it does not settle the case. Dividing by TOTAL would mean
   * that simply registering a farmer — before any yield data exists for them —
   * instantly drags the cooperative's tier down, which would penalise
   * cooperatives for growing. So the divisor is the number of contributing
   * members, and `total_farmers` / `scored_farmers` are both stored alongside
   * so the difference is visible rather than hidden inside the average.
   */
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
