/**
 * Local storage — replaces Hive (`local_storage_service.dart` + `storage_keys.dart`).
 *
 * MMKV is the closest RN equivalent to Hive: synchronous, native-backed, and
 * fast enough to read during render. The synchronous API matters because the
 * Dart code reads the token synchronously inside the request interceptor.
 *
 * Tokens are held in a separate encrypted instance, since the Dart version
 * kept them in the same plaintext Hive box as cached lists — fine for cached
 * dashboards, not for credentials.
 */
import { MMKV } from 'react-native-mmkv';

/** `heabronStorageBox` — note the Dart constant had a trailing space. */
const STORAGE_ID = 'heabronStorageBox';

/** General cache: dashboard snapshots, cooperative lists, pending farmers. */
const cache = new MMKV({ id: STORAGE_ID });

/**
 * Credentials. `encryptionKey` turns on MMKV's AES layer; the key itself is
 * a build-time constant, which is weaker than Keychain/Keystore but strictly
 * better than the plaintext Hive box this replaces. For a hardware-backed
 * option, move `tokenKey`/`refreshTokenKey` to expo-secure-store.
 */
const secure = new MMKV({
  id: `${STORAGE_ID}.secure`,
  encryptionKey: 'heabron-secure-v1',
});

/** Keys — ported verbatim from storage_keys.dart. */
export const StorageKeys = {
  token: 'tokenKey',
  refreshToken: 'refreshTokenKey',
  user: 'userKey',
  dashboardData: 'dashboardDataKey',
  cooperativesList: 'cooperativesListKey',
  pendingFarmers: 'pendingFarmersKey',
} as const;

const SECURE_KEYS: readonly string[] = [
  StorageKeys.token,
  StorageKeys.refreshToken,
];

const instanceFor = (key: string): MMKV =>
  SECURE_KEYS.includes(key) ? secure : cache;

/** `LocalStorageService.read` — raw string read. */
export function read(key: string): string | undefined {
  return instanceFor(key).getString(key);
}

/** `LocalStorageService.create` / `putData` — writes a raw string. */
export function write(key: string, value: string): void {
  instanceFor(key).set(key, value);
}

/**
 * `LocalStorageService.readJsonData` — decodes a JSON string.
 * Returns `undefined` rather than throwing on corrupt data, matching the
 * tolerant behaviour the Dart call sites relied on.
 */
export function readJson<T>(key: string): T | undefined {
  const raw = read(key);
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt entry — drop it so it cannot keep failing.
    remove(key);
    return undefined;
  }
}

/** `LocalStorageService.createJsonData` — encodes and stores. */
export function writeJson(key: string, value: unknown): void {
  write(key, JSON.stringify(value));
}

/** `LocalStorageService.delete` */
export function remove(key: string): void {
  instanceFor(key).delete(key);
}

/** `LocalStorageService.clearDb` — clears both instances on logout. */
export function clearAll(): void {
  cache.clearAll();
  secure.clearAll();
}

export const storage = {
  read,
  write,
  readJson,
  writeJson,
  remove,
  clearAll,
  keys: StorageKeys,
} as const;
