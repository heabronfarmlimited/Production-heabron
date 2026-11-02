/**
 * Offline onboarding queue — ported from `PendingFarmer` in add_farmer_req.dart
 * plus `FarmersLocalRepository`.
 *
 * A farmer onboarded without a connection is stored here with the *local*
 * file URIs of its four image fields, because the uploads cannot happen yet.
 * `useOfflineFarmerQueue` uploads them and POSTs the farmer once connectivity
 * returns.
 *
 * FIXED — in Flutter the only thing that attached the connectivity listener
 * was `FarmersController.init()`, which was never called from anywhere, so
 * auto-sync never ran and the queue only drained if the agent happened to
 * open a cooperative and tap "Sync Now".
 */
import { storage } from '../../../core/storage/storage';

import { obj, str, strList, type Raw } from './primitives';

export interface PendingFarmer {
  /** `DateTime.now().millisecondsSinceEpoch.toString()` in Dart. */
  id: string;
  /** The already-built `POST /agent/farmers` body, minus the image URLs. */
  data: Raw;
  localFarmerPhotoPath?: string | null;
  localIdCardPhotoPath?: string | null;
  localLandDocumentPath?: string | null;
  localFarmPhotoPaths: string[];
  /** Not in the Dart DTO — lets the UI show when a record was queued. */
  queuedAt: string;
  /**
   * How many times a sync has been attempted for this record, and why the
   * last one failed.
   *
   * Without these, a record that keeps failing — a duplicate registration
   * number, a validation error the form let through, an expired session —
   * looked exactly like one that was merely waiting for a signal. The agent
   * had no way to tell that something needed their attention, and the only
   * sign was a toast that had long since gone. The home screen now counts
   * "waiting to sync" and "failed to sync" separately, which is only possible
   * because the failure is recorded against the entry.
   */
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
}

export function parsePendingFarmer(raw: unknown): PendingFarmer {
  const p = obj(raw);
  return {
    id: str(p.id),
    data: obj(p.data),
    localFarmerPhotoPath: typeof p.localFarmerPhotoPath === 'string'
      ? p.localFarmerPhotoPath
      : null,
    localIdCardPhotoPath: typeof p.localIdCardPhotoPath === 'string'
      ? p.localIdCardPhotoPath
      : null,
    localLandDocumentPath: typeof p.localLandDocumentPath === 'string'
      ? p.localLandDocumentPath
      : null,
    localFarmPhotoPaths: strList(p.localFarmPhotoPaths),
    queuedAt: str(p.queuedAt, new Date(0).toISOString()),
    // Entries queued before this field existed read as never-attempted,
    // which is the safe reading: they are shown as waiting, and the first
    // sync records the truth.
    attempts: typeof p.attempts === 'number' && Number.isFinite(p.attempts)
      ? Math.max(0, Math.trunc(p.attempts))
      : 0,
    lastError: typeof p.lastError === 'string' && p.lastError.length > 0
      ? p.lastError
      : null,
    lastAttemptAt: typeof p.lastAttemptAt === 'string' ? p.lastAttemptAt : null,
  };
}

export function serializePendingFarmer(p: PendingFarmer): Record<string, unknown> {
  return {
    id: p.id,
    data: p.data,
    localFarmerPhotoPath: p.localFarmerPhotoPath ?? null,
    localIdCardPhotoPath: p.localIdCardPhotoPath ?? null,
    localLandDocumentPath: p.localLandDocumentPath ?? null,
    localFarmPhotoPaths: p.localFarmPhotoPaths,
    queuedAt: p.queuedAt,
    attempts: p.attempts,
    lastError: p.lastError,
    lastAttemptAt: p.lastAttemptAt,
  };
}

/** True when the last sync attempt for this record failed. */
export const pendingFarmerFailed = (p: PendingFarmer): boolean =>
  p.lastError != null && p.attempts > 0;

