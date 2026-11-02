'use strict';

/**
 * Farmer and cooperative credit report — the lender-facing document.
 *
 * Layout and sections follow "CoopScore Farmer Credit Report (2-page lender
 * version)". The NUMBERS come from the scoring engine in
 * services/credit-score, which implements "Heabron Credit Score System —
 * Technical Specification & Methodology" v1.0.
 *
 * Where the two documents disagree, scoring wins:
 *
 *   - The report sample shows four pillars (Production 40 / Market 40 /
 *     Resilience 20) and bands A 80-100 / B 65-79 / C 50-64 / D below 50.
 *   - The authoritative model has two components (Production 50% / Repayment
 *     50%) and tiers A 90-100 / B 85-89 / C 75-84 / D 0-74.
 *
 * So the pillar table reports Production and Repayment, and the band comes
 * from the engine's tiers. The sample's "69 = Band B: Good" is Tier D under
 * the real model — a difference worth knowing about before a lender reads it.
 *
 * This module builds the DATA. Rendering to PDF happens in the clients, which
 * both consume the same payload so a farmer's report reads identically in the
 * app and in the dashboards.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { loanPrincipal, tierForScore, MODEL_VERSION } = require('../credit-score');
const { summarizeFarms, farmAcres, farmLabel } = require('../farms');

/** How long a report is presented as current (spec: issued + 3 months). */
const VALIDITY_DAYS = 91;

/** Tier labels as the lender report prints them. */
const TIER_LABELS = {
  A: 'Excellent',
  B: 'Good',
  C: 'Moderate',
  D: 'At risk',
};

/**
 * What each tier means for a lending decision, from the scoring
 * specification's tier table (section 5).
 */
const TIER_GUIDANCE = {
  A: 'Maximum loan eligible. Minimal monitoring. Insurance-eligible, preferred offtake priority.',
  B: 'Standard loan eligible. Routine monitoring. Full cycle participation.',
  C: 'Reduced loan limit. Enhanced monitoring. Field agent visit at mid-season required.',
  D: 'Restricted or no new loan. Mandatory field agent intervention. Excluded from next cycle pending review.',
};

/**
 * Masks a phone number for a partner-facing document: `+234 705 *** 3777`.
 *
 * The PRD forbids raw NIN and BVN in partner views entirely, and a phone
 * number is enough to identify and contact someone, so the middle is removed
 * while leaving enough for an agent to confirm they have the right person.
 */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.length < 7) return null;
  const head = digits.slice(0, digits.length - 7);
  const tail = digits.slice(-4);
  return `${head} *** ${tail}`.trim();
}

