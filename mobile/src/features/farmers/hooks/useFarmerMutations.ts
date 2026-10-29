/**
 * Farmer create / update / delete / verify-NIN / map-farm mutations —
 * replaces `AddFarmerController.submit`, `EditFarmerController.submit` and
 * `FarmersController.deleteFarmer`.
 *
 * Each mutation invalidates the exact `qk.*` keys the change affects. The Dart
 * controllers called `fetchFarmers(refresh: true)` on a *different* global
 * controller and sometimes the wrong method entirely, which is why an edit
 * never showed up until the agent pulled to refresh.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import {
  createFarmer,
  deleteFarmer,
  mapFarm,
  updateFarmer,
  verifyFarmerNin,
} from '../api/farmersApi';
import type {
  Farmer,
  FarmerFormInput,
  GpsPoint,
  MapFarmResult,
  NinVerificationResult,
} from '../model/farmer';

/** Invalidates everything a farmer mutation can affect. */
function useFarmerInvalidation() {
  const queryClient = useQueryClient();

  return (farmer: { id?: string | null; cooperativeId?: string | null }) => {
    void queryClient.invalidateQueries({ queryKey: ['farmers'] });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });

    if (farmer.id) {
      void queryClient.invalidateQueries({ queryKey: qk.farmer(farmer.id) });
      void queryClient.invalidateQueries({ queryKey: qk.farmerCreditScore(farmer.id) });
    }
    if (farmer.cooperativeId) {
      void queryClient.invalidateQueries({
        queryKey: qk.cooperativeFarmers(farmer.cooperativeId),
      });
      void queryClient.invalidateQueries({
        queryKey: qk.cooperative(farmer.cooperativeId),
      });
    }
  };
}

/** `POST /agent/farmers` */
export function useCreateFarmer() {
  const invalidate = useFarmerInvalidation();

  const mutation = useMutation<Farmer, unknown, FarmerFormInput>({
    mutationFn: createFarmer,
    onSuccess: (farmer) => {
      invalidate(farmer);
      showSuccess('Farmer onboarded successfully');
    },
  });

  return {
    create: mutation.mutate,
    createAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/** `PATCH /agent/farmers/:id` */
export function useUpdateFarmer(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useFarmerInvalidation();

  const mutation = useMutation<Farmer, unknown, FarmerFormInput>({
    mutationFn: (input) => updateFarmer(id, input),
    onSuccess: (farmer) => {
      // Seed the detail cache so popping back shows the new values at once.
      queryClient.setQueryData(qk.farmer(id), farmer);
      invalidate({ id, cooperativeId: farmer.cooperativeId });
      showSuccess('Farmer profile updated successfully');
    },
  });

  return {
    update: mutation.mutate,
    updateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * `DELETE /agent/farmers/:id`
 *
 * Re-enabled: the Flutter row and its confirmation dialog were ~86 commented
 * out lines even though `farmers.remove` has always existed.
 */
export function useDeleteFarmer() {
  const queryClient = useQueryClient();
  const invalidate = useFarmerInvalidation();

  const mutation = useMutation<
    void,
    unknown,
    { id: string; cooperativeId?: string | null }
  >({
    mutationFn: ({ id }) => deleteFarmer(id),
    onSuccess: (_result, variables) => {
      queryClient.removeQueries({ queryKey: qk.farmer(variables.id) });
      invalidate(variables);
      showSuccess('Farmer deleted successfully');
    },
    onError: (err) => showApiError(err, 'Failed to delete farmer'),
  });

  return {
    remove: mutation.mutate,
    removeAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/**
 * `POST /agent/farmers/:farmerId/verify-nin`
 *
 * Wired to a button on the details screen. The returned status replaces the
 * stored `nin_verification_status`, so the farmer is re-fetched.
 */
export function useVerifyFarmerNin(farmerId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation<NinVerificationResult, unknown, void>({
    mutationFn: () => verifyFarmerNin(farmerId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: qk.farmer(farmerId) });
      void queryClient.invalidateQueries({ queryKey: ['farmers'] });

      if (result.status === 'verified') {
        showSuccess('NIN verified successfully');
      } else if (result.status === 'mismatch') {
        showApiError(
          new Error(
            "NIN details do not match the farmer's name or date of birth.",
          ),
        );
      } else {
        showApiError(
          new Error('NIN verification failed. Please try again later.'),
        );
      }
    },
    onError: (err) => showApiError(err, 'Could not verify this NIN'),
  });

  return {
    verify: mutation.mutate,
    verifyAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    result: mutation.data ?? null,
  };
}

/**
 * `POST /agent/farmers/:farmerId/map-farm`
 *
 * `mapFarm()` and `mapFarmEndpoint` existed in the Dart repository layer with
 * no UI anywhere, so `gpsPolygon` — present on three DTOs — was never
 * populated and server-computed acreage was unreachable.
 */
export function useMapFarm(farmerId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    MapFarmResult,
    unknown,
    { gpsPolygon: GpsPoint[]; overrideSizeAcres?: number }
  >({
    mutationFn: ({ gpsPolygon, overrideSizeAcres }) =>
      mapFarm(farmerId, gpsPolygon, overrideSizeAcres),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: qk.farmer(farmerId) });
      void queryClient.invalidateQueries({ queryKey: ['farmers'] });
      // The farm size feeds yield-per-hectare, so the score is recalculated.
      void queryClient.invalidateQueries({ queryKey: qk.farmerCreditScore(farmerId) });
      showSuccess(
        `Farm mapped — ${result.computedAreaAcres.toFixed(2)} acres recorded`,
      );
    },
    onError: (err) => showApiError(err, 'Could not save the farm boundary'),
  });

  return {
    save: mutation.mutate,
    saveAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    result: mutation.data ?? null,
  };
}
