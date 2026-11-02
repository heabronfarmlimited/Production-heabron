import { api } from '../../../core/api/client';
import { endpoints } from '../../../core/api/endpoints';
import type { CooperativeCreditReport, CreditReport } from '../model/creditReport';

/**
 * The server returns the report already shaped for rendering, so there is no
 * parse step here: re-mapping it would be a second place for the shape to
 * drift from the document it implements.
 */
export function fetchFarmerCreditReport(farmerId: string): Promise<CreditReport> {
  return api.get<CreditReport>(endpoints.farmerCreditReport(farmerId));
}

export function fetchCooperativeCreditReport(
  cooperativeId: string,
): Promise<CooperativeCreditReport> {
  return api.get<CooperativeCreditReport>(endpoints.cooperativeCreditReport(cooperativeId));
}
