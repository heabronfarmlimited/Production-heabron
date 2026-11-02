/**
 * The farmer's farms — list and mutations ("Add Another Farm").
 *
 * A farmer may hold several plots, often with different crops. The nested
 * `farm` object on create/update still addresses the PRIMARY farm, so the
 * existing onboarding and edit flows are untouched; these hooks address the
 * set.
 *
 * Every mutation invalidates the farmer's credit score as well as the farm
 * list, because total land is the denominator of the production score — add a
 * farm and the score moves. The score tile on the details screen would
 * otherwise show the old number until the agent pulled to refresh.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import {
  addFarmerFarm,
  deleteFarmerFarm,
  fetchFarmerFarms,
  setPrimaryFarmerFarm,
  updateFarmerFarm,
} from '../api/farmersApi';
import type {
  FarmerFarmProfile,
  FarmerFarmSet,
  FarmProfileBody,
} from '../model/farmer';

/** Invalidates everything a change to the farm set affects. */
function useFarmInvalidation(farmerId: string) {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.farmerFarms(farmerId) });
    void queryClient.invalidateQueries({ queryKey: qk.farmer(farmerId) });
    // Land is the denominator of the production score.
    void queryClient.invalidateQueries({ queryKey: qk.farmerCreditScore(farmerId) });
    // The cooperative's land total is summed from member farms.
    void queryClient.invalidateQueries({ queryKey: ['cooperative'] });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
  };
}

/** `GET /agent/farmers/:farmerId/farms` */
export function useFarmerFarms(farmerId: string, enabled = true) {
  const query = useQuery<FarmerFarmSet>({
    queryKey: qk.farmerFarms(farmerId),
    queryFn: () => fetchFarmerFarms(farmerId),
    enabled: enabled && farmerId.length > 0,
  });

  return {
    farms: query.data?.farms ?? [],
    land: query.data?.land ?? null,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

/** `POST /agent/farmers/:farmerId/farms` */
export function useAddFarm(farmerId: string) {
  const invalidate = useFarmInvalidation(farmerId);

  const mutation = useMutation<FarmerFarmProfile, unknown, FarmProfileBody>({
    mutationFn: (farm) => addFarmerFarm(farmerId, farm),
    onSuccess: (farm) => {
      invalidate();
      showSuccess(`${farm.label ?? 'Farm'} added`);
    },
    onError: showApiError,
  });

  return { addFarm: mutation.mutate, isPending: mutation.isPending };
}

/** `PATCH /agent/farmers/:farmerId/farms/:farmId` — partial update. */
export function useUpdateFarm(farmerId: string) {
  const invalidate = useFarmInvalidation(farmerId);

  const mutation = useMutation<
    FarmerFarmProfile,
    unknown,
    { farmId: string; farm: FarmProfileBody }
  >({
    mutationFn: ({ farmId, farm }) => updateFarmerFarm(farmerId, farmId, farm),
    onSuccess: (farm) => {
      invalidate();
      showSuccess(`${farm.label ?? 'Farm'} updated`);
    },
    onError: showApiError,
  });

  return { updateFarm: mutation.mutate, isPending: mutation.isPending };
}

/** `POST /agent/farmers/:farmerId/farms/:farmId/primary` */
export function useSetPrimaryFarm(farmerId: string) {
  const invalidate = useFarmInvalidation(farmerId);

  const mutation = useMutation<FarmerFarmProfile, unknown, string>({
    mutationFn: (farmId) => setPrimaryFarmerFarm(farmerId, farmId),
    onSuccess: (farm) => {
      invalidate();
      showSuccess(`${farm.label ?? 'Farm'} is now the main farm`);
    },
    onError: showApiError,
  });

  return { setPrimary: mutation.mutate, isPending: mutation.isPending };
}

/**
 * `DELETE /agent/farmers/:farmerId/farms/:farmId`
 *
 * The server refuses to remove a farmer's only farm (409) — a farmer without
 * a farm cannot be credit-scored — and `showApiError` surfaces that message
 * rather than a generic failure.
 */
export function useDeleteFarm(farmerId: string) {
  const invalidate = useFarmInvalidation(farmerId);

  const mutation = useMutation<void, unknown, string>({
    mutationFn: (farmId) => deleteFarmerFarm(farmerId, farmId),
    onSuccess: () => {
      invalidate();
      showSuccess('Farm removed');
    },
    onError: showApiError,
  });

  return { deleteFarm: mutation.mutate, isPending: mutation.isPending };
}