/** Splits the queue into what is waiting and what needs attention. */
export function splitPendingFarmers(queue: PendingFarmer[]): {
  waiting: PendingFarmer[];
  failed: PendingFarmer[];
} {
  const failed = queue.filter(pendingFarmerFailed);
  const waiting = queue.filter((p) => !pendingFarmerFailed(p));
  return { waiting, failed };
}

/** The display name shown in the pending-uploads list. */
export const pendingFarmerName = (p: PendingFarmer): string =>
  str(p.data.fullName, 'Unnamed farmer');

// ------------------------------------------------------------- persistence
/**
 * Device-storage-backed store, replacing `FarmersLocalRepository` (Hive).
 * `storage.readJson` already drops corrupt entries rather than throwing.
 */
/**
 * Listeners are module-level so every mounted `useOfflineFarmerQueue` — the one
 * in `app/_layout`, the banner on the farmers list, the Add Farmer form —
 * reflects a write immediately. The storage layer has no change notification of its own, so
 * without this a queued farmer would stay invisible until the next remount.
 */
type QueueListener = (queue: PendingFarmer[]) => void;
const listeners = new Set<QueueListener>();

function notify(queue: PendingFarmer[]): void {
  listeners.forEach((listener) => listener(queue));
}

export const pendingFarmerStore = {
  all(): PendingFarmer[] {
    const raw = storage.readJson<unknown>(storage.keys.pendingFarmers);
    if (!Array.isArray(raw)) return [];
    return raw.map(parsePendingFarmer).filter((p) => p.id.length > 0);
  },

  add(pending: PendingFarmer): PendingFarmer[] {
    const next = [...this.all(), pending];
    this.replaceAll(next);
    return next;
  },

  remove(id: string): PendingFarmer[] {
    const next = this.all().filter((p) => p.id !== id);
    this.replaceAll(next);
    return next;
  },

  /**
   * Records the outcome of a sync attempt against one entry.
   *
   * Called on failure only — a success removes the entry instead. The
   * attempt count is kept so a repeatedly failing record can be told apart
   * from one that has only just been tried.
   */
  recordFailure(id: string, message: string): PendingFarmer[] {
    const next = this.all().map((p) =>
      p.id === id
        ? {
            ...p,
            attempts: p.attempts + 1,
            lastError: message,
            lastAttemptAt: new Date().toISOString(),
          }
        : p,
    );
    this.replaceAll(next);
    return next;
  },

  /**
   * Clears the failure on an entry so it is shown as waiting again.
   *
   * Used by "Retry": without it a record that then failed for a transient
   * reason would keep its old, now misleading, error message while the
   * retry was in flight.
   */
  clearFailure(id: string): PendingFarmer[] {
    const next = this.all().map((p) =>
      p.id === id ? { ...p, lastError: null } : p,
    );
    this.replaceAll(next);
    return next;
  },

  replaceAll(list: PendingFarmer[]): void {
    storage.writeJson(
      storage.keys.pendingFarmers,
      list.map(serializePendingFarmer),
    );
    notify(list);
  },

  clear(): void {
    storage.remove(storage.keys.pendingFarmers);
    notify([]);
  },

  /** Returns an unsubscribe function. */
  subscribe(listener: QueueListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Builds a queue entry from a submitted farmer body + its local file URIs. */
export function buildPendingFarmer(input: {
  body: Raw;
  farmerPhotoUri?: string | null;
  idCardUri?: string | null;
  landDocumentUri?: string | null;
  farmPhotoUris?: string[];
}): PendingFarmer {
  return {
    id: `${Date.now()}`,
    data: input.body,
    localFarmerPhotoPath: input.farmerPhotoUri ?? null,
    localIdCardPhotoPath: input.idCardUri ?? null,
    localLandDocumentPath: input.landDocumentUri ?? null,
    localFarmPhotoPaths: input.farmPhotoUris ?? [],
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  };
}
