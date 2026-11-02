/**
 * `/farmers/sync` — the offline queue, with per-record retry.
 *
 * No Dart equivalent: a queued farmer was only ever a count on a banner, and
 * a failure went to a toast that was gone a moment later.
 */
export { SyncQueueScreen as default } from '../../features/farmers/screens/SyncQueueScreen';
