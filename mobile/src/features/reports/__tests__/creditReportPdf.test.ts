import type { CreditReport } from '../model/creditReport';
import { renderFarmerReportHtml } from '../services/creditReportPdf';

/**
 * The renderer must never turn an absent value into a number. Zero is a claim
 * about the farm ("produced nothing", "repaid nothing"); null is a claim about
 * the data ("not recorded"). A lender reading the first as the second makes a
 * decision on a fact that was never established.
 */

const sparse: CreditReport = {
  meta: {
    reportId: 'CS-BEN-OJU-0001-20261101',
    issuedAt: '2026-11-01T00:00:00.000Z',
    validUntil: '2027-01-31T00:00:00.000Z',
    modelVersion: 'v3.0',
    confidential: true,
    disclaimer: 'Not a guarantee of repayment.',
  },
  subject: {
    kind: 'farmer',
    id: 'f-1',
    fullName: 'Adenike Babalola',
    gender: null,
    phoneMasked: null,
    cooperative: null,
    cooperativeId: null,
    location: null,
    farm: {
      sizeAcres: null,
      crops: [],
      ownership: null,
      waterSource: null,
      farmingExperienceYears: null,
    },
    consent: { recorded: false, status: null, thirdPartySharing: false },
  },
  assessment: {
    finalScore: 62,
    outOf: 100,
    tier: 'D',
    tierLabel: 'At risk',
    guidance: 'Restricted or no new loan.',
    provisional: true,
    provisionalNote: 'First cycle: scored on production only.',
    dataConfidence: 'Low',
    components: [
      { name: 'Production', weight: '50%', score: 62, outOf: 100, evidence: '1 season' },
      { name: 'Repayment', weight: 'Not scored', score: null, outOf: null, evidence: 'No loan history yet' },
    ],
    bands: 'A 90-100 | B 85-89 | C 75-84 | D below 75',
  },
  productionRecord: {
    seasons: [
      {
        season: '2025 Early Wet',
        expectedKg: 4777.5,
        actualKg: null,
        actualVsExpected: null,
        yieldPerAcreKg: null,
        deliveredKg: null,
        shareSold: null,
        quality: null,
        payment: null,
      },
    ],
    totals: {
      actualKg: 0,
      deliveredKg: 0,
      shareSold: null,
      averageYieldPerAcreKg: null,
      seasonsRecorded: 1,
      seasonsWithActualYield: 0,
    },
  },
  capacity: {
    averageSeasonalYieldKg: 0,
    seasonsUsed: 0,
    pricePerKgNgn: null,
    priceBasis: 'No delivery prices recorded — sales cannot be estimated',
    estimatedSeasonalSalesNgn: null,
    starterLimitNgn: 300000,
    starterLimitBasis: 'First-loan cap (sales could not be estimated)',
    productionCostNgn: null,
    productionCostBasis: 'Not collected — requires a farmer cost survey',
    illustrative: true,
  },
  exposure: {
    activeLoans: 0,
    settledLoans: 0,
    overdueLoans: 0,
    externalBureauCheck: 'Not run',
    note: 'No loan history is not a negative mark.',
  },
  verification: {
    checks: [
      { id: 1, label: 'Identity and phone on file', result: 'missing', detail: 'No phone number recorded' },
      { id: 2, label: 'Date of birth valid', result: 'flag', detail: 'Set to the registration date' },
    ],
    score: 0,
    outOf: 8,
    confidence: 'Low',
    note: 'A flag means the record must be confirmed before a lender relies on it; it is not a finding against the farmer.',
  },
  scoreHistory: [],
};

describe('credit report PDF', () => {
  const html = renderFarmerReportHtml(sparse);

  it('renders an unrecorded season as "Not recorded", never as 0', () => {
    // The row exists, but none of its measured values do.
    expect(html).toContain('2025 Early Wet');
    expect(html).toContain('Not recorded');
    // A bare >0< cell would mean the farmer produced nothing.
    expect(html).not.toMatch(/<td class="num">0<\/td>/);
  });

  it('shows a not-scored component without inventing a zero', () => {
    expect(html).toContain('Not scored');
    expect(html).toContain('No loan history yet');
  });

  it('keeps the "no loan history is not a negative mark" wording', () => {
    // A lender must not read an empty credit history as a default.
    expect(html).toContain('not a negative mark');
  });

  it('keeps the flag wording that protects the farmer', () => {
    expect(html).toContain('not a finding against the farmer');
  });

  it('marks the provisional first-cycle status', () => {
    expect(html).toContain('Provisional');
    expect(html).toContain('Tier D');
  });

  it('never prints a raw phone number, NIN or BVN', () => {
    expect(html).not.toMatch(/\b\d{11}\b/); // NIN / phone shaped
    expect(html.toLowerCase()).not.toContain('bvn');
  });

  it('carries the report id, model version and confidentiality notice', () => {
    expect(html).toContain('CS-BEN-OJU-0001-20261101');
    expect(html).toContain('v3.0');
    expect(html).toContain('CONFIDENTIAL');
  });

  it('escapes values rather than letting them inject markup', () => {
    const hostile = {
      ...sparse,
      subject: { ...sparse.subject, fullName: '<script>alert(1)</script>' },
    };
    const out = renderFarmerReportHtml(hostile);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('produces two pages', () => {
    expect(html).toContain('page-break');
  });
});
