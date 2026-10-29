/**
 * "Export Data" — a real replacement for `CooperativeExportService`.
 *
 * The Dart service was 500 LOC (11% of the module) whose only call site was
 * commented out, so the `Export Data` row was a no-op. It is not ported: its
 * "Repayments" and "Financing requests" stat tiles were the string literals
 * `'76'` and `'12'`, and its tables were hardcoded sample rows. Shipping that
 * would have put invented figures in a document an agent hands to a farmer.
 *
 * This renders only values the API returned — the cooperative record, every
 * farmer page, and every financing request — and prints an explicit empty
 * state wherever there is no data, rather than filling the gap.
 *
 * expo-print renders the HTML to a PDF; expo-sharing hands it to the OS share
 * sheet, which is what the Dart version's `Printing.sharePdf` did.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';

import { formatDate, formatNaira, titleCase } from '../../../core/utils/format';
import { showApiError, showError, showInfo } from '../../../core/utils/toast';
import type { Farmer } from '../../farmers/model/farmer';
import { resolveFarm } from '../../farmers/model/farmer';
import * as cooperativesApi from '../api/cooperativesApi';
import {
  cooperativeFarmerCount,
  cooperativeLocation,
  type Cooperative,
} from '../model/cooperative';
import type { FinancingHistoryItem } from '../model/financing';

/** Guard against an unbounded loop if `meta` ever disagrees with itself. */
const MAX_PAGES = 50;
const PAGE_SIZE = 100;

/** Minimal HTML escaping — every interpolated value goes through it. */
function esc(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** An em-dash for an absent value, matching the detail screens. */
const DASH = '—';
const show = (value: unknown): string => {
  if (value == null) return DASH;
  const text = String(value).trim();
  return text.length > 0 ? esc(text) : DASH;
};

async function fetchAllPages<T>(
  load: (page: number) => Promise<{ items: T[]; meta?: { totalPages: number } }>,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await load(page);
    all.push(...result.items);
    totalPages = result.meta?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages && page <= MAX_PAGES);

  return all;
}

// --------------------------------------------------------------- rendering
function farmerRow(farmer: Farmer): string {
  const farm = resolveFarm(farmer);
  const location = [farmer.lga, farmer.state].filter(Boolean).join(', ');

  return `
    <tr>
      <td>${show(farmer.fullName ? titleCase(farmer.fullName) : null)}</td>
      <td>${show(farmer.phone)}</td>
      <td>${show(location)}</td>
      <td>${show(farm?.cropType ? titleCase(farm.cropType) : null)}</td>
      <td class="num">${farm?.farmSizeAcres != null ? esc(farm.farmSizeAcres) : DASH}</td>
      <td class="num">${farmer.creditScore != null ? esc(farmer.creditScore) : DASH}</td>
      <td class="num">${show(farmer.creditTier?.toUpperCase())}</td>
    </tr>`;
}

function financingRow(item: FinancingHistoryItem): string {
  return `
    <tr>
      <td>${show(item.loanRef)}</td>
      <td>${show(item.farmerName ? titleCase(item.farmerName) : null)}</td>
      <td class="num">${esc(formatNaira(item.amount, { decimals: false }))}</td>
      <td class="num">${
        item.approvedAmount != null
          ? esc(formatNaira(item.approvedAmount, { decimals: false }))
          : DASH
      }</td>
      <td>${show(item.status ? titleCase(item.status) : null)}</td>
      <td>${item.date ? esc(formatDate(item.date)) : DASH}</td>
    </tr>`;
}

function emptyRow(colSpan: number, message: string): string {
  return `<tr><td class="empty" colspan="${colSpan}">${esc(message)}</td></tr>`;
}