/** `CS-BEN-OJU-0001-20261029` */
function buildReportId({ state, lga, sequence, issuedAt }) {
  const part = (v, n) =>
    String(v || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, n)
      .padEnd(n, 'X');
  const date = new Date(issuedAt).toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(sequence || 1).padStart(4, '0');
  return `CS-${part(state, 3)}-${part(lga, 3)}-${seq}-${date}`;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The eight data-verification checks (report section 7).
 *
 * Scoring: Pass = 1, Partial = 0.5, Flag or Missing = 0. A flag means the
 * record must be confirmed before a lender relies on it — it is NOT a finding
 * against the farmer, and the report says so in those words.
 */
function buildVerificationChecks({ farmer, farmProfile, farms = [], landAcres, productions, deliveries }) {
  const checks = [];
  const add = (id, label, result, detail) => checks.push({ id, label, result, detail });

  // 1 — identity and phone on file
  add(
    1,
    'Identity and phone on file',
    farmer.full_name && farmer.phone ? 'pass' : 'missing',
    farmer.phone ? null : 'No phone number recorded',
  );

  // 2 — date of birth plausible
  const dob = farmer.date_of_birth ? new Date(farmer.date_of_birth) : null;
  const created = farmer.created_at ? new Date(farmer.created_at) : null;
  let dobResult = 'missing';
  let dobDetail = 'No date of birth recorded';
  if (dob && !Number.isNaN(dob.getTime())) {
    const sameDayAsRegistration =
      created && Math.abs(dob.getTime() - created.getTime()) < 36 * 60 * 60 * 1000;
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (sameDayAsRegistration) {
      dobResult = 'flag';
      dobDetail = 'Set to the registration date, so it is unlikely to be real';
    } else if (age < 16 || age > 100) {
      dobResult = 'flag';
      dobDetail = `Implied age ${Math.round(age)} is outside a plausible range`;
    } else {
      dobResult = 'pass';
      dobDetail = null;
    }
  }
  add(2, 'Date of birth valid', dobResult, dobDetail);

  // 3 — address and GPS
  //
  // FIXED — this read `gps_latitude` / `gps_longitude`. Those columns do not
  // exist; `farm_profiles` has `gps_lat` / `gps_lng`. Both were therefore
  // always `undefined`, so `hasGps` was always false and check 3 scored
  // "partial" at best for every farmer in the system, however carefully the
  // agent had mapped the farm. Check 3 is worth 1 of 8 verification points,
  // so every report understated its own verification score.
  //
  // Across a farm SET, GPS counts when any farm is located: a farmer with
  // three plots and one mapped is partially located, which the detail line
  // says rather than the check silently passing.
  const locatedFarms = farms.filter((f) => f.gps_lat != null && f.gps_lng != null);
  const hasGps = locatedFarms.length > 0;
  const allLocated = hasGps && locatedFarms.length === farms.length;
  let gpsDetail = null;
  if (!hasGps) gpsDetail = 'No farm GPS recorded';
  else if (!allLocated) {
    gpsDetail = `${locatedFarms.length} of ${farms.length} farms have GPS recorded`;
  }
  add(
    3,
    'Address and GPS location',
    allLocated && farmer.address ? 'pass' : hasGps || farmer.address ? 'partial' : 'missing',
    gpsDetail,
  );

  // 4 — actual yield recorded for every season
  const withActual = productions.filter((p) => p.actual_yield_tonnes != null).length;
  add(
    4,
    'Actual yield for every season',
    productions.length === 0
      ? 'missing'
      : withActual === productions.length
        ? 'pass'
        : 'partial',
    productions.length ? `${withActual} of ${productions.length} seasons` : 'No seasons recorded',
  );

  // 5 — deliveries reconcile with recorded yield
  const totalActualKg = productions.reduce((s, p) => s + num(p.actual_yield_tonnes) * 1000, 0);
  const totalDeliveredKg = deliveries.reduce((s, d) => s + num(d.quantity_kg), 0);
  let deliveryResult = 'missing';
  let deliveryDetail = 'No deliveries recorded';
  if (deliveries.length > 0 && totalActualKg > 0) {
    const ratio = totalDeliveredKg / totalActualKg;
    if (ratio > 1.05) {
      deliveryResult = 'flag';
      deliveryDetail = `Delivered ${Math.round(ratio * 100)}% of recorded yield`;
    } else {
      deliveryResult = 'pass';
      deliveryDetail = `${Math.round(ratio * 100)}% of recorded yield`;
    }
  } else if (deliveries.length > 0) {
    deliveryResult = 'partial';
    deliveryDetail = 'Deliveries recorded but no yield to compare against';
  }
  add(5, 'Deliveries reconcile with yield', deliveryResult, deliveryDetail);

  // 6 — delivery dates fall inside a harvest window
  let windowResult = 'missing';
  let windowDetail = 'No deliveries recorded';
  if (deliveries.length > 0) {
    const harvestDates = productions
      .map((p) => p.expected_harvest_date && new Date(p.expected_harvest_date))
      .filter((d) => d && !Number.isNaN(d.getTime()));
    if (harvestDates.length === 0) {
      windowResult = 'partial';
      windowDetail = 'No expected harvest dates to compare against';
    } else {
      const earliest = new Date(Math.min(...harvestDates.map((d) => d.getTime())));
      // A delivery before the earliest expected harvest cannot be that harvest.
      const before = deliveries.filter(
        (d) => d.date_delivered && new Date(d.date_delivered) < earliest,
      ).length;
      windowResult = before === 0 ? 'pass' : 'flag';
      windowDetail =
        before === 0
          ? 'All deliveries fall after the earliest expected harvest'
          : `${before} of ${deliveries.length} precede the earliest expected harvest`;
    }
  }
  add(6, 'Delivery dates inside harvest window', windowResult, windowDetail);

  // 7 — yield per acre plausible
  //
  // Across all of the farmer's farms, not one of them: dividing a whole
  // season's output by a single plot's acreage made a legitimate two-farm
  // farmer look like a data-entry error.
  const acres = landAcres != null ? num(landAcres) : num(farmProfile?.farm_size_acres);
  let plausibilityResult = 'missing';
  let plausibilityDetail = 'No farm size recorded';
  if (acres > 0 && withActual > 0) {
    const perAcreKg = totalActualKg / withActual / acres;
    // Deliberately wide: this flags data-entry errors (a decimal in the wrong
    // place), not genuinely good or poor farming.
    if (perAcreKg < 50 || perAcreKg > 20000) {
      plausibilityResult = 'flag';
      plausibilityDetail = `About ${Math.round(perAcreKg)} kg per acre per season`;
    } else {
      plausibilityResult = 'pass';
      plausibilityDetail = `About ${Math.round(perAcreKg)} kg per acre per season`;
    }
  }
  add(7, 'Yield per acre plausible', plausibilityResult, plausibilityDetail);

  // 8 — delivery payments confirmed
  const paid = deliveries.filter((d) => d.payment_status === 'paid').length;
  add(
    8,
    'Payments confirmed',
    deliveries.length === 0 ? 'missing' : paid === deliveries.length ? 'pass' : 'partial',
    deliveries.length ? `${paid} of ${deliveries.length}` : 'No deliveries recorded',
  );

  const weight = { pass: 1, partial: 0.5, flag: 0, missing: 0 };
  const score = checks.reduce((s, c) => s + weight[c.result], 0);

  return {
    checks,
    score: round1(score),
    outOf: checks.length,
    // Plain words rather than a bare number, because this drives a decision.
    confidence: score >= 6 ? 'High' : score >= 4 ? 'Medium' : 'Low',
    note:
      'Pass = 1, Partial = 0.5, Flag or Missing = 0. A flag means the record must be ' +
      'confirmed before a lender relies on it; it is not a finding against the farmer.',
  };
}

/** Season-by-season production and market record (report section 4). */
function buildProductionRecord(productions, deliveries) {
  const byseason = productions.map((p) => {
    const expected = num(p.expected_yield_tonnes) * 1000;
    const actual = p.actual_yield_tonnes == null ? null : num(p.actual_yield_tonnes) * 1000;
    const acres = num(p.farm_size_acres);

    const seasonDeliveries = deliveries.filter((d) => d.seasonal_production_id === p.id);
    const deliveredKg = seasonDeliveries.reduce((s, d) => s + num(d.quantity_kg), 0);
    const grades = [...new Set(seasonDeliveries.map((d) => d.quality_grade).filter(Boolean))];
    const allPaid =
      seasonDeliveries.length > 0 && seasonDeliveries.every((d) => d.payment_status === 'paid');

    return {
      season: p.season || '—',
      expectedKg: expected ? round2(expected) : null,
      actualKg: actual == null ? null : round2(actual),
      actualVsExpected:
        actual != null && expected > 0 ? `${round1((actual / expected) * 100)}%` : null,
      yieldPerAcreKg: actual != null && acres > 0 ? Math.round(actual / acres) : null,
      deliveredKg: seasonDeliveries.length ? round2(deliveredKg) : null,
      shareSold: actual != null && actual > 0 && deliveredKg > 0
        ? `${round1((deliveredKg / actual) * 100)}%`
        : null,
      quality: grades.length ? grades.join(', ') : null,
      payment: seasonDeliveries.length === 0 ? null : allPaid ? 'Paid' : 'Partly paid',
    };
  });

  const totalActual = byseason.reduce((s, r) => s + (r.actualKg || 0), 0);
  const totalDelivered = byseason.reduce((s, r) => s + (r.deliveredKg || 0), 0);
  const seasonsWithActual = byseason.filter((r) => r.actualKg != null);
  const perAcreValues = byseason.map((r) => r.yieldPerAcreKg).filter((v) => v != null);

  return {
    seasons: byseason,
    totals: {
      actualKg: round2(totalActual),
      deliveredKg: round2(totalDelivered),
      shareSold: totalActual > 0 ? `${round1((totalDelivered / totalActual) * 100)}%` : null,
      averageYieldPerAcreKg: perAcreValues.length
        ? Math.round(perAcreValues.reduce((a, b) => a + b, 0) / perAcreValues.length)
        : null,
      seasonsRecorded: byseason.length,
      seasonsWithActualYield: seasonsWithActual.length,
    },
  };
}

/**
 * Income and repayment capacity (report section 5).
 *
 * Every figure is ILLUSTRATIVE and labelled as such. Sale values are not
 * captured per delivery in every case, so where a price is missing the
 * estimate falls back to the cooperative's recorded price and says which was
 * used — a lender must be able to see whether a number is measured or assumed.
 */
function buildCapacity({ productionRecord, deliveries, firstLoanCapNgn }) {
  const seasonsWithActual = productionRecord.seasons.filter((s) => s.actualKg != null);
  const averageSeasonalKg = seasonsWithActual.length
    ? seasonsWithActual.reduce((s, r) => s + r.actualKg, 0) / seasonsWithActual.length
    : 0;

  const pricedDeliveries = deliveries.filter((d) => num(d.price_per_kg) > 0);
  const observedPrice = pricedDeliveries.length
    ? pricedDeliveries.reduce((s, d) => s + num(d.price_per_kg), 0) / pricedDeliveries.length
    : null;

  const estimatedSeasonalSales = observedPrice ? averageSeasonalKg * observedPrice : null;

  // 30% of estimated seasonal sales, or the first-loan cap, whichever is lower.
  const thirtyPercent = estimatedSeasonalSales ? estimatedSeasonalSales * 0.3 : null;
  const starterLimit =
    thirtyPercent != null ? Math.min(thirtyPercent, firstLoanCapNgn) : firstLoanCapNgn;

  return {
    averageSeasonalYieldKg: round2(averageSeasonalKg),
    seasonsUsed: seasonsWithActual.length,
    pricePerKgNgn: observedPrice ? round2(observedPrice) : null,
    priceBasis: observedPrice
      ? `Average of ${pricedDeliveries.length} recorded delivery price(s)`
      : 'No delivery prices recorded — sales cannot be estimated',
    estimatedSeasonalSalesNgn: estimatedSeasonalSales ? Math.round(estimatedSeasonalSales) : null,
    starterLimitNgn: Math.round(starterLimit),
    starterLimitBasis:
      thirtyPercent != null
        ? 'Lower of 30% of estimated seasonal sales and the first-loan cap'
        : 'First-loan cap (sales could not be estimated)',
    productionCostNgn: null,
    productionCostBasis: 'Not collected — requires a farmer cost survey',
    illustrative: true,
  };
}

/** Credit history and exposure (report section 6). */
function buildExposure(financing, repayments) {
  const cycles = financing.filter((f) => ['disbursed', 'completed'].includes(f.status));
  const active = cycles.filter((f) => f.status === 'disbursed');
  const settled = cycles.filter((f) => f.status === 'completed');

  const paidByLoan = new Map();
  for (const r of repayments) {
    const key = r.financing_request_id;
    paidByLoan.set(key, (paidByLoan.get(key) || 0) + num(r.amount_paid));
  }

  let overdue = 0;
  for (const loan of active) {
    const principal = loanPrincipal(loan);
    const paid = paidByLoan.get(loan.id) || 0;
    const due = loan.due_date ? new Date(loan.due_date) : null;
    if (due && due < new Date() && paid < principal) overdue += 1;
  }

  return {
    activeLoans: active.length,
    settledLoans: settled.length,
    overdueLoans: overdue,
    externalBureauCheck: 'Not run (requires BVN or NIN and the farmer\'s consent)',
    note:
      cycles.length === 0
        ? 'No loan history is not a negative mark. It means repayment behaviour is unproven, not that repayment failed.'
        : null,
  };
}

/**
 * Builds the full farmer report payload.
 *
 * Returns the data only; the clients render it. Both render the same payload
 * so a farmer's report reads identically in the app and in the dashboards.
 */
async function buildFarmerReport(farmerId, { issuedAt = new Date().toISOString() } = {}) {
  const sb = supabaseAdmin();

  const { data: farmer, error: farmerErr } = await sb
    .from('farmers')
    .select('*, cooperatives(id, name, state, lga), farm_profiles(*), credit_scores(*)')
    .eq('id', farmerId)
    .maybeSingle();
  if (farmerErr) throw farmerErr;
  if (!farmer) return null;

  const [productionsRes, deliveriesRes, financingRes, repaymentsRes, historyRes] =
    await Promise.all([
      sb
        .from('seasonal_productions')
        .select('*')
        .eq('farmer_id', farmerId)
        .order('created_at', { ascending: true })
        .limit(50),
      sb
        .from('produce_deliveries')
        .select('*')
        .eq('farmer_id', farmerId)
        .order('date_delivered', { ascending: true })
        .limit(500),
      sb
        .from('financing_requests')
        .select('id, loan_amount, approved_amount, disbursed_amount, status, due_date, created_at')
        .eq('farmer_id', farmerId)
        .limit(200),
      sb
        .from('repayment_records')
        .select('financing_request_id, amount_paid, payment_date')
        .eq('farmer_id', farmerId)
        .eq('voided', false)
        .limit(1000),
      sb
        .from('credit_score_history')
        /**
         * FIXED — this selected and ordered by `created_at`, which does not
         * exist on this table: the column is `calculated_at`. PostgREST
         * answers an unknown column with a 42703, and the guard below is
         * `if (r.error) throw r.error` — so EVERY call to the lender credit
         * report returned a 500, for every farmer, in all three places it is
         * exposed (the app, the admin dashboard and the partner dashboard).
         *
         * Every other query against this table already used
         * `calculated_at`; only the report had it wrong, which is why it
         * went unnoticed — nothing else fails.
         */
        .select('final_score, credit_tier, trigger_reason, model_version, calculated_at')
        .eq('farmer_id', farmerId)
        .order('calculated_at', { ascending: true })
        .limit(50),
    ]);

  for (const r of [productionsRes, deliveriesRes, financingRes, repaymentsRes, historyRes]) {
    if (r.error) throw r.error;
  }

  const productions = productionsRes.data || [];
  const deliveries = deliveriesRes.data || [];
  const financing = financingRes.data || [];
  const repayments = repaymentsRes.data || [];
  const history = historyRes.data || [];

  // The farmer's farms, as a set. `farmProfile` stays as the primary farm —
  // the single-farm fields in the document (ownership, water source) describe
  // it — while acreage and crops come from the whole set.
  const farmSummary = summarizeFarms(farmer.farm_profiles);
  const farmProfile = farmSummary.primary;
  const score = farmer.credit_scores?.[0] || null;

  const finalScore = num(score?.final_credit_score);
  const tier = score?.credit_tier || tierForScore(finalScore);
  const isFirstCycle = score?.is_first_cycle !== false;

  const productionRecord = buildProductionRecord(productions, deliveries);
  const verification = buildVerificationChecks({
    farmer,
    farmProfile,
    farms: farmSummary.farms,
    landAcres: farmSummary.totalAcres,
    productions,
    deliveries,
  });
  const exposure = buildExposure(financing, repayments);
  const capacity = buildCapacity({
    productionRecord,
    deliveries,
    firstLoanCapNgn: num(score?.recommended_loan_max) || 300000,
  });

  const issued = new Date(issuedAt);
  const validUntil = new Date(issued.getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  // Every crop across every farm, the primary crop first.
  const crops = farmSummary.crops;

  return {
    meta: {
      reportId: buildReportId({
        state: farmer.state || farmer.cooperatives?.state,
        lga: farmer.lga || farmer.cooperatives?.lga,
        sequence: 1,
        issuedAt,
      }),
      issuedAt,
      validUntil: validUntil.toISOString(),
      modelVersion: score?.model_version || MODEL_VERSION,
      confidential: true,
      disclaimer:
        'Compiled from data supplied by cooperatives and farmers. Not a guarantee of repayment. ' +
        'Share only with the farmer\'s consent and in line with applicable data protection law.',
    },

    subject: {
      kind: 'farmer',
      id: farmer.id,
      fullName: farmer.full_name,
      gender: farmer.gender || null,
      // Masked. Raw NIN and BVN never appear in a partner-facing document.
      phoneMasked: maskPhone(farmer.phone),
      cooperative: farmer.cooperatives?.name || null,
      cooperativeId: farmer.cooperatives?.id || null,
      location: [farmer.lga, farmer.state].filter(Boolean).join(', ') || null,
      farm: {
        // Total land across all of the farmer's farms. This is the figure a
        // lender sizes a loan against, and the one the score divides by.
        sizeAcres: farmSummary.farmCount > 0 ? farmSummary.totalAcres : null,
        crops,
        ownership: farmProfile?.land_ownership || null,
        waterSource: farmProfile?.water_source || null,
        // FIXED — read `farming_experience_years`, a column that does not
        // exist. `farm_profiles` has `years_experience`, so "Seasons farmed"
        // printed blank on every report.
        farmingExperienceYears: farmProfile?.years_experience ?? null,
        // A farmer with several plots: the lender sees how the land breaks
        // down rather than one total they cannot reconcile with the map.
        farmCount: farmSummary.farmCount,
        farms: farmSummary.farms.map((f, i) => ({
          label: farmLabel(f, i),
          sizeAcres: farmAcres(f),
          cropType: f.crop_type || null,
          gpsMapped: !!f.gps_mapped,
        })),
        mappedAcres: farmSummary.mappedAcres,
        fullyMapped: farmSummary.fullyMapped,
      },
      consent: {
        recorded: Boolean(farmer.consent_record_id),
        status: farmer.consent_status || null,
        thirdPartySharing: farmer.third_party_sharing === true,
      },
    },

    assessment: {
      finalScore: round1(finalScore),
      outOf: 100,
      tier,
      tierLabel: TIER_LABELS[tier] || null,
      guidance: TIER_GUIDANCE[tier] || null,
      provisional: isFirstCycle,
      provisionalNote: isFirstCycle
        ? 'First cycle: scored on production only and held at the Tier C ceiling until a ' +
          'repayment is recorded. No loan history means repayment is unproven, not failed.'
        : null,
      dataConfidence: verification.confidence,
      components: [
        {
          name: 'Production',
          weight: '50%',
          score: round1(num(score?.production_score)),
          outOf: 100,
          evidence: productionRecord.totals.seasonsWithActualYield
            ? `${productionRecord.totals.seasonsWithActualYield} season(s) with recorded yield; ` +
              `average ${productionRecord.totals.averageYieldPerAcreKg ?? '—'} kg per acre`
            : 'No recorded yield yet',
        },
        {
          name: 'Repayment',
          weight: isFirstCycle ? 'Not scored' : '50%',
          score: isFirstCycle ? null : round1(num(score?.repayment_score)),
          outOf: isFirstCycle ? null : 100,
          evidence: isFirstCycle
            ? 'No loan history yet; activates after the first cycle'
            : `${exposure.settledLoans} settled, ${exposure.activeLoans} active, ${exposure.overdueLoans} overdue`,
        },
      ],
      bands: 'A 90-100 | B 85-89 | C 75-84 | D below 75',
    },

    productionRecord,
    capacity,
    exposure,
    verification,

    scoreHistory: history.map((h) => ({
      date: (h.calculated_at || '').slice(0, 10),
      score: h.final_score == null ? null : round1(num(h.final_score)),
      tier: h.credit_tier,
      reason: h.trigger_reason,
      modelVersion: h.model_version,
    })),
  };
}

/** Cooperative report: the group view a lender sees before funding a pool. */
async function buildCooperativeReport(cooperativeId, { issuedAt = new Date().toISOString() } = {}) {
  const sb = supabaseAdmin();

  const { data: coop, error: coopErr } = await sb
    .from('cooperatives')
    .select('*, cooperative_credit_scores(*)')
    .eq('id', cooperativeId)
    .maybeSingle();
  if (coopErr) throw coopErr;
  if (!coop) return null;

  const { data: members, error: membersErr } = await sb
    .from('farmers')
    .select('id, full_name, credit_scores(final_credit_score, credit_tier, is_first_cycle, production_score)')
    .eq('cooperative_id', cooperativeId)
    .limit(2000);
  if (membersErr) throw membersErr;

  const rollup = coop.cooperative_credit_scores?.[0] || null;
  const averageScore = num(rollup?.average_score);
  const tier = rollup?.cooperative_tier || tierForScore(averageScore);

  const scored = (members || []).filter((m) => m.credit_scores?.[0]);
  const firstCycle = scored.filter((m) => m.credit_scores[0].is_first_cycle === true).length;

  const issued = new Date(issuedAt);
  const validUntil = new Date(issued.getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  return {
    meta: {
      reportId: buildReportId({ state: coop.state, lga: coop.lga, sequence: 1, issuedAt }),
      issuedAt,
      validUntil: validUntil.toISOString(),
      modelVersion: MODEL_VERSION,
      confidential: true,
      disclaimer:
        'Compiled from data supplied by cooperatives and farmers. Not a guarantee of repayment.',
    },
    subject: {
      kind: 'cooperative',
      id: coop.id,
      name: coop.name,
      registrationNumber: coop.registration_number || null,
      location: [coop.lga, coop.state].filter(Boolean).join(', ') || null,
      consent: {
        recorded: Boolean(coop.consent_record_id),
        status: coop.consent_status || null,
        thirdPartySharing: coop.third_party_sharing === true,
      },
    },
    assessment: {
      averageScore: round1(averageScore),
      outOf: 100,
      tier,
      tierLabel: TIER_LABELS[tier] || null,
      guidance: TIER_GUIDANCE[tier] || null,
      bands: 'A 90-100 | B 85-89 | C 75-84 | D below 75',
      // How the average is built, stated plainly: the two numbers differ
      // whenever members have no score yet, and a lender should see that
      // rather than infer it.
      basis:
        'Average of member scores. First-cycle members contribute their production score only, ' +
        'so a new cohort neither inflates nor deflates the cooperative tier.',
    },
    membership: {
      totalFarmers: (members || []).length,
      scoredFarmers: scored.length,
      unscoredFarmers: (members || []).length - scored.length,
      firstCycleFarmers: firstCycle,
      tierCounts: {
        A: num(rollup?.tier_a_count),
        B: num(rollup?.tier_b_count),
        C: num(rollup?.tier_c_count),
        D: num(rollup?.tier_d_count),
      },
    },
  };
}

module.exports = {
  VALIDITY_DAYS,
  TIER_LABELS,
  TIER_GUIDANCE,
  maskPhone,
  buildReportId,
  buildVerificationChecks,
  buildProductionRecord,
  buildCapacity,
  buildExposure,
  buildFarmerReport,
  buildCooperativeReport,
};
