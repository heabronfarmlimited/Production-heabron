/**
 * Idempotency keys for creation requests (v2 flow: "duplicate-safe client
 * UUID").
 *
 * One key per form session, resent on every retry. The server stores it
 * behind a partial unique index, so a double tap, or an offline sync retrying
 * a request whose response was lost after the server had already committed,
 * returns the record that exists instead of creating a second one.
 *
 * ON NOT ADDING A DEPENDENCY: the obvious choice is `expo-crypto`'s
 * `randomUUID()`, but it is a native module — adding it would require a new
 * development build before the app could run at all, and this is being
 * delivered for testing. So the key is generated here, from whatever the
 * runtime offers, with no native code.
 *
 * ON `Math.random` BEING ACCEPTABLE AS THE LAST RESORT: this value is an
 * idempotency key, not a secret and not a security token. Nothing is
 * authorised by holding it, and guessing one would at worst let a caller
 * replay their own request. The only property that matters is that two
 * different form sessions do not collide, and with 122 random bits that is
 * out of reach even from a weak generator — whereas a WEAK key with a
 * STRONGER guarantee would be the wrong trade for a value that never
 * protects anything. The stronger sources are still preferred when present.
 */

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
};

/** Whatever crypto the runtime happens to expose, if any. */
function runtimeCrypto(): CryptoLike | null {
  const candidate = (globalThis as { crypto?: CryptoLike }).crypto;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

/** 16 random bytes, from the best source available. */
function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  const source = runtimeCrypto();

  if (typeof source?.getRandomValues === 'function') {
    try {
      source.getRandomValues(bytes);
      return bytes;
    } catch {
      // A polyfill can throw if its native side is missing; fall through
      // rather than failing the whole submission over a key.
    }
  }

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

const hex = (byte: number): string => byte.toString(16).padStart(2, '0');

/**
 * A new RFC 4122 version-4 UUID.
 *
 * Shaped correctly on purpose — the server validates the field as a GUID and
 * stores it in a `UUID` column, so a merely random-looking string would be
 * rejected with a 422 the agent could do nothing about.
 */
export function newClientRequestId(): string {
  const source = runtimeCrypto();
  if (typeof source?.randomUUID === 'function') {
    try {
      return source.randomUUID();
    } catch {
      // Fall through to the manual path.
    }
  }

  const bytes = randomBytes();
  // Version 4, variant 1 — the bits that make this a valid v4 UUID rather
  // than 16 arbitrary bytes in UUID clothing.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const h = Array.from(bytes, hex);
  return [
    h.slice(0, 4).join(''),
    h.slice(4, 6).join(''),
    h.slice(6, 8).join(''),
    h.slice(8, 10).join(''),
    h.slice(10, 16).join(''),
  ].join('-');
}

/** Matches the GUID shape the server's validator accepts. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientRequestId(value: unknown): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
