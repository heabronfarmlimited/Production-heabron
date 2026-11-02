import {
  UUID_PATTERN,
  isClientRequestId,
  newClientRequestId,
} from '../clientRequestId';

/**
 * The idempotency key has to be a real v4 UUID, because the server validates
 * the field as a GUID and stores it in a `UUID` column — a merely
 * random-looking string comes back as a 422 the agent can do nothing about.
 *
 * And it has to be generated without a native module: adding `expo-crypto`
 * would require a new development build before the app would run at all.
 * These tests therefore exercise every fallback path, including the weak one,
 * since on a real device the strong ones are absent.
 */

const originalCrypto = (globalThis as { crypto?: unknown }).crypto;

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, 'crypto', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setCrypto(originalCrypto);
});

describe('newClientRequestId', () => {
  it('produces a valid v4 UUID', () => {
    expect(newClientRequestId()).toMatch(UUID_PATTERN);
  });

  it('produces a valid UUID with no crypto at all, as on Hermes', () => {
    // React Native does not provide a `crypto` global. This is the path that
    // actually runs on the agent's phone.
    setCrypto(undefined);
    const id = newClientRequestId();
    expect(id).toMatch(UUID_PATTERN);
    // Version 4 and variant 1 must be set, not merely 32 random hex digits.
    expect(id[14]).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(id[19]?.toLowerCase());
  });

  it('uses randomUUID when the runtime has it', () => {
    const stub = '3f1c9e74-5a2b-4c8d-9e0f-1a2b3c4d5e6f';
    const randomUUID = jest.fn(() => stub);
    setCrypto({ randomUUID });
    expect(newClientRequestId()).toBe(stub);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('uses getRandomValues when randomUUID is missing', () => {
    const getRandomValues = jest.fn((array: Uint8Array) => {
      array.fill(0xab);
      return array;
    });
    setCrypto({ getRandomValues });
    const id = newClientRequestId();
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(id).toMatch(UUID_PATTERN);
  });

  it('falls back rather than throwing when randomUUID throws', () => {
    // A polyfill whose native side is missing throws. Failing a whole farmer
    // submission over the key would be absurd.
    setCrypto({
      randomUUID: () => {
        throw new Error('not linked');
      },
    });
    expect(newClientRequestId()).toMatch(UUID_PATTERN);
  });

  it('falls back rather than throwing when getRandomValues throws', () => {
    setCrypto({
      getRandomValues: () => {
        throw new Error('not linked');
      },
    });
    expect(newClientRequestId()).toMatch(UUID_PATTERN);
  });

  it('does not repeat itself', () => {
    // Two form sessions colliding would mean the second farmer silently
    // returning the first farmer's record.
    setCrypto(undefined);
    const ids = new Set(Array.from({ length: 2000 }, () => newClientRequestId()));
    expect(ids.size).toBe(2000);
  });

  it('fills all 32 hex digits, not just the first few', () => {
    // A generator that left trailing zeroes would collide far sooner than
    // the bit count suggests.
    setCrypto(undefined);
    const tailsSeen = new Set(
      Array.from({ length: 200 }, () => newClientRequestId().split('-')[4]),
    );
    expect(tailsSeen.size).toBe(200);
  });
});

describe('isClientRequestId', () => {
  it('accepts what the generator makes', () => {
    setCrypto(undefined);
    expect(isClientRequestId(newClientRequestId())).toBe(true);
  });

  it('rejects anything the server would 422', () => {
    for (const value of [
      '',
      'not-a-uuid',
      '3f1c9e74-5a2b-4c8d-9e0f',
      '3f1c9e74-5a2b-0c8d-9e0f-1a2b3c4d5e6f', // version 0
      '3f1c9e74-5a2b-4c8d-0e0f-1a2b3c4d5e6f', // bad variant
      null,
      undefined,
      123,
      {},
    ]) {
      expect(isClientRequestId(value)).toBe(false);
    }
  });
});
