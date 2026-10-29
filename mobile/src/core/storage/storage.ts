/**
 * Local storage — replaces Hive (`local_storage_service.dart` + `storage_keys.dart`).
 *
 * Two backends, both bundled in Expo Go (so the app runs there as well as in
 * dev / store builds) and both with a synchronous API — the request
 * interceptor reads the token synchronously, as the Dart code did:
 *
 *  - General cache (dashboard snapshots, cooperative lists, pending farmers):
 *    `expo-sqlite/kv-store`, a SQLite-backed key-value store.
 *  - Credentials (access + refresh token): `expo-secure-store`, which writes
 *    to the iOS Keychain / Android Keystore.
 *
 * This previously used react-native-mmkv v4, which is built on Nitro Modules.
 * Expo Go does not ship that native code, so the app crashed on launch with
 * "Failed to get NitroModules". If you later move to a development build and
 * want MMKV back, only this file needs to change.
 */
import * as SecureStore from 'expo-secure-store';
import { SQLiteStorage } from 'expo-sqlite/kv-store';

/** `heabronStorageBox` — note the Dart constant had a trailing space. */
const STORAGE_ID = 'heabronStorageBox';

/** General cache: dashboard snapshots, cooperative lists, pending farmers. */
const cache = new SQLiteStorage(`${STORAGE_ID}.db`);

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

const isSecure = (key: string): boolean => SECURE_KEYS.includes(key);

/**
 * In-memory mirror of the secure keys. SecureStore can read and write
 * synchronously but can only delete asynchronously, so the mirror makes a
 * removal visible to the very next synchronous read (e.g. logout followed by
 * an immediate route decision). `null` means "known to be absent".
 */
const secureMirror = new Map<string, string | null>();

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

function secureRead(key: string): string | undefined {
  if (secureMirror.has(key)) return secureMirror.get(key) ?? undefined;
  let value: string | null = null;
  try {
    value = SecureStore.getItem(key, SECURE_OPTIONS);
  } catch {
    value = null;
  }
  secureMirror.set(key, value);
  return value ?? undefined;
}

function secureWrite(key: string, value: string): void {
  secureMirror.set(key, value);
  try {
    SecureStore.setItem(key, value, SECURE_OPTIONS);
  } catch (e) {
    // Keep the in-memory value so the current session still works.
    if (__DEV__) console.warn(`[storage] SecureStore write failed for ${key}`, e);
  }
}

function secureRemove(key: string): void {
  secureMirror.set(key, null);
  SecureStore.deleteItemAsync(key, SECURE_OPTIONS).catch(() => {
    /* already absent */
  });
}

function cacheRead(key: string): string | undefined {
  try {
    return cache.getItemSync(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function cacheWrite(key: string, value: string): void {
  try {
    cache.setItemSync(key, value);
  } catch (e) {
    if (__DEV__) console.warn(`[storage] cache write failed for ${key}`, e);
  }
}

function cacheRemove(key: string): void {
  try {
    cache.removeItemSync(key);
  } catch {
    /* already absent */
  }
}

/** `LocalStorageService.read` — raw string read. */
export function read(key: string): string | undefined {
  return isSecure(key) ? secureRead(key) : cacheRead(key);
}

/** `LocalStorageService.create` / `putData` — writes a raw string. */
export function write(key: string, value: string): void {
  if (isSecure(key)) secureWrite(key, value);
  else cacheWrite(key, value);
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
  if (isSecure(key)) secureRemove(key);
  else cacheRemove(key);
}

/** `LocalStorageService.clearDb` — clears both stores on logout. */
export function clearAll(): void {
  try {
    cache.clearSync();
  } catch {
    /* nothing to clear */
  }
  SECURE_KEYS.forEach(secureRemove);
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
