/**
 * Lender credit report — two-page PDF.
 *
 * Layout follows "CoopScore Farmer Credit Report (2-page lender version)".
 * Every number comes from the server payload, which is built by
 * backend/src/services/credit-report from the authoritative scoring engine.
 * Nothing is computed, estimated or defaulted here: a figure the server did
 * not send renders as "Not recorded" rather than as a zero, because zero is a
 * claim about the farm and "not recorded" is a claim about the data.
 *
 * The same payload drives the dashboard renderer, so a farmer's report reads
 * identically wherever it is produced.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { CreditReport, CooperativeCreditReport } from '../model/creditReport';

/** Escapes text going into the HTML document. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A value that was never recorded, said plainly rather than shown as 0. */
const NOT_RECORDED = '<span class="muted">Not recorded</span>';

function show(value: unknown, suffix = ''): string {
  if (value === null || value === undefined || value === '') return NOT_RECORDED;
  return `${esc(value)}${suffix}`;
}

function naira(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_RECORDED;
  return `₦${Number(value).toLocaleString('en-NG')}`;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return NOT_RECORDED;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NOT_RECORDED;
  return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Result pill for the eight data-verification checks. */
function resultPill(result: string): string {
  const label =
    result === 'pass' ? 'Pass' : result === 'partial' ? 'Partial' : result === 'flag' ? 'Flag' : 'Missing';
  return `<span class="pill pill-${esc(result)}">${label}</span>`;
}

const STYLES = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Manrope, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: #1A1A1A; font-size: 10.5px; line-height: 1.45; margin: 0;
  }
  .page-break { page-break-before: always; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #2E8B57; padding-bottom: 8px; margin-bottom: 10px; }
  .title { font-size: 17px; font-weight: 800; color: #2E8B57; margin: 0; }
  .subtitle { font-size: 10px; color: #667085; margin: 2px 0 0; }
  .brand { font-size: 10px; font-weight: 700; text-align: right; color: #2E8B57; }
  .meta { display: flex; gap: 10px; flex-wrap: wrap; background: #F6F8F7;
          border-radius: 6px; padding: 7px 10px; margin-bottom: 10px; }
  .meta div { font-size: 9px; }
  .meta b { display: block; color: #667085; font-weight: 600; text-transform: uppercase;
            letter-spacing: .4px; font-size: 8px; }
  h2 { font-size: 11.5px; font-weight: 800; margin: 12px 0 5px;
       text-transform: uppercase; letter-spacing: .4px; color: #2E8B57; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ECEFEC;
           vertical-align: top; font-size: 9.5px; }
  th { background: #F6F8F7; font-weight: 700; color: #475467; font-size: 8.5px;
       text-transform: uppercase; letter-spacing: .3px; }
  td.num, th.num { text-align: right; }
  .muted { color: #98A2B3; font-style: italic; }
  .score-row { display: flex; gap: 10px; align-items: stretch; margin-bottom: 8px; }
  .score-box { border: 2px solid #2E8B57; border-radius: 8px; padding: 9px 12px;
               text-align: center; min-width: 110px; }
  .score-value { font-size: 26px; font-weight: 800; color: #2E8B57; line-height: 1; }
  .score-outof { font-size: 9px; color: #667085; }
  .score-tier { font-size: 11px; font-weight: 800; margin-top: 3px; }
  .score-side { flex: 1; background: #F6F8F7; border-radius: 8px; padding: 9px 12px; }
  .provisional { display: inline-block; background: #FFF4E5; color: #87540E;
                 border-radius: 4px; padding: 1px 6px; font-size: 8.5px; font-weight: 700; }
  .pill { display: inline-block; border-radius: 4px; padding: 1px 6px;
          font-size: 8.5px; font-weight: 700; }
  .pill-pass { background: #E7F4EC; color: #1A7F४3; }
  .pill-partial { background: #FFF4E5; color: #87540E; }
  .pill-flag { background: #FDECEC; color: #B42318; }
  .pill-missing { background: #F2F4F7; color: #667085; }
  .two-col { display: flex; gap: 12px; }
  .two-col > div { flex: 1; }
  .note { font-size: 9px; color: #667085; margin: 4px 0 0; }
  .footer { margin-top: 12px; border-top: 1px solid #ECEFEC; padding-top: 7px;
            font-size: 8.5px; color: #667085; }
  .confidential { font-weight: 800; color: #B42318; letter-spacing: .5px; }
`.replace('#1A7F४3', '#1A7F43');

function metaBlock(meta: CreditReport['meta']): string {
  return `
  <div class="meta">
    <div><b>Report ID</b>${esc(meta.reportId)}</div>
    <div><b>Issued</b>${shortDate(meta.issuedAt)}</div>
    <div><b>Valid until</b>${shortDate(meta.validUntil)}</div>
    <div><b>Model</b>${esc(meta.modelVersion)}</div>
  </div>`;
}

function farmerPageOne(report: CreditReport): string {
  const { subject, assessment, capacity, exposure } = report;

  const componentRows = assessment.components
    .map(
      (c) => `
      <tr>
        <td><b>${esc(c.name)}</b></td>
        <td>${esc(c.weight)}</td>
        <td class="num">${c.score === null ? NOT_RECORDED : `${esc(c.score)} / ${esc(c.outOf)}`}</td>
        <td>${esc(c.evidence)}</td>
      </tr>`,
    )
    .join('');

  return `
  <div class="head">
    <div>
      <p class="title">Farmer Credit Report</p>
      <p class="subtitle">Financing readiness assessment for smallholder farmers</p>
    </div>
    <div class="brand">Heabron CoopScore</div>
  </div>

  ${metaBlock(report.meta)}

  <table>
    <tr>
      <th>Farmer</th><th>Gender</th><th>Phone</th><th>Cooperative</th><th>Location</th>
    </tr>
    <tr>
      <td><b>${show(subject.fullName)}</b></td>
      <td>${show(subject.gender)}</td>
      <td>${show(subject.phoneMasked)}</td>
      <td>${show(subject.cooperative)}</td>
      <td>${show(subject.location)}</td>
    </tr>
    <tr>
      <th>Farm size</th><th>Crops</th><th>Ownership</th><th>Water</th><th>Experience</th>
    </tr>
    <tr>
      <td>${subject.farm.sizeAcres ? `${esc(subject.farm.sizeAcres)} acres` : NOT_RECORDED}</td>
      <td>${subject.farm.crops.length ? esc(subject.farm.crops.join(', ')) : NOT_RECORDED}</td>
      <td>${show(subject.farm.ownership)}</td>
      <td>${show(subject.farm.waterSource)}</td>
      <td>${subject.farm.farmingExperienceYears != null ? `${esc(subject.farm.farmingExperienceYears)} yrs` : NOT_RECORDED}</td>
    </tr>
  </table>

  <h2>1. Credit assessment</h2>
  <div class="score-row">
    <div class="score-box">
      <div class="score-value">${esc(assessment.finalScore)}</div>
      <div class="score-outof">out of ${esc(assessment.outOf)}</div>
      <div class="score-tier">Tier ${esc(assessment.tier)}: ${esc(assessment.tierLabel)}</div>
      ${assessment.provisional ? '<div class="provisional">Provisional</div>' : ''}
    </div>
    <div class="score-side">
      <div><b>Decision guide.</b> ${esc(assessment.guidance)}</div>
      <div class="note"><b>Data confidence:</b> ${esc(assessment.dataConfidence)}
        (${esc(report.verification.score)} of ${esc(report.verification.outOf)} checks passed).</div>
      ${assessment.provisionalNote ? `<div class="note">${esc(assessment.provisionalNote)}</div>` : ''}
      <div class="note"><b>Bands:</b> ${esc(assessment.bands)}</div>
    </div>
  </div>

  <table>
    <tr><th>Component</th><th>Weight</th><th class="num">Score</th><th>Evidence</th></tr>
    ${componentRows}
  </table>

  <h2>2. Income and repayment capacity (illustrative)</h2>
  <table>
    <tr><th>Item</th><th class="num">Value</th><th>Basis</th></tr>
    <tr>
      <td>Average seasonal yield</td>
      <td class="num">${capacity.averageSeasonalYieldKg ? `${esc(capacity.averageSeasonalYieldKg)} kg` : NOT_RECORDED}</td>
      <td>Mean of ${esc(capacity.seasonsUsed)} recorded season(s)</td>
    </tr>
    <tr>
      <td>Estimated seasonal sales</td>
      <td class="num">${naira(capacity.estimatedSeasonalSalesNgn)}</td>
      <td>${esc(capacity.priceBasis)}</td>
    </tr>
    <tr>
      <td>Production cost / net income</td>
      <td class="num">${NOT_RECORDED}</td>
      <td>${esc(capacity.productionCostBasis)}</td>
    </tr>
    <tr>
      <td><b>Starter limit</b></td>
      <td class="num"><b>${naira(capacity.starterLimitNgn)}</b></td>
      <td>${esc(capacity.starterLimitBasis)}</td>
    </tr>
  </table>
  <p class="note">Figures in this section are illustrative and derived from recorded data, not a credit offer.</p>

  <h2>3. Credit history and exposure</h2>
  <table>
    <tr><th>Active loans</th><th>Settled loans</th><th>Overdue</th><th>External bureau check</th></tr>
    <tr>
      <td>${esc(exposure.activeLoans)}</td>
      <td>${esc(exposure.settledLoans)}</td>
      <td>${esc(exposure.overdueLoans)}</td>
      <td>${esc(exposure.externalBureauCheck)}</td>
    </tr>
  </table>
  ${exposure.note ? `<p class="note">${esc(exposure.note)}</p>` : ''}
  `;
}

function farmerPageTwo(report: CreditReport): string {
  const { productionRecord, verification, scoreHistory, subject } = report;

  const seasonRows = productionRecord.seasons.length
    ? productionRecord.seasons
        .map(
          (s) => `
      <tr>
        <td>${show(s.season)}</td>
        <td class="num">${s.expectedKg ?? NOT_RECORDED}</td>
        <td class="num">${s.actualKg ?? NOT_RECORDED}</td>
        <td class="num">${show(s.actualVsExpected)}</td>
        <td class="num">${s.yieldPerAcreKg ?? NOT_RECORDED}</td>
        <td class="num">${s.deliveredKg ?? NOT_RECORDED}</td>
        <td class="num">${show(s.shareSold)}</td>
        <td>${show(s.quality)}</td>
        <td>${show(s.payment)}</td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="9" class="muted">No seasons recorded yet.</td></tr>';

  const half = Math.ceil(verification.checks.length / 2);
  const checkRows = Array.from({ length: half })
    .map((_, i) => {
      const left = verification.checks[i];
      const right = verification.checks[i + half];
      const cell = (c?: (typeof verification.checks)[number]) =>
        c
          ? `<td>${esc(c.id)} ${esc(c.label)}</td><td>${resultPill(c.result)}${
              c.detail ? `<div class="note">${esc(c.detail)}</div>` : ''
            }</td>`
          : '<td></td><td></td>';
      return `<tr>${cell(left)}${cell(right)}</tr>`;
    })
    .join('');

  const historyRows = scoreHistory.length
    ? scoreHistory
        .map(
          (h) => `
      <tr>
        <td>${show(h.date)}</td>
        <td class="num">${h.score ?? NOT_RECORDED}</td>
        <td>${show(h.tier)}</td>
        <td>${show(h.reason)}</td>
        <td>${show(h.modelVersion)}</td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No score history recorded.</td></tr>';

  return `
  <div class="page-break"></div>
  <div class="head">
    <div>
      <p class="title">Supporting record</p>
      <p class="subtitle">${esc(subject.fullName)} &middot; ${esc(report.meta.reportId)}</p>
    </div>
    <div class="brand">Heabron CoopScore</div>
  </div>

  <h2>4. Production and market record</h2>
  <table>
    <tr>
      <th>Season</th><th class="num">Expected (kg)</th><th class="num">Actual (kg)</th>
      <th class="num">Actual vs expected</th><th class="num">Yield / acre</th>
      <th class="num">Delivered (kg)</th><th class="num">Share sold</th>
      <th>Quality</th><th>Payment</th>
    </tr>
    ${seasonRows}
    <tr>
      <td><b>Total</b></td><td></td>
      <td class="num"><b>${productionRecord.totals.actualKg || NOT_RECORDED}</b></td>
      <td></td>
      <td class="num">${productionRecord.totals.averageYieldPerAcreKg ?? NOT_RECORDED}</td>
      <td class="num"><b>${productionRecord.totals.deliveredKg || NOT_RECORDED}</b></td>
      <td class="num">${show(productionRecord.totals.shareSold)}</td>
      <td></td><td></td>
    </tr>
  </table>

  <h2>5. Data verification</h2>
  <table>
    <tr><th>Check</th><th>Result</th><th>Check</th><th>Result</th></tr>
    ${checkRows}
  </table>
  <p class="note">
    <b>${esc(verification.score)} of ${esc(verification.outOf)} checks passed
    (${esc(verification.confidence)} confidence).</b> ${esc(verification.note)}
  </p>

  <h2>6. Score history</h2>
  <table>
    <tr><th>Date</th><th class="num">Score</th><th>Tier</th><th>Reason</th><th>Model</th></tr>
    ${historyRows}
  </table>

  <h2>7. Consent</h2>
  <table>
    <tr><th>Consent recorded</th><th>Status</th><th>Sharing with partners</th></tr>
    <tr>
      <td>${subject.consent.recorded ? 'Yes' : 'No'}</td>
      <td>${show(subject.consent.status)}</td>
      <td>${subject.consent.thirdPartySharing ? 'Permitted' : 'Not permitted'}</td>
    </tr>
  </table>
  <p class="note">
    The farmer or cooperative can request a correction, or withdraw consent, through Heabron support.
  </p>

  <div class="footer">
    <p class="confidential">CONFIDENTIAL — FOR AUTHORISED USE ONLY</p>
    <p>${esc(report.meta.disclaimer)}</p>
  </div>
  `;
}

export function renderFarmerReportHtml(report: CreditReport): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><style>${STYLES}</style></head>
  <body>${farmerPageOne(report)}${farmerPageTwo(report)}</body></html>`;
}

export function renderCooperativeReportHtml(report: CooperativeCreditReport): string {
  const { subject, assessment, membership } = report;
  return `<!doctype html><html><head><meta charset="utf-8"/><style>${STYLES}</style></head><body>
  <div class="head">
    <div>
      <p class="title">Cooperative Credit Report</p>
      <p class="subtitle">Group financing readiness assessment</p>
    </div>
    <div class="brand">Heabron CoopScore</div>
  </div>

  ${metaBlock(report.meta)}

  <table>
    <tr><th>Cooperative</th><th>Registration number</th><th>Location</th></tr>
    <tr>
      <td><b>${show(subject.name)}</b></td>
      <td>${show(subject.registrationNumber)}</td>
      <td>${show(subject.location)}</td>
    </tr>
  </table>

  <h2>1. Credit assessment</h2>
  <div class="score-row">
    <div class="score-box">
      <div class="score-value">${esc(assessment.averageScore)}</div>
      <div class="score-outof">out of ${esc(assessment.outOf)}</div>
      <div class="score-tier">Tier ${esc(assessment.tier)}: ${esc(assessment.tierLabel)}</div>
    </div>
    <div class="score-side">
      <div><b>Decision guide.</b> ${esc(assessment.guidance)}</div>
      <div class="note">${esc(assessment.basis)}</div>
      <div class="note"><b>Bands:</b> ${esc(assessment.bands)}</div>
    </div>
  </div>

  <h2>2. Membership</h2>
  <table>
    <tr><th class="num">Farmers</th><th class="num">Scored</th><th class="num">Not yet scored</th><th class="num">First cycle</th></tr>
    <tr>
      <td class="num">${esc(membership.totalFarmers)}</td>
      <td class="num">${esc(membership.scoredFarmers)}</td>
      <td class="num">${esc(membership.unscoredFarmers)}</td>
      <td class="num">${esc(membership.firstCycleFarmers)}</td>
    </tr>
  </table>

  <h2>3. Tier distribution</h2>
  <table>
    <tr><th class="num">Tier A</th><th class="num">Tier B</th><th class="num">Tier C</th><th class="num">Tier D</th></tr>
    <tr>
      <td class="num">${esc(membership.tierCounts.A)}</td>
      <td class="num">${esc(membership.tierCounts.B)}</td>
      <td class="num">${esc(membership.tierCounts.C)}</td>
      <td class="num">${esc(membership.tierCounts.D)}</td>
    </tr>
  </table>

  <h2>4. Consent</h2>
  <table>
    <tr><th>Consent recorded</th><th>Status</th><th>Sharing with partners</th></tr>
    <tr>
      <td>${subject.consent.recorded ? 'Yes' : 'No'}</td>
      <td>${show(subject.consent.status)}</td>
      <td>${subject.consent.thirdPartySharing ? 'Permitted' : 'Not permitted'}</td>
    </tr>
  </table>

  <div class="footer">
    <p class="confidential">CONFIDENTIAL — FOR AUTHORISED USE ONLY</p>
    <p>${esc(report.meta.disclaimer)}</p>
  </div>
  </body></html>`;
}

/** Renders and shares the farmer report. */
export async function exportFarmerReportPdf(report: CreditReport): Promise<void> {
  const html = renderFarmerReportHtml(report);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Credit report — ${report.subject.fullName}`,
      UTI: 'com.adobe.pdf',
    });
  }
}

/** Renders and shares the cooperative report. */
export async function exportCooperativeReportPdf(
  report: CooperativeCreditReport,
): Promise<void> {
  const html = renderCooperativeReportHtml(report);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: `Credit report — ${report.subject.name}`,
      UTI: 'com.adobe.pdf',
    });
  }
}