function buildHtml(
  cooperative: Cooperative,
  farmers: readonly Farmer[],
  financing: readonly FinancingHistoryItem[],
): string {
  const crops =
    cooperative.cropsSupported.length > 0
      ? cooperative.cropsSupported.map((c) => `<span class="chip">${esc(titleCase(c))}</span>`).join('')
      : `<span class="muted">No crops specified</span>`;

  const gps =
    cooperative.gpsLat != null && cooperative.gpsLng != null
      ? `${esc(cooperative.gpsLat)}, ${esc(cooperative.gpsLng)}`
      : DASH;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
        color: #131313;
        margin: 0;
        padding: 28px;
        font-size: 11px;
      }
      h1 { font-size: 20px; margin: 0 0 2px; }
      h2 {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: #6B7280;
        margin: 26px 0 8px;
        border-bottom: 1px solid #E4E4E4;
        padding-bottom: 5px;
      }
      .sub { color: #2E8B57; font-size: 12px; margin: 0 0 2px; }
      .meta { color: #6B7280; font-size: 10px; }
      .grid { display: flex; flex-wrap: wrap; margin: 0 -6px; }
      .cell { width: 50%; padding: 5px 6px; }
      .label { color: #6B7280; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; }
      .value { font-size: 12px; font-weight: 600; }
      .chip {
        display: inline-block;
        background: #E8F3ED;
        color: #2E8B57;
        border-radius: 6px;
        padding: 3px 9px;
        margin: 0 5px 5px 0;
        font-size: 10px;
        font-weight: 600;
      }
      .muted { color: #A2A2A2; font-style: italic; }
      table { width: 100%; border-collapse: collapse; }
      th {
        text-align: left;
        background: #F2F2F2;
        color: #374151;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 7px 8px;
        border-bottom: 1px solid #E4E4E4;
      }
      td { padding: 7px 8px; border-bottom: 1px solid #F2F2F2; vertical-align: top; }
      td.num { text-align: right; white-space: nowrap; }
      td.empty { text-align: center; color: #A2A2A2; font-style: italic; padding: 18px 8px; }
      .footer { margin-top: 28px; color: #A2A2A2; font-size: 9px; }
    </style>
  </head>
  <body>
    <h1>${show(titleCase(cooperative.name) || cooperative.name)}</h1>
    <p class="sub">${show(cooperativeLocation(cooperative))}</p>
    <p class="meta">Exported ${esc(formatDate(new Date().toISOString()))}</p>

    <h2>Cooperative Profile</h2>
    <div class="grid">
      <div class="cell"><div class="label">Registration number</div><div class="value">${show(cooperative.registrationNumber)}</div></div>
      <div class="cell"><div class="label">Cooperative tier</div><div class="value">${show(cooperative.cooperativeTier.toUpperCase())}</div></div>
      <div class="cell"><div class="label">Leader</div><div class="value">${show(cooperative.leaderName)}</div></div>
      <div class="cell"><div class="label">Leader phone</div><div class="value">${show(cooperative.leaderPhone)}</div></div>
      <div class="cell"><div class="label">Address</div><div class="value">${show(cooperative.address)}</div></div>
      <div class="cell"><div class="label">GPS coordinates</div><div class="value">${gps}</div></div>
      <div class="cell"><div class="label">Land Size</div><div class="value">${esc(cooperative.estimatedLandSize)} Acres</div></div>
      <div class="cell"><div class="label">Farmers</div><div class="value">${esc(cooperativeFarmerCount(cooperative))}</div></div>
      <div class="cell"><div class="label">Average credit score</div><div class="value">${esc(cooperative.averageCreditScore)}</div></div>
      <div class="cell"><div class="label">Created</div><div class="value">${
        cooperative.createdAt ? esc(formatDate(cooperative.createdAt)) : DASH
      }</div></div>
    </div>

    <h2>Crop Types</h2>
    <div>${crops}</div>

    <h2>Farmers (${farmers.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Name</th><th>Phone</th><th>Location</th><th>Primary crop</th>
          <th style="text-align:right">Farm size</th>
          <th style="text-align:right">Score</th>
          <th style="text-align:right">Tier</th>
        </tr>
      </thead>
      <tbody>
        ${
          farmers.length > 0
            ? farmers.map(farmerRow).join('')
            : emptyRow(7, 'No farmers found for this cooperative')
        }
      </tbody>
    </table>

    <h2>Financing Requests (${financing.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Reference</th><th>Farmer</th>
          <th style="text-align:right">Requested</th>
          <th style="text-align:right">Approved</th>
          <th>Status</th><th>Submitted</th>
        </tr>
      </thead>
      <tbody>
        ${
          financing.length > 0
            ? financing.map(financingRow).join('')
            : emptyRow(6, 'No financing requests found.')
        }
      </tbody>
    </table>

    <p class="footer">
      CoopScore — generated from cooperative records. Figures reflect the data
      held for this cooperative at the time of export.
    </p>
  </body>
</html>`;
}

// ------------------------------------------------------------------- hook
export function useCooperativeExport(cooperative?: Cooperative | null) {
  const [exporting, setExporting] = useState(false);

  const exportData = useCallback(async () => {
    if (!cooperative || !cooperative.id) {
      // The Dart farmer export toasted 'No farmer data to export' in the
      // equivalent case; same shape of message for a cooperative.
      showError('No cooperative data to export');
      return;
    }

    setExporting(true);
    try {
      const [farmers, financing] = await Promise.all([
        fetchAllPages((page) =>
          cooperativesApi.fetchCooperativeFarmers(cooperative.id, {
            page,
            pageSize: PAGE_SIZE,
          }),
        ),
        fetchAllPages((page) =>
          cooperativesApi.fetchFinancingRequestsByCooperative(cooperative.id, {
            page,
            pageSize: PAGE_SIZE,
          }),
        ),
      ]);

      const { uri } = await Print.printToFileAsync({
        html: buildHtml(cooperative, farmers, financing),
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${cooperative.name} records`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        // Sharing is unavailable on some Android configurations; the file is
        // still written, so say where it went rather than failing silently.
        showInfo(`Saved to ${uri}`);
      }
    } catch (err) {
      showApiError(err, 'Could not export cooperative records.');
    } finally {
      setExporting(false);
    }
  }, [cooperative]);

  return { exportData, exporting };
}
