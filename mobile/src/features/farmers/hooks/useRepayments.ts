/**
 * Repayment queries and the create mutation — replaces
 * `RecordRepaymentController`.
 *
 * FIXED — `init` bailed out when `farmer.cooperativeId == null`, so a farmer
 * with no cooperative silently showed an empty picker with no explanation. The
 * query here keys off the farmer id alone, which is all
 * `GET /agent/financing-requests?farmerId=` needs, and the screen renders the
 * "no active financing requests" state instead of a blank dropdown.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import {
  createRepayment,
  fetchFarmerFinancingRequests,
  farmerLists,
} from '../api/farmersApi';
import {
  isRepayable,
  type FarmerFinancingRequest,
  type Repayment,
  type RepaymentFormInput,
  type RepaymentResult,
} from '../model/repayment';

/**
 * The financing requests a repayment can be recorded against.
 *
 * `repayments.controller.create` rejects anything that is not `approved` or
 * `disbursed` with a 400, so unrepayable requests are filtered out of the
 * picker rather than offered and then refused.
 */
export function useFarmerFinancingRequests(farmerId: string) {
  const query = useQuery({
    queryKey: qk.financingRequests({ farmerId }),
    queryFn: () => fetchFarmerFinancingRequests(farmerId, { pageSize: 100 }),
    enabled: farmerId.length > 0,
  });

  const all: FarmerFinancingRequest[] = query.data?.items ?? [];

  return {
    requests: all.filter(isRepayable),
    /** Every request, for the "you have loans but none are repayable" case. */
    allRequests: all,
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

/** `GET /agent/repayments` — implemented in Dart, never called. */
export function useRepayments(params: { startDate?: string; endDate?: string } = {}) {
  return usePaginatedList<Repayment>({
    queryKey: qk.repayments(params),
    url: farmerLists.repayments.url,
    params,
    select: farmerLists.repayments.parse,
  });
}

/** `POST /agent/repayments` */
export function useCreateRepayment(farmerId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation<RepaymentResult, unknown, RepaymentFormInput>({
    mutationFn: createRepayment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['repayments'] });
      void queryClient.invalidateQueries({ queryKey: ['financing-requests'] });
      // A repayment rescores the farmer (`safeRecalculateFarmer`).
      void queryClient.invalidateQueries({ queryKey: qk.farmerCreditScore(farmerId) });
      void queryClient.invalidateQueries({ queryKey: qk.farmer(farmerId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
    },
  });

  return {
    record: mutation.mutate,
    recordAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    result: mutation.data ?? null,
    error: mutation.error,
  };
}
