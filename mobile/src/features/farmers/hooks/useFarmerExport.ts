/**
 * Farmer PDF export, with its data gathered on demand.
 *
 * The Flutter call site was `FarmerExportService.exportFarmerPdf(farmer)` — no
 * financing history, no repayments, no yields. The service filled those gaps
 * with five hardcoded financing rows and a completely invented repayments
 * table, both of which therefore shipped in every exported PDF.
 *
 * This fetches the three real lists first and hands them to the renderer. When
 * a fetch fails the section renders its empty state; nothing is ever invented.
 */
import { useState } from 'react';

import { showApiError } from '../../../core/utils/toast';
import {
  fetchFarmerFinancingRequests,
  fetchProductions,
  fetchRepayments,
} from '../api/farmersApi';
import type { Farmer } from '../model/farmer';
import type { ProductionYield } from '../model/productionYield';
import type { FarmerFinancingRequest, Repayment } from '../model/repayment';
import { exportFarmerPdf } from '../services/farmerExport';

/** One page is plenty for a report; `pageSize` is capped at 100 server-side. */
const EXPORT_PAGE_SIZE = 100;

async function settled<T>(promise: Promise<T[]>): Promise<T[]> {
  try {
    return await promise;
  } catch {
    // A missing section is an empty section, never a fabricated one.
    return [];
  }
}

export function useFarmerExport() {
  const [isPending, setIsPending] = useState(false);

  const exportFarmer = async (farmer: Farmer): Promise<void> => {
    setIsPending(true);
    try {
      const [productions, financingHistory, repayments] = await Promise.all([
        settled<ProductionYield>(
          fetchProductions({ farmerId: farmer.id, pageSize: EXPORT_PAGE_SIZE }).then(
            (page) => page.items,
          ),
        ),
        settled<FarmerFinancingRequest>(
          fetchFarmerFinancingRequests(farmer.id, {
            pageSize: EXPORT_PAGE_SIZE,
          }).then((page) => page.items),
        ),
        settled<Repayment>(
          // `repayments.list` filters by agent and date only — not by farmer —
          // so the farmer's rows are selected here.
          fetchRepayments({ pageSize: EXPORT_PAGE_SIZE }).then((page) =>
            page.items.filter((row) => row.farmerId === farmer.id && !row.voided),
          ),
        ),
      ]);

      await exportFarmerPdf({ farmer, productions, financingHistory, repayments });
    } catch (err) {
      showApiError(err, 'Could not export this farmer');
    } finally {
      setIsPending(false);
    }
  };

  return { exportFarmer, isPending };
}
