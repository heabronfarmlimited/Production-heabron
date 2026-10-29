/**
 * Production / seasonal-yield queries and mutations — replaces
 * `farmerProductionsProvider` and `RecordYieldsController`.
 *
 * `RecordYieldsController.submit` and `.updateProduction` were ~110 duplicated
 * lines apart from the repository call; one body builder and two mutations
 * replace both. `deleteProduction` existed but its only UI was commented out.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import {
  createProduction,
  deleteProduction,
  fetchProduction,
  updateProduction,
  farmerLists,
} from '../api/farmersApi';
import type { ProductionFormInput, ProductionYield } from '../model/productionYield';

/** `GET /agent/productions?farmerId=…` — infinite list, newest harvest first. */
export function useFarmerProductions(farmerId: string) {
  return usePaginatedList<ProductionYield>({
    queryKey: qk.productions({ farmerId }),
    url: farmerLists.productions.url,
    params: { farmerId },
    select: farmerLists.productions.parse,
    enabled: farmerId.length > 0,
  });
}

/**
 * `GET /agent/productions/:id`
 *
 * `productionByIdEndpoint` was declared in Dart but shadowed by a hardcoded
 * string, and the details screen took the whole `ProductionYield` through
 * route arguments with a force-cast that threw on a missing argument.
 */
export function useProduction(
  id: string,
  options: { initialData?: ProductionYield } = {},
) {
  const query = useQuery<ProductionYield>({
    queryKey: qk.production(id),
    queryFn: () => fetchProduction(id),
    enabled: id.length > 0,
    initialData: options.initialData,
  });

  return {
    production: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

/** Invalidates the farmer's production list, score and seasonal-yield summary. */
function useProductionInvalidation() {
  const queryClient = useQueryClient();

  return (farmerId: string, productionId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['productions'] });
    void queryClient.invalidateQueries({ queryKey: qk.farmerSeasonalYield(farmerId) });
    // A verified yield feeds the credit score (`safeRecalculateFarmer`).
    void queryClient.invalidateQueries({ queryKey: qk.farmerCreditScore(farmerId) });
    void queryClient.invalidateQueries({ queryKey: qk.farmer(farmerId) });
    if (productionId) {
      void queryClient.invalidateQueries({ queryKey: qk.production(productionId) });
    }
  };
}

/** `POST /agent/productions` */
export function useCreateProduction() {
  const invalidate = useProductionInvalidation();

  const mutation = useMutation<ProductionYield, unknown, ProductionFormInput>({
    mutationFn: createProduction,
    onSuccess: (production) => {
      invalidate(production.farmerId, production.id);
      showSuccess('Yield recorded successfully');
    },
  });

  return {
    create: mutation.mutate,
    createAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/** `PATCH /agent/productions/:id` */
export function useUpdateProduction(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useProductionInvalidation();

  const mutation = useMutation<ProductionYield, unknown, ProductionFormInput>({
    mutationFn: (input) => updateProduction(id, input),
    onSuccess: (production) => {
      queryClient.setQueryData(qk.production(id), production);
      invalidate(production.farmerId, id);
      showSuccess('Yield updated successfully');
    },
  });

  return {
    update: mutation.mutate,
    updateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/** `DELETE /agent/productions/:id` — re-enabled from the commented-out sheet. */
export function useDeleteProduction() {
  const queryClient = useQueryClient();
  const invalidate = useProductionInvalidation();

  const mutation = useMutation<void, unknown, { id: string; farmerId: string }>({
    mutationFn: ({ id }) => deleteProduction(id),
    onSuccess: (_result, variables) => {
      queryClient.removeQueries({ queryKey: qk.production(variables.id) });
      invalidate(variables.farmerId);
      showSuccess('Production deleted');
    },
    onError: (err) => showApiError(err, 'Could not delete this record'),
  });

  return {
    remove: mutation.mutate,
    removeAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
