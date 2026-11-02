/**
 * Lender credit report — the payload shape produced by
 * backend/src/services/credit-report.
 *
 * Numbers arrive already computed by the scoring engine; the client renders
 * them and never recalculates. A value the server could not determine arrives
 * as `null` and must render as "not recorded", never as zero: zero is a claim
 * about the farm, null is a claim about the data.
 */

export interface ReportMeta {
  reportId: string;
  issuedAt: string;
  validUntil: string;
  modelVersion: string;
  confidential: boolean;
  disclaimer: string;
}

export interface ReportConsent {
  recorded: boolean;
  status: string | null;
  thirdPartySharing: boolean;
}

export interface ReportComponent {
  name: string;
  weight: string;
  score: number | null;
  outOf: number | null;
  evidence: string;
}

export interface SeasonRow {
  season: string;
  expectedKg: number | null;
  actualKg: number | null;
  actualVsExpected: string | null;
  yieldPerAcreKg: number | null;
  deliveredKg: number | null;
  shareSold: string | null;
  quality: string | null;
  payment: string | null;
}

export interface VerificationCheck {
  id: number;
  label: string;
  result: 'pass' | 'partial' | 'flag' | 'missing';
  detail: string | null;
}

export interface CreditReport {
  meta: ReportMeta;
  subject: {
    kind: 'farmer';
    id: string;
    fullName: string;
    gender: string | null;
    phoneMasked: string | null;
    cooperative: string | null;
    cooperativeId: string | null;
    location: string | null;
    farm: {
      sizeAcres: number | null;
      crops: string[];
      ownership: string | null;
      waterSource: string | null;
      farmingExperienceYears: number | null;
    };
    consent: ReportConsent;
  };
  assessment: {
    finalScore: number;
    outOf: number;
    tier: string;
    tierLabel: string | null;
    guidance: string | null;
    provisional: boolean;
    provisionalNote: string | null;
    dataConfidence: string;
    components: ReportComponent[];
    bands: string;
  };
  productionRecord: {
    seasons: SeasonRow[];
    totals: {
      actualKg: number;
      deliveredKg: number;
      shareSold: string | null;
      averageYieldPerAcreKg: number | null;
      seasonsRecorded: number;
      seasonsWithActualYield: number;
    };
  };
  capacity: {
    averageSeasonalYieldKg: number;
    seasonsUsed: number;
    pricePerKgNgn: number | null;
    priceBasis: string;
    estimatedSeasonalSalesNgn: number | null;
    starterLimitNgn: number;
    starterLimitBasis: string;
    productionCostNgn: number | null;
    productionCostBasis: string;
    illustrative: boolean;
  };
  exposure: {
    activeLoans: number;
    settledLoans: number;
    overdueLoans: number;
    externalBureauCheck: string;
    note: string | null;
  };
  verification: {
    checks: VerificationCheck[];
    score: number;
    outOf: number;
    confidence: string;
    note: string;
  };
  scoreHistory: {
    date: string;
    score: number | null;
    tier: string | null;
    reason: string | null;
    modelVersion: string | null;
  }[];
}

export interface CooperativeCreditReport {
  meta: ReportMeta;
  subject: {
    kind: 'cooperative';
    id: string;
    name: string;
    registrationNumber: string | null;
    location: string | null;
    consent: ReportConsent;
  };
  assessment: {
    averageScore: number;
    outOf: number;
    tier: string;
    tierLabel: string | null;
    guidance: string | null;
    bands: string;
    basis: string;
  };
  membership: {
    totalFarmers: number;
    scoredFarmers: number;
    unscoredFarmers: number;
    firstCycleFarmers: number;
    tierCounts: { A: number; B: number; C: number; D: number };
  };
}
