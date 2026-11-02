'use strict';

/**
 * Heabron CoopScore — credit report verification
 * ----------------------------------------------
 * Run with:  node scripts/verify-report.js
 *
 * Covers the pure parts of the lender report: identity masking, report ids,
 * the eight data-verification checks, the production record and the capacity
 * estimates. Section numbers refer to "CoopScore Farmer Credit Report
 * (2-page lender version)".
 *
 * No database and no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const SRC = path.join(__dirname, '..', 'src');

function loadReport() {
  const resolved = require.resolve(path.join(SRC, 'services', 'credit-report', 'index.js'));
  delete require.cache[resolved];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request.endsWith('config/supabase')) {
      return { supabaseAdmin: () => { throw new Error('no database in these tests'); } };
    }
    if (request.endsWith('utils/logger')) return { info() {}, warn() {}, error() {}, debug() {} };
    return originalLoad(request, parent, isMain);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
  }
}

const report = loadReport();

// ─────────────────────────────────────────────────── identity protection

test('phone numbers are masked for a partner-facing document', () => {
  // The sample report prints `+234 705 *** 3777`.
  assert.equal(report.maskPhone('+2347053331777'), '+234705 *** 1777');
  assert.equal(report.maskPhone('08067543299'), '0806 *** 3299');
});

test('an unusable phone number masks to null rather than leaking a fragment', () => {
  assert.equal(report.maskPhone(''), null);
  assert.equal(report.maskPhone(null), null);
  assert.equal(report.maskPhone('12345'), null);
});

test('a masked number never contains the middle digits', () => {
  const raw = '+2348123456789';
  const masked = report.maskPhone(raw);
  // The identifying middle must be gone; the last four may remain so an agent
  // can confirm they have the right person.
  assert.ok(!masked.includes('34567'));
  assert.ok(masked.endsWith('6789'));
});

// ───────────────────────────────────────────────────────────── report id

test('report id follows CS-STATE-LGA-SEQ-DATE', () => {
  const id = report.buildReportId({
    state: 'Benue',
    lga: 'Oju',
    sequence: 1,
    issuedAt: '2026-10-29T00:00:00.000Z',
  });
  assert.equal(id, 'CS-BEN-OJU-0001-20261029');
});

test('report id stays well formed with awkward or missing location data', () => {
  const id = report.buildReportId({ state: 'FCT', lga: null, sequence: 42, issuedAt: '2026-01-05T00:00:00.000Z' });
  assert.match(id, /^CS-[A-Z]{3}-[A-Z]{3}-0042-20260105$/);

  const spaced = report.buildReportId({
    state: 'Akwa Ibom',
    lga: 'Ikot Ekpene',
    sequence: 7,
    issuedAt: '2026-01-05T00:00:00.000Z',
  });
  // Non-letters are stripped rather than producing a malformed id.
  assert.match(spaced, /^CS-AKW-IKO-0007-20260105$/);
});

// ──────────────────────────────────────────── data verification (section 7)

const farmerBase = {
  full_name: 'Adenike Babalola',
  phone: '+2347053331777',
  address: 'Oju, Benue',
  date_of_birth: '1980-04-12',
  created_at: '2026-04-08T00:00:00.000Z',
};
const farmBase = { farm_size_acres: 3, gps_latitude: 6.9, gps_longitude: 8.3 };

test('a complete, consistent record scores high confidence', () => {
  const v = report.buildVerificationChecks({
    farmer: farmerBase,
    farmProfile: farmBase,
    productions: [
      {
        id: 'p1',
        season: '2024 Early Wet',
        actual_yield_tonnes: 5.0,
        expected_yield_tonnes: 5.5,
        farm_size_acres: 3,
        expected_harvest_date: '2024-08-01',
      },
    ],
    deliveries: [
      { seasonal_production_id: 'p1', quantity_kg: 4800, date_delivered: '2024-09-01', payment_status: 'paid', quality_grade: 'A' },
    ],
  });

  assert.equal(v.outOf, 8);
  assert.ok(v.score >= 6, `scored ${v.score}`);
  assert.equal(v.confidence, 'High');
});

test('a date of birth set to the registration date is flagged', () => {
  // The sample report flags exactly this: a DOB that is really the day the
  // record was created.
  const v = report.buildVerificationChecks({
    farmer: { ...farmerBase, date_of_birth: '2026-04-08' },
    farmProfile: farmBase,
    productions: [],
    deliveries: [],
  });
  const dob = v.checks.find((c) => c.id === 2);
  assert.equal(dob.result, 'flag');
  assert.match(dob.detail, /registration date/i);
});

test('delivering more than the recorded yield is flagged, not silently accepted', () => {
  const v = report.buildVerificationChecks({
    farmer: farmerBase,
    farmProfile: farmBase,
    productions: [{ id: 'p1', actual_yield_tonnes: 4.777, expected_harvest_date: '2024-08-01' }],
    deliveries: [
      { seasonal_production_id: 'p1', quantity_kg: 5201.6, date_delivered: '2024-09-01', payment_status: 'paid' },
    ],
  });
  const check = v.checks.find((c) => c.id === 5);
  assert.equal(check.result, 'flag');
  assert.match(check.detail, /10[0-9]%/);
});

test('deliveries dated before the harvest window are flagged', () => {
  const v = report.buildVerificationChecks({
    farmer: farmerBase,
    farmProfile: farmBase,
    productions: [{ id: 'p1', actual_yield_tonnes: 5, expected_harvest_date: '2024-08-01' }],
    deliveries: [
      { seasonal_production_id: 'p1', quantity_kg: 1000, date_delivered: '2024-05-01', payment_status: 'paid' },
    ],
  });
  const check = v.checks.find((c) => c.id === 6);
  assert.equal(check.result, 'flag');
  assert.match(check.detail, /precede/i);
});

test('a missing record scores zero without being described as a failure', () => {
  const v = report.buildVerificationChecks({
    farmer: { full_name: 'A', created_at: '2026-01-01T00:00:00.000Z' },
    farmProfile: null,
    productions: [],
    deliveries: [],
  });
  assert.ok(v.score <= 1, `scored ${v.score}`);
  assert.equal(v.confidence, 'Low');
  // The wording matters: a flag is a record to confirm, not an accusation.
  assert.match(v.note, /not a finding against the farmer/i);
});

test('partial results are worth half a point', () => {
  const v = report.buildVerificationChecks({
    farmer: farmerBase,
    farmProfile: farmBase,
    productions: [
      { id: 'p1', actual_yield_tonnes: 5, expected_harvest_date: '2024-08-01' },
      { id: 'p2', actual_yield_tonnes: null, expected_harvest_date: '2025-08-01' },
    ],
    deliveries: [],
  });
  const yieldCheck = v.checks.find((c) => c.id === 4);
  assert.equal(yieldCheck.result, 'partial');
  assert.match(yieldCheck.detail, /1 of 2/);
});

// ──────────────────────────────────────────── production record (section 4)

test('production record computes actual vs expected and share sold', () => {
  const pr = report.buildProductionRecord(
    [
      {
        id: 'p1',
        season: '2024 Early Wet',
        expected_yield_tonnes: 5.5454,
        actual_yield_tonnes: 5.0259,
        farm_size_acres: 3,
      },
    ],
    [
      { seasonal_production_id: 'p1', quantity_kg: 4342.3, quality_grade: 'B', payment_status: 'paid' },
    ],
  );

  const season = pr.seasons[0];
  assert.equal(season.expectedKg, 5545.4);
  assert.equal(season.actualKg, 5025.9);
  assert.equal(season.actualVsExpected, '90.6%');
  assert.equal(season.yieldPerAcreKg, 1675);
  assert.equal(season.shareSold, '86.4%');
  assert.equal(season.payment, 'Paid');
});

test('an unrecorded season reports nulls rather than zeros', () => {
  // Zero would read as "produced nothing", which is a different and damaging
  // claim from "not recorded".
  const pr = report.buildProductionRecord(
    [{ id: 'p3', season: '2025 Early Wet', expected_yield_tonnes: 4.7775, actual_yield_tonnes: null }],
    [],
  );
  const season = pr.seasons[0];
  assert.equal(season.actualKg, null);
  assert.equal(season.actualVsExpected, null);
  assert.equal(season.deliveredKg, null);
  assert.equal(season.payment, null);
  assert.equal(pr.totals.seasonsWithActualYield, 0);
});

// ──────────────────────────────────────────────── capacity (section 5)

test('capacity estimates are based on recorded prices, and say so', () => {
  const pr = report.buildProductionRecord(
    [
      { id: 'p1', expected_yield_tonnes: 5, actual_yield_tonnes: 5, farm_size_acres: 3 },
      { id: 'p2', expected_yield_tonnes: 5, actual_yield_tonnes: 4.8, farm_size_acres: 3 },
    ],
    [],
  );
  const cap = report.buildCapacity({
    productionRecord: pr,
    deliveries: [
      { price_per_kg: 600, quantity_kg: 1000 },
      { price_per_kg: 600, quantity_kg: 1000 },
    ],
    firstLoanCapNgn: 300000,
  });

  assert.equal(cap.averageSeasonalYieldKg, 4900);
  assert.equal(cap.pricePerKgNgn, 600);
  assert.equal(cap.estimatedSeasonalSalesNgn, 2940000);
  // 30% of 2,940,000 is 882,000, which is above the cap, so the cap applies.
  assert.equal(cap.starterLimitNgn, 300000);
  assert.match(cap.starterLimitBasis, /first-loan cap/i);
  assert.equal(cap.illustrative, true);
});

test('with no recorded prices, sales are not invented', () => {
  const pr = report.buildProductionRecord(
    [{ id: 'p1', expected_yield_tonnes: 5, actual_yield_tonnes: 5, farm_size_acres: 3 }],
    [],
  );
  const cap = report.buildCapacity({ productionRecord: pr, deliveries: [], firstLoanCapNgn: 300000 });

  assert.equal(cap.estimatedSeasonalSalesNgn, null);
  assert.match(cap.priceBasis, /no delivery prices/i);
  assert.equal(cap.starterLimitNgn, 300000);
});

test('the 30% rule binds when it is lower than the cap', () => {
  const pr = report.buildProductionRecord(
    [{ id: 'p1', expected_yield_tonnes: 1, actual_yield_tonnes: 0.5, farm_size_acres: 1 }],
    [],
  );
  const cap = report.buildCapacity({
    productionRecord: pr,
    deliveries: [{ price_per_kg: 100, quantity_kg: 500 }],
    firstLoanCapNgn: 300000,
  });
  // 500kg x 100 = 50,000 -> 30% = 15,000, below the cap.
  assert.equal(cap.estimatedSeasonalSalesNgn, 50000);
  assert.equal(cap.starterLimitNgn, 15000);
  assert.match(cap.starterLimitBasis, /30%/);
});

// ──────────────────────────────────────────────── exposure (section 6)

test('no loan history is reported as unproven, not as a failure', () => {
  const e = report.buildExposure([], []);
  assert.equal(e.activeLoans, 0);
  assert.equal(e.settledLoans, 0);
  assert.equal(e.overdueLoans, 0);
  assert.match(e.note, /not a negative mark/i);
  assert.match(e.note, /unproven, not that repayment failed/i);
});

test('an overdue, underpaid loan is counted as overdue', () => {
  const e = report.buildExposure(
    [
      { id: 'l1', status: 'disbursed', disbursed_amount: 500000, due_date: '2020-01-01' },
      { id: 'l2', status: 'completed', disbursed_amount: 200000, due_date: '2021-01-01' },
    ],
    [{ financing_request_id: 'l1', amount_paid: 100000 }],
  );
  assert.equal(e.activeLoans, 1);
  assert.equal(e.settledLoans, 1);
  assert.equal(e.overdueLoans, 1);
  assert.equal(e.note, null);
});

test('a fully repaid loan past its due date is not counted as overdue', () => {
  const e = report.buildExposure(
    [{ id: 'l1', status: 'disbursed', disbursed_amount: 500000, due_date: '2020-01-01' }],
    [{ financing_request_id: 'l1', amount_paid: 500000 }],
  );
  assert.equal(e.overdueLoans, 0);
});

// ───────────────────────────────────────────────────────── tier guidance

test('every tier has a label and lending guidance', () => {
  for (const tier of ['A', 'B', 'C', 'D']) {
    assert.ok(report.TIER_LABELS[tier], `${tier} needs a label`);
    assert.ok(report.TIER_GUIDANCE[tier], `${tier} needs guidance`);
  }
  // Matches the scoring specification's tier table.
  assert.equal(report.TIER_LABELS.A, 'Excellent');
  assert.equal(report.TIER_LABELS.D, 'At risk');
});
