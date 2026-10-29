/**
 * Offline onboarding queue — replaces `FarmersController`'s pending-farmer
 * half plus `FarmersLocalRepository`.
 *
 * FIXED — the connectivity listener lived in `FarmersController.init()`, and
 * nothing in the Flutter app ever called `init()`. The `statusStream`
 * subscription therefore never attached, so auto-sync never ran: the queue
 * only drained if the agent happened to open a cooperative and tap "Sync Now".
 * `useNetworkStatus` below attaches a NetInfo listener on mount and
 * `useOfflineFarmerQueue` syncs on every offline -> online transition.
 */
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { qk } from '../../../core/api/queryClient';
import { showApiError, showError, showSuccess } from '../../../core/utils/toast';
import { uploadFile } from '../../auth/api/authApi';
import { createFarmerFromBody } from '../api/farmersApi';
import {
  pendingFarmerStore,
  type PendingFarmer,
} from '../model/pendingFarmer';
import type { Raw } from '../model/primitives';
import { uploadKinds } from '../model/uploadKinds';

/**
 * One sync at a time, process-wide. See `syncAll`.
 */
let syncInFlight = false;

/**
 * Live connectivity, from `@react-native-community/netinfo`.
 * Replaces `$networkInfoService.isConnected` / `.statusStream`.
 */
export function useNetworkStatus(): { isConnected: boolean } {
  // Assume online until told otherwise, so a slow first NetInfo callback
  // cannot make the first submit of a session queue itself unnecessarily.
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected !== false);
    });
    void NetInfo.fetch().then((state) => setIsConnected(state.isConnected !== false));
    return unsubscribe;
  }, []);

  return { isConnected };
}

/** One-shot check for a submit handler. */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected !== false;
}

export interface OfflineFarmerQueue {
  pending: PendingFarmer[];
  isSyncing: boolean;
  /** Uploads the queued images, POSTs each farmer, drops it on success. */
  syncAll: () => Promise<void>;
  /** Re-reads local storage — call after enqueueing from a form. */
  reload: () => void;
  /** Drops one entry without sending it. */
  discard: (id: string) => void;
}

export function useOfflineFarmerQueue(): OfflineFarmerQueue {
  const queryClient = useQueryClient();
  const { isConnected } = useNetworkStatus();

  const [pending, setPending] = useState<PendingFarmer[]>(() =>
    pendingFarmerStore.all(),
  );
  const [isSyncing, setIsSyncing] = useState(false);

  const wasConnected = useRef(isConnected);

  // Stay in step with every other mounted copy of this hook — the one in
  // `app/_layout`, the farmers-list banner and the Add Farmer form all share
  // one local-storage queue.
  useEffect(() => pendingFarmerStore.subscribe(setPending), []);

  const reload = useCallback(() => {
    setPending(pendingFarmerStore.all());
  }, []);

  const syncAll = useCallback(async () => {
    // The lock is module-level, not per-instance: several mounted copies see
    // the same reconnect, and a farmer posted twice cannot be undone.
    if (syncInFlight) return;

    const queue = pendingFarmerStore.all();
    if (queue.length === 0) {
      setPending([]);
      return;
    }

    if (!(await isOnline())) {
      showError('No internet connection. Sync failed.');
      return;
    }

    syncInFlight = true;
    setIsSyncing(true);

    let synced = 0;
    let failed = 0;

    for (const entry of queue) {
      try {
        const body = await resolveUploads(entry);
        await createFarmerFromBody(body);
        pendingFarmerStore.remove(entry.id);
        synced += 1;
      } catch (err) {
        // One bad record must not block the rest of the queue — the Dart
        // loop rethrew on the first failure and abandoned the remainder.
        failed += 1;
        if (failed === 1) showApiError(err, 'Sync failed');
      }
    }

    syncInFlight = false;
    setIsSyncing(false);
    setPending(pendingFarmerStore.all());

    if (synced > 0) {
      void queryClient.invalidateQueries({ queryKey: ['farmers'] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      showSuccess(
        failed === 0
          ? 'Sync completed successfully'
          : `${synced} farmer${synced === 1 ? '' : 's'} synced, ${failed} failed`,
      );
    }
  }, [queryClient]);

  // Auto-sync on every offline -> online transition. This is the listener
  // `FarmersController.init()` would have attached had anything called it.
  useEffect(() => {
    if (isConnected && !wasConnected.current) {
      void syncAll();
    }
    wasConnected.current = isConnected;
  }, [isConnected, syncAll]);

  const discard = useCallback((id: string) => {
    setPending(pendingFarmerStore.remove(id));
  }, []);

  return { pending, isSyncing, syncAll, reload, discard };
}

/**
 * Uploads the local images a queued farmer carries and merges the resulting
 * URLs into its stored body.
 *
 * The queued body already holds `farm` as a nested object (the shape
 * `createFarmer` validates), so the land document and farm photos are merged
 * into that, not onto the root.
 */
async function resolveUploads(entry: PendingFarmer): Promise<Raw> {
  const body: Raw = { ...entry.data };
  const farm: Raw = { ...(body.farm && typeof body.farm === 'object'
    ? (body.farm as Raw)
    : {}) };

  if (!body.farmerPhotoUrl && entry.localFarmerPhotoPath) {
    body.farmerPhotoUrl = await uploadFile({
      uri: entry.localFarmerPhotoPath,
      kind: uploadKinds.farmerPhoto,
    });
  }

  if (!body.idImageUrl && entry.localIdCardPhotoPath) {
    body.idImageUrl = await uploadFile({
      uri: entry.localIdCardPhotoPath,
      kind: uploadKinds.farmerId,
    });
  }

  if (!farm.landDocumentUrl && entry.localLandDocumentPath) {
    farm.landDocumentUrl = await uploadFile({
      uri: entry.localLandDocumentPath,
      kind: uploadKinds.landDoc,
    });
  }

  const existingPhotos = Array.isArray(farm.farmPhotoUrls)
    ? (farm.farmPhotoUrls as unknown[]).filter(
        (url): url is string => typeof url === 'string',
      )
    : [];

  if (existingPhotos.length === 0 && entry.localFarmPhotoPaths.length > 0) {
    const uploaded: string[] = [];
    for (const uri of entry.localFarmPhotoPaths) {
      uploaded.push(await uploadFile({ uri, kind: uploadKinds.farmPhoto }));
    }
    if (uploaded.length > 0) farm.farmPhotoUrls = uploaded;
  }

  if (Object.keys(farm).length > 0) body.farm = farm;
  return body;
}
