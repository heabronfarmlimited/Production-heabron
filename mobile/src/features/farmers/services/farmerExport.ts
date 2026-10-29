/**
 * Farmer PDF export — replaces `FarmerExportService.exportFarmerPdf`
 * (`pdf` + `printing` -> `expo-print` + `expo-sharing`).
 *
 * **No fabricated data.** The Dart version shipped three pieces of invented
 * content straight to users:
 *
 *  1. a `455` fallback for land size whenever the farmer had no farm profile;
 *  2. five hardcoded financing rows (`FN-34055`…`FN-34059`, ₦25,000,
 *     `Approved`) rendered whenever `financingHistory` was null — and the only
 *     caller never passed it, so they *always* rendered;
 *  3. an entirely hardcoded Repayments table (`LN-34055`, `'25kg Rice'`,
 *     `'50kg Beans'`) with no data source at all.
 *
 * Here each section renders only rows the caller supplies and shows an empty
 * state otherwise. The layout, section order and headings are kept.
 *
 * The Dart service also loaded the Manrope TTFs through a commented-out
 * `rootBundle.load`, so its PDFs rendered in Helvetica. The HTML below asks for
 * Manrope and falls back to the system sans — the same practical result,
 * without the dead code.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { formatNaira, titleCase } from '../../../core/utils/format';
import { resolveCrops, resolveFarm, type Farmer } from '../model/farmer';
import type { ProductionYield } from '../model/productionYield';
import type { FarmerFinancingRequest, Repayment } from '../model/repayment';

export interface FarmerExportInput {
  farmer: Farmer;
  /** Real financing requests, if the caller has them. */
  financingHistory?: FarmerFinancingRequest[];
  /** Real repayment records, if the caller has them. */
  repayments?: Repayment[];
  /** Real seasonal yields, if the caller has them. */
  productions?: ProductionYield[];
}

/** Brand colours, matching the Dart `PdfColor` constants. */
const GREEN = '#2E8555';
const LIGHT_GREY = '#F8F9FA';
const BORDER = '#E5E7EB';
const GREY_TEXT = '#616161';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** `DateFormat('dd-MM-yyyy')` */
function formatDdMmYyyy(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = `${d.getDate()}`.padStart(2, '0');
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
}

function statTile(value: string, label: string): string {
  return `
    <div class="tile">
      <div class="tile-value">${escapeHtml(value)}</div>
      <div class="tile-label">${escapeHtml(label)}</div>
    </div>`;
}

function emptyRow(columns: number, message: string): string {
  return `<tr><td class="empty" colspan="${columns}">${escapeHtml(message)}</td></tr>`;
}

