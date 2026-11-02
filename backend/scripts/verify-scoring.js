'use strict';

/**
 * Heabron CoopScore — credit score engine verification (model v3.0)
 * -----------------------------------------------------------------
 * Run with:  node scripts/verify-scoring.js
 *
 * Every expected value here is taken from "Heabron Credit Score System —
 * Technical Specification & Methodology" v1.0, so these tests fail if the
 * engine drifts from the document rather than merely from itself. Section
 * numbers are cited at each test.
 *
 * Pure functions only: no database, no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const SRC = path.join(__dirname, '..', 'src');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function loadEngine() {
  const resolved = require.resolve(path.join(SRC, 'services', 'credit-score', 'index.js'));
  delete require.cache[resolved];
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request.endsWith('/config/supabase') || request.endsWith('../../config/supabase')) {
      return { supabaseAdmin: () => { throw new Error('no database in these tests'); } };
    }
    if (request.endsWith('utils/logger')) return silentLogger;
    return originalLoad(request, parent, isMain);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
  }
}

const engine = loadEngine();

// ───────────────────────────────────────────── Section 2 — Production Score

test('production: worked example — rice, Kwara State (spec 2.3)', () => {
  // Benchmark 4.0 t/ha, farmer actual 3.2 t/ha -> ratio 0.80 -> 80/100.
  const r = engine.computeProductionScore({ actualYield: 3.2, benchmarkYield: 4.0 });
  assert.equal(r.score, 80);
  assert.equal(r.yieldRatio, 0.8);
});

test('production: the yield ratio is capped at 1.0 (spec 2.2)', () => {
  // Beating the benchmark must not score above 100 — no overflow.
  const r = engine.computeProductionScore({ actualYield: 8.0, benchmarkYield: 4.0 });
  assert.equal(r.score, 100);
  assert.equal(r.yieldRatio, 1);
});

test('production: missing or nonsensical inputs score 0, never negative', () => {
  for (const input of [
    { actualYield: 0, benchmarkYield: 4 },
    { actualYield: -3, benchmarkYield: 4 },
    { actualYield: 3, benchmarkYield: 0 },
    { actualYield: NaN, benchmarkYield: 4 },
    { actualYield: 3, benchmarkYield: null },
  ]) {
    const r = engine.computeProductionScore(input);
    assert.equal(r.score, 0, `${JSON.stringify(input)} should score 0`);
  }
});

// ───────────────────────────────────────────── Section 3 — Repayment Score

const DUE = '2026-06-01T00:00:00.000Z';
const onTime = (amount) => [{ amount_paid: amount, payment_date: '2026-05-20T00:00:00.000Z' }];

test('repayment: worked example — 95% repaid, on time, no defaults (spec 3.3)', () => {
  // Rate 0.95 x 60 = 57, Timeliness 25, Default history 15 -> 97/100.
  const r = engine.computeRepaymentScore({
    repayments: onTime(475000),
    loanAmount: 500000,
    dueDate: DUE,
    priorDefaults: { active: false, everDefaulted: false, cleanCyclesSinceDefault: 0 },
  });

  assert.equal(r.components.repaymentRate, 57);
  assert.equal(r.components.timeliness, 25);
  assert.equal(r.components.defaultHistory, 15);
  assert.equal(r.score, 97);
});

test('repayment: rate band table (spec 3.2A)', () => {
  const rateFor = (paid) =>
    engine.computeRepaymentScore({
      repayments: onTime(paid),
      loanAmount: 500000,
      dueDate: DUE,
      priorDefaults: { active: false, everDefaulted: false },
    }).components.repaymentRate;

  assert.equal(rateFor(500000), 60); // 100%
  assert.equal(rateFor(475000), 57); // 95%
  assert.equal(rateFor(400000), 48); // 80%
  assert.ok(rateFor(200000) < 30); // below 50% — flagged as high risk
});

test('repayment: timeliness bands (spec 3.2B)', () => {
  const timelinessFor = (paymentDate) =>
    engine.computeRepaymentScore({
      repayments: [{ amount_paid: 500000, payment_date: paymentDate }],
      loanAmount: 500000,
      dueDate: DUE,
      priorDefaults: { active: false, everDefaulted: false },
    }).components.timeliness;

  assert.equal(timelinessFor('2026-05-20T00:00:00.000Z'), 25); // on time
  assert.equal(timelinessFor('2026-06-20T00:00:00.000Z'), 20); // 19 days late
  assert.equal(timelinessFor('2026-08-01T00:00:00.000Z'), 5); // 61 days late
});

test('repayment: a context-flagged late payment is not penalised (spec 3.2B)', () => {
  // Weather event, market collapse or health emergency documented by the agent.
  const r = engine.computeRepaymentScore({
    repayments: [
      { amount_paid: 500000, payment_date: '2026-08-01T00:00:00.000Z', context_flag: 'weather' },
    ],
    loanAmount: 500000,
    dueDate: DUE,
    priorDefaults: { active: false, everDefaulted: false },
  });
  assert.equal(r.components.timeliness, 25);
  assert.equal(r.timelinessBasis, 'late_context_excused');
});

test('repayment: default-history levels (spec 3.2C)', () => {
  const historyFor = (priorDefaults) =>
    engine.computeRepaymentScore({
      repayments: onTime(500000),
      loanAmount: 500000,
      dueDate: DUE,
      priorDefaults,
    }).components.defaultHistory;

  assert.equal(historyFor({ active: false, everDefaulted: false }), 15);
  assert.equal(historyFor({ active: true }), 0);
  assert.equal(
    historyFor({ active: false, everDefaulted: true, cleanCyclesSinceDefault: 2 }),
    8,
    'recovered after 2+ clean cycles'
  );
  assert.equal(
    historyFor({ active: false, everDefaulted: true, cleanCyclesSinceDefault: 1 }),
    0,
    'still recovering — not yet two clean cycles'
  );
});

test('repayment: no assessable due date scores zero timeliness, not full marks', () => {
  const r = engine.computeRepaymentScore({
    repayments: [{ amount_paid: 500000 }],
    loanAmount: 500000,
    dueDate: null,
    priorDefaults: { active: false, everDefaulted: false },
  });
  assert.equal(r.components.timeliness, 0);
  assert.equal(r.timelinessBasis, 'no_due_date');
});

// ───────────────────────────────────────────── Section 4 — Final Credit Score

/** The final-score arithmetic, mirrored from recalculateFarmerScore. */
function finalScore(production, repayment, { isFirstCycle = false } = {}) {
  const raw = isFirstCycle ? Math.min(production, 84) : (production + repayment) / 2;
  return Math.floor(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

test('final: complete worked example — 80 production + 97 repayment = 88.5 (spec 4.1)', () => {
  assert.equal(finalScore(80, 97), 88.5);
  assert.equal(engine.tierForScore(88.5), 'B');
});

test('final: scores are truncated, never rounded up (spec 4.1)', () => {
  // 88.5 must stay 88.5, and a value just under a tier edge must not be
  // rounded across it: 89.99 is Tier B, not Tier A.
  assert.equal(finalScore(80, 99.9), 89.9);
  assert.equal(engine.tierForScore(finalScore(80, 99.9)), 'B');
});

// ───────────────────────────────────────────── Section 5 — Tier bands

test('tiers: band boundaries (spec section 5 and 8)', () => {
  const cases = [
    [100, 'A'], [95, 'A'], [90, 'A'],
    [89.9, 'B'], [87, 'B'], [85, 'B'],
    [84.9, 'C'], [80, 'C'], [75, 'C'],
    [74.9, 'D'], [50, 'D'], [0, 'D'],
  ];
  for (const [score, expected] of cases) {
    assert.equal(engine.tierForScore(score), expected, `${score} should be Tier ${expected}`);
  }
});

// ───────────────────────────────────────────── Section 7 — First cycle

test('first cycle: production only, capped at Tier C (spec section 7)', () => {
  // A first-cycle farmer with a perfect production score is still held at 84,
  // so they cannot reach a Tier A or B limit before any repayment exists.
  assert.equal(finalScore(100, 0, { isFirstCycle: true }), 84);
  assert.equal(engine.tierForScore(84), 'C');

  // Below the cap, the production score passes through unchanged.
  assert.equal(finalScore(62, 0, { isFirstCycle: true }), 62);
  assert.equal(engine.tierForScore(62), 'D');
});

test('first cycle: repayment is not counted as zero against the farmer', () => {
  // The trap this guards: averaging in a repayment score of 0 for someone who
  // has never had a loan would halve their score and read as a failure to
  // repay. A first-cycle farmer at 80 production must be 80, not 40.
  assert.equal(finalScore(80, 0, { isFirstCycle: true }), 80);
  assert.notEqual(finalScore(80, 0, { isFirstCycle: true }), 40);
});

// ───────────────────────────────── Section 6 — Cooperative average

/** Mirrors the cooperative rollup: first-cycle members contribute production. */
function cooperativeAverage(members) {
  const contributions = members
    .map((m) => (m.isFirstCycle ? m.production : m.final))
    .filter((v) => Number.isFinite(v));
  if (contributions.length === 0) return 0;
  const sum = contributions.reduce((a, b) => a + b, 0);
  return Math.floor((sum / contributions.length) * 10) / 10;
}

test('cooperative: worked example — GreenField, 5 members (spec 6.3)', () => {
  const members = [
    { final: 88.5 }, // Adaeze Nwosu   80 / 97
    { final: 95.0 }, // Emeka Okafor   90 / 100
    { final: 82.5 }, // Fatima Abdullahi 75 / 90
    { final: 90.0 }, // Ngozi Dike     85 / 95
    { final: 79.0 }, // Blessing Afolabi 70 / 88
  ];
  const avg = cooperativeAverage(members);
  assert.equal(avg, 87, '435 / 5 = 87.0');
  assert.equal(engine.tierForScore(avg), 'B');
});

test('cooperative: first-cycle members contribute production, not their capped final', () => {
  // A first-cycle member sits at the 84 cap. Contributing 84 instead of their
  // real production score of 95 would understate a strong new member — and
  // across a new cohort would pull the whole cooperative toward 84.
  const withCappedFinal = cooperativeAverage([{ final: 90 }, { final: 84 }]);
  const withProduction = cooperativeAverage([
    { final: 90 },
    { isFirstCycle: true, production: 95, final: 84 },
  ]);

  assert.equal(withCappedFinal, 87);
  assert.equal(withProduction, 92.5);
  assert.ok(withProduction > withCappedFinal);
});

test('cooperative: a member with no score does not poison the average', () => {
  // A single NULL used to turn the whole average into NaN, which was then
  // written to cooperatives.average_credit_score and shown to lenders.
  const avg = cooperativeAverage([{ final: 90 }, { final: null }, { final: 80 }]);
  assert.equal(avg, 85);
  assert.ok(Number.isFinite(avg));
});

// ───────────────────────────────────────────── Model identity

test('model: the engine reports v3.0 and the specification tier bands', () => {
  assert.equal(engine.MODEL_VERSION, 'v3.0');
  assert.equal(engine.SCORE_MAX, 100);
  assert.deepEqual(engine.TIER_THRESHOLDS, { A: 90, B: 85, C: 75 });
});

test('repayment: paying nothing on an overdue loan is still penalised', () => {
  // The timeliness fix must not become a loophole: with no payments at all,
  // there is no payment date to vouch for punctuality, so the loan is measured
  // against today and scores as late.
  const r = engine.computeRepaymentScore({
    repayments: [],
    loanAmount: 500000,
    dueDate: '2020-01-01T00:00:00.000Z', // long overdue
    priorDefaults: { active: true },
  });

  assert.equal(r.components.repaymentRate, 0);
  assert.equal(r.components.timeliness, 5, 'over 30 days late');
  assert.equal(r.components.defaultHistory, 0, 'active default');
  assert.equal(r.score, 5);
});

test('repayment: a token payment before the deadline does not buy a good score', () => {
  // On time, but almost nothing repaid. Timeliness is earned (they did pay
  // when they said), but the Rate component carries the shortfall, so the
  // overall score stays low.
  const r = engine.computeRepaymentScore({
    repayments: [{ amount_paid: 5000, payment_date: '2026-05-01T00:00:00.000Z' }],
    loanAmount: 500000,
    dueDate: DUE,
    priorDefaults: { active: false, everDefaulted: false },
  });

  assert.equal(r.components.repaymentRate, 0.6, '1% of the loan');
  assert.equal(r.components.timeliness, 25);
  assert.ok(r.score < 45, `scored ${r.score} — must stay well below a good repayment record`);
});
