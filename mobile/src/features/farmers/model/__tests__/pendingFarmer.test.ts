import {
  buildPendingFarmer,
  parsePendingFarmer,
  pendingFarmerFailed,
  pendingFarmerName,
  serializePendingFarmer,
  splitPendingFarmers,
} from '../pendingFarmer';

/**
 * The offline queue has to distinguish "waiting for a signal" from "sent and
 * rejected".
 *
 * Before it did, a farmer whose upload kept failing looked identical to one
 * merely queued: the error went to a toast and was gone. An agent could
 * finish a day believing eight farmers were uploaded when three had been
 * rejected hours earlier. The home screen counts the two separately, which
 * only works if the failure is recorded against the entry and survives a
 * round trip through storage.
 */

const entry = (over: Record<string, unknown> = {}) =>
  parsePendingFarmer({
    id: '1',
    data: { fullName: 'Ada Nwosu' },
    localFarmPhotoPaths: [],
    queuedAt: '2026-11-01T09:00:00.000Z',
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    ...over,
  });

describe('buildPendingFarmer', () => {
  it('starts with no attempts and no error', () => {
    const built = buildPendingFarmer({ body: { fullName: 'Ada' } });
    expect(built.attempts).toBe(0);
    expect(built.lastError).toBeNull();
    expect(built.lastAttemptAt).toBeNull();
  });
});

describe('parsePendingFarmer', () => {
  it('reads a recorded failure', () => {
    const p = entry({
      attempts: 2,
      lastError: 'registrationNumber: already in use',
      lastAttemptAt: '2026-11-01T10:00:00.000Z',
    });
    expect(p.attempts).toBe(2);
    expect(p.lastError).toBe('registrationNumber: already in use');
    expect(p.lastAttemptAt).toBe('2026-11-01T10:00:00.000Z');
  });

  it('treats an entry queued before these fields existed as never attempted', () => {
    // The safe reading: it is shown as waiting, and the first sync records
    // the truth. Reading a missing field as "failed" would put an alarming
    // red tile in front of every agent who upgraded with a queue.
    const p = parsePendingFarmer({
      id: '1',
      data: {},
      localFarmPhotoPaths: [],
      queuedAt: '2026-11-01T09:00:00.000Z',
    });
    expect(p.attempts).toBe(0);
    expect(p.lastError).toBeNull();
    expect(pendingFarmerFailed(p)).toBe(false);
  });

  it('rejects a nonsense attempt count rather than carrying it', () => {
    expect(entry({ attempts: -5 }).attempts).toBe(0);
    expect(entry({ attempts: 'many' }).attempts).toBe(0);
    expect(entry({ attempts: 2.7 }).attempts).toBe(2);
  });

  it('treats an empty error string as no error', () => {
    expect(entry({ attempts: 1, lastError: '' }).lastError).toBeNull();
  });
});

describe('serializePendingFarmer', () => {
  it('round-trips the failure through storage', () => {
    // The whole point is that the reason survives the toast; if it did not
    // survive a reload it would be no better than one.
    const original = entry({
      attempts: 3,
      lastError: 'Network request failed',
      lastAttemptAt: '2026-11-01T10:00:00.000Z',
    });
    const restored = parsePendingFarmer(serializePendingFarmer(original));
    expect(restored).toEqual(original);
  });
});

describe('pendingFarmerFailed', () => {
  it('is true only when an attempt was made and it errored', () => {
    expect(pendingFarmerFailed(entry({ attempts: 1, lastError: 'boom' }))).toBe(true);
    expect(pendingFarmerFailed(entry({ attempts: 0, lastError: null }))).toBe(false);
    // An error recorded with no attempt should not be trusted as a failure.
    expect(pendingFarmerFailed(entry({ attempts: 0, lastError: 'boom' }))).toBe(false);
    // A record retried after a failure — the error was cleared — is waiting.
    expect(pendingFarmerFailed(entry({ attempts: 2, lastError: null }))).toBe(false);
  });
});

describe('splitPendingFarmers', () => {
  it('separates what is waiting from what needs attention', () => {
    const queue = [
      entry({ id: 'a' }),
      entry({ id: 'b', attempts: 1, lastError: 'Validation failed' }),
      entry({ id: 'c', attempts: 4, lastError: 'Duplicate NIN' }),
    ];
    const { waiting, failed } = splitPendingFarmers(queue);
    expect(waiting.map((p) => p.id)).toEqual(['a']);
    expect(failed.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('accounts for every entry exactly once', () => {
    const queue = [
      entry({ id: 'a' }),
      entry({ id: 'b', attempts: 1, lastError: 'x' }),
      entry({ id: 'c', attempts: 2, lastError: null }),
    ];
    const { waiting, failed } = splitPendingFarmers(queue);
    expect(waiting.length + failed.length).toBe(queue.length);
  });

  it('is empty both ways for an empty queue', () => {
    expect(splitPendingFarmers([])).toEqual({ waiting: [], failed: [] });
  });
});

describe('pendingFarmerName', () => {
  it('falls back when the queued body has no name', () => {
    expect(pendingFarmerName(entry())).toBe('Ada Nwosu');
    expect(pendingFarmerName(entry({ data: {} }))).toBe('Unnamed farmer');
  });
});