function table(
  headers: readonly string[],
  rows: readonly string[][],
  emptyMessage: string,
): string {
  const head = headers.map((hd) => `<th>${escapeHtml(hd)}</th>`).join('');
  const body =
    rows.length > 0
      ? rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
          )
          .join('')
      : emptyRow(headers.length, emptyMessage);

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function buildFarmerExportHtml(input: FarmerExportInput): string {
  const { farmer, financingHistory = [], repayments = [], productions = [] } = input;

  const farm = resolveFarm(farmer);
  const crops = resolveCrops(farmer);

  const farmerName = farmer.fullName ? titleCase(farmer.fullName) : '-';
  const coopScore = farmer.creditScore;
  const coopName = farmer.cooperative?.name ? titleCase(farmer.cooperative.name) : '—';

  // No `455` fallback — an unknown land size is shown as a dash.
  const landSize = farm?.farmSizeAcres != null ? `${farm.farmSizeAcres}` : '—';
  const exportedOn = formatDdMmYyyy(new Date().toISOString());

  const cropChips =
    crops.length > 0
      ? crops
          .map((crop) => `<div class="chip">${escapeHtml(titleCase(crop))}</div>`)
          .join('')
      : '<div class="chip chip-empty">No crops recorded</div>';

  const financingRows = financingHistory.map((item, index) => [
    `${index + 1}`,
    item.id,
    formatNaira(item.approvedAmount ?? item.loanAmount, { decimals: false }),
    formatDdMmYyyy(item.createdAt),
    item.status ? titleCase(item.status) : '—',
  ]);

  const repaymentRows = repayments.map((item, index) => [
    `${index + 1}`,
    item.financingRequestId ?? '—',
    formatNaira(item.amountPaid, { decimals: false }),
    formatDdMmYyyy(item.paymentDate),
    item.paymentMethod ? titleCase(item.paymentMethod) : '—',
  ]);

  const yieldRows = productions.map((item, index) => [
    `${index + 1}`,
    item.season.toUpperCase(),
    titleCase(item.crop),
    item.expectedYieldTonnes != null ? `${item.expectedYieldTonnes} t` : '—',
    item.actualYieldTonnes != null ? `${item.actualYieldTonnes} t` : '—',
    item.verificationStatus ? titleCase(item.verificationStatus) : '—',
  ]);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(farmerName)} — Data export</title>
    <style>
      @page { margin: 32px; }
      body {
        font-family: Manrope, -apple-system, 'Helvetica Neue', Helvetica, sans-serif;
        color: #000;
        font-size: 12px;
        margin: 0;
      }
      .header { display: flex; justify-content: space-between; align-items: flex-start; }
      .brand { font-size: 20px; font-weight: 700; color: ${GREEN}; letter-spacing: .5px; }
      .meta { text-align: right; }
      .meta h1 { font-size: 20px; font-weight: 700; color: ${GREEN}; margin: 0; }
      .meta p { color: ${GREY_TEXT}; margin: 8px 0 0; }
      .identity p { margin: 4px 0 0; }
      h2 { font-size: 18px; font-weight: 700; margin: 32px 0 16px; }
      .tiles { display: flex; gap: 12px; }
      .tile {
        flex: 1; background: ${LIGHT_GREY}; border-radius: 8px;
        padding: 16px 12px; text-align: center;
      }
      .tile-value { font-size: 16px; font-weight: 700; }
      .tile-label { font-size: 11px; color: ${GREY_TEXT}; margin-top: 6px; }
      .chips { display: flex; flex-wrap: wrap; gap: 12px; }
      .chip {
        background: ${LIGHT_GREY}; border-radius: 8px;
        padding: 14px 18px; font-size: 14px;
      }
      .chip-empty { color: ${GREY_TEXT}; font-style: italic; }
      table { width: 100%; border-collapse: collapse; }
      th {
        background: ${GREEN}; color: #fff; font-size: 11px; font-weight: 700;
        text-align: left; padding: 12px;
      }
      td { font-size: 11px; padding: 12px; border-bottom: 1px solid ${BORDER}; }
      td.empty { color: ${GREY_TEXT}; font-style: italic; text-align: center; }
      .pairs { width: 100%; border-collapse: collapse; }
      .pairs td { border-bottom: 1px solid ${BORDER}; }
      .pairs td:first-child { color: ${GREY_TEXT}; width: 45%; }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="identity">
        <div class="brand">CoopScore</div>
        <p>Farmer name: ${escapeHtml(farmerName)}</p>
        <p>CoopScore: ${coopScore == null ? '—' : coopScore}</p>
      </div>
      <div class="meta">
        <h1>Data export</h1>
        <p>Date: ${escapeHtml(exportedOn)}</p>
      </div>
    </div>

    <h2>Data</h2>
    <div class="tiles">
      ${statTile(coopName, 'Cooperative')}
      ${statTile(`${crops.length}`, 'Crops')}
      ${statTile(landSize, 'LandSize(Acres)')}
    </div>

    <h2>Farmer details</h2>
    <table class="pairs">
      <tr><td>Phone</td><td>${escapeHtml(farmer.phone ?? '—')}</td></tr>
      <tr><td>Gender</td><td>${escapeHtml(farmer.gender ? titleCase(farmer.gender) : '—')}</td></tr>
      <tr><td>Date of Birth</td><td>${escapeHtml(farmer.dateOfBirth ?? '—')}</td></tr>
      <tr><td>NIN</td><td>${escapeHtml(farmer.nin ?? '—')}</td></tr>
      <tr><td>NIN Status</td><td>${escapeHtml(
        farmer.ninVerificationStatus ? titleCase(farmer.ninVerificationStatus) : 'Pending',
      )}</td></tr>
      <tr><td>Credit Tier</td><td>${escapeHtml(farmer.creditTier ?? '—')}</td></tr>
      <tr><td>Soil Type</td><td>${escapeHtml(farm?.soilType ? titleCase(farm.soilType) : '—')}</td></tr>
      <tr><td>Water Source</td><td>${escapeHtml(
        farm?.waterSource ? titleCase(farm.waterSource) : '—',
      )}</td></tr>
      <tr><td>Land Ownership</td><td>${escapeHtml(
        farm?.landOwnership ? titleCase(farm.landOwnership) : '—',
      )}</td></tr>
      <tr><td>Years Experience</td><td>${
        farm?.yearsExperience != null ? `${farm.yearsExperience} years` : '—'
      }</td></tr>
    </table>

    <h2>Crops</h2>
    <div class="chips">${cropChips}</div>

    <h2>Seasonal yields</h2>
    ${table(
      [' ', 'Season', 'Crop', 'Expected', 'Actual', 'Status'],
      yieldRows,
      'No seasonal yield records found.',
    )}

    <h2>Financing requests</h2>
    ${table(
      [' ', 'Loan Ref', 'Amount', 'Date', 'Status'],
      financingRows,
      'No financing requests found.',
    )}

    <h2>Repayments</h2>
    ${table(
      [' ', 'Loan Ref', 'Amount Paid', 'Date', 'Method'],
      repaymentRows,
      'No repayments recorded.',
    )}
  </body>
</html>`;
}

/**
 * Renders the PDF and opens the share sheet — `Printing.sharePdf`.
 * Filename matches the Dart pattern: `<Name>_<epochMs>_report.pdf`.
 */
export async function exportFarmerPdf(input: FarmerExportInput): Promise<void> {
  const html = buildFarmerExportHtml(input);
  const { uri } = await Print.printToFileAsync({ html });

  const safeName = (input.farmer.fullName ?? 'farmer').replace(/\s+/g, '_');

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: `${safeName}_${Date.now()}_report.pdf`,
    });
  }
}
