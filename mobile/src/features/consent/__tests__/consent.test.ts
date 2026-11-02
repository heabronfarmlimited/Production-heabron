import {
  CONSENT_LANGUAGES,
  CONSENT_NOTICE,
  COOPERATIVE_QUESTIONS,
  FARMER_QUESTIONS,
  MIN_VOICE_SECONDS,
  declinedRequiredItems,
  parseConsent,
  questionsFor,
  requiredItemsAgreed,
  satisfiesGate,
} from '../model/consent';

/**
 * Mirrors the server rules in backend/src/services/consent/rules.js. If these
 * two ever disagree, the app shows an outcome the server will reject — so the
 * expectations are written from the specification, not from the client code.
 */

describe('question sets', () => {
  it('cooperative asks C1 to C4, with only C3 optional (spec 3.4, 3.5)', () => {
    expect(COOPERATIVE_QUESTIONS.map((q) => q.id)).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(COOPERATIVE_QUESTIONS.filter((q) => q.required).map((q) => q.id)).toEqual([
      'C1',
      'C2',
      'C4',
    ]);
    expect(COOPERATIVE_QUESTIONS.find((q) => q.grantsSharing)?.id).toBe('C3');
  });

  it('farmer asks F1 to F3, with only F3 optional (spec 4.3, 4.4)', () => {
    expect(FARMER_QUESTIONS.map((q) => q.id)).toEqual(['F1', 'F2', 'F3']);
    expect(FARMER_QUESTIONS.filter((q) => q.required).map((q) => q.id)).toEqual(['F1', 'F2']);
    expect(FARMER_QUESTIONS.find((q) => q.grantsSharing)?.id).toBe('F3');
  });

  it('every question has a prompt that can actually be read aloud', () => {
    for (const q of [...COOPERATIVE_QUESTIONS, ...FARMER_QUESTIONS]) {
      expect(q.prompt.length).toBeGreaterThan(30);
      expect(q.prompt.trim().endsWith('?')).toBe(true);
    }
  });

  it('questionsFor returns the right set', () => {
    expect(questionsFor('cooperative')).toBe(COOPERATIVE_QUESTIONS);
    expect(questionsFor('farmer')).toBe(FARMER_QUESTIONS);
  });
});

describe('required items', () => {
  it('cooperative: all of C1, C2, C4 must be agreed', () => {
    expect(requiredItemsAgreed('cooperative', { C1: true, C2: true, C3: true, C4: true })).toBe(true);
    // C3 declined is still fine — the cooperative registers without sharing.
    expect(requiredItemsAgreed('cooperative', { C1: true, C2: true, C3: false, C4: true })).toBe(true);

    for (const item of ['C1', 'C2', 'C4']) {
      const answers = { C1: true, C2: true, C3: true, C4: true, [item]: false };
      expect(requiredItemsAgreed('cooperative', answers)).toBe(false);
    }
  });

  it('farmer: F1 and F2 must be agreed, F3 may be declined', () => {
    expect(requiredItemsAgreed('farmer', { F1: true, F2: true, F3: false })).toBe(true);
    expect(requiredItemsAgreed('farmer', { F1: false, F2: true, F3: true })).toBe(false);
    expect(requiredItemsAgreed('farmer', { F1: true, F2: false, F3: true })).toBe(false);
  });

  it('an unanswered required item is not treated as agreed', () => {
    // A missing answer means the question was never put to the signer, which
    // must never read as consent.
    expect(requiredItemsAgreed('farmer', { F1: true })).toBe(false);
    expect(requiredItemsAgreed('cooperative', {})).toBe(false);
  });

  it('names the declined items so the blocked screen can be specific', () => {
    expect(declinedRequiredItems('cooperative', { C1: false, C2: true, C3: true, C4: false })).toEqual([
      'C1',
      'C4',
    ]);
    expect(declinedRequiredItems('farmer', { F1: true, F2: true, F3: false })).toEqual([]);
  });
});

describe('gate', () => {
  it('pending verification still lets onboarding proceed (spec 6)', () => {
    // The flow must work offline; blocking an unverified record would make the
    // app unusable without a signal.
    expect(satisfiesGate({ status: 'active' } as never)).toBe(true);
    expect(satisfiesGate({ status: 'pending_verification' } as never)).toBe(true);
    expect(satisfiesGate({ status: 'withdrawn' } as never)).toBe(false);
    expect(satisfiesGate({ status: 'superseded' } as never)).toBe(false);
    expect(satisfiesGate(null)).toBe(false);
  });
});

describe('parseConsent', () => {
  it('reads the snake_case response shape', () => {
    const c = parseConsent({
      id: 'c-1',
      entity_type: 'cooperative',
      entity_id: null,
      agreement_version: 'v1.0',
      language: 'en',
      item_responses: { C1: true, C2: true, C3: false, C4: true },
      third_party_sharing: false,
      signer_name: 'Ada Nwosu',
      signer_role: 'Leader',
      otp_status: 'pending',
      status: 'pending_verification',
      created_at: '2026-11-01T10:00:00.000Z',
    });

    expect(c.id).toBe('c-1');
    expect(c.entityType).toBe('cooperative');
    expect(c.thirdPartySharing).toBe(false);
    expect(c.itemResponses.C3).toBe(false);
    expect(c.status).toBe('pending_verification');
  });

  it('survives a malformed or empty payload without throwing', () => {
    expect(() => parseConsent(null)).not.toThrow();
    expect(() => parseConsent({})).not.toThrow();
    expect(parseConsent({}).thirdPartySharing).toBe(false);
  });
});

describe('notice and languages', () => {
  it('has a notice for both flows', () => {
    expect(CONSENT_NOTICE.cooperative.length).toBeGreaterThan(200);
    expect(CONSENT_NOTICE.farmer.length).toBeGreaterThan(150);
  });

  it('offers only reviewed translations', () => {
    // Pidgin, Yoruba, Hausa and Igbo are open items in the specification: the
    // wording is not written or legally reviewed, so offering them would
    // record a signer as having heard a notice that does not exist.
    expect(CONSENT_LANGUAGES.map((l) => l.value)).toEqual(['en']);
  });

  it('keeps the minimum voice length the specification sets', () => {
    expect(MIN_VOICE_SECONDS).toBe(3);
  });
});
