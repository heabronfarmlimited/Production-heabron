'use strict';

/**
 * Heabron CoopScore — data-consent rule verification
 * --------------------------------------------------
 * Run with:  node scripts/verify-consent.js
 *
 * Expected values come from "CoopScore Data Consent Specification" v1.0, with
 * section numbers cited. These are the decisions with legal weight — whether
 * someone agreed, and whether their data may be shared — so they are tested
 * exhaustively rather than by example.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const rules = require(path.join(__dirname, '..', 'src', 'services', 'consent', 'rules.js'));

const coopYes = { C1: true, C2: true, C3: true, C4: true };
const farmerYes = { F1: true, F2: true, F3: true };

// ───────────────────────────────────────────── Flow A — cooperative (spec 3)

test('cooperative: all four agreed is valid and enables sharing', () => {
  const r = rules.validateResponses('cooperative', coopYes);
  assert.equal(r.ok, true);
  assert.equal(r.thirdPartySharing, true);
  assert.deepEqual(r.errors, []);
});

test('cooperative: C1, C2 and C4 are each required (spec 3.5)', () => {
  for (const item of ['C1', 'C2', 'C4']) {
    const r = rules.validateResponses('cooperative', { ...coopYes, [item]: false });
    assert.equal(r.ok, false, `${item}=No must block registration`);
    assert.ok(
      r.errors.some((e) => e.field === `itemResponses.${item}`),
      `the error must point at ${item} so the app can mark that question`
    );
  }
});

test('cooperative: C3 may be No — register, but disable sharing (spec 3.5)', () => {
  // "If C3 is No, the cooperative can be registered, but sharing with lenders
  // and buyers is disabled and the cooperative is flagged No Third-Party
  // Sharing."
  const r = rules.validateResponses('cooperative', { ...coopYes, C3: false });
  assert.equal(r.ok, true, 'declining C3 must NOT block registration');
  assert.equal(r.thirdPartySharing, false);
});

test('cooperative: every item must be answered explicitly', () => {
  // A missing answer is not a No — it means the question was never put to the
  // leader, which must not be recorded as consent either way.
  const r = rules.validateResponses('cooperative', { C1: true, C2: true, C4: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'itemResponses.C3'));
});

test('cooperative: an unknown item is rejected', () => {
  const r = rules.validateResponses('cooperative', { ...coopYes, C9: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'itemResponses.C9'));
});

test('cooperative: a farmer item cannot be submitted as cooperative consent', () => {
  const r = rules.validateResponses('cooperative', farmerYes);
  assert.equal(r.ok, false);
});

// ───────────────────────────────────────────── Flow B — farmer (spec 4)

test('farmer: F1 and F2 are required (spec 4.4)', () => {
  for (const item of ['F1', 'F2']) {
    const r = rules.validateResponses('farmer', { ...farmerYes, [item]: false });
    assert.equal(r.ok, false, `${item}=No must stop registration`);
  }
});

test('farmer: F3 may be No without blocking registration', () => {
  const r = rules.validateResponses('farmer', { ...farmerYes, F3: false });
  assert.equal(r.ok, true);
  assert.equal(r.thirdPartySharing, false);
});

test('farmer: F3 is forced to No when the cooperative declined C3 (spec 4.3)', () => {
  // A farmer cannot grant sharing their cooperative refused — even if the
  // client sends F3 true, which is exactly what a stale or tampered client
  // would do.
  const r = rules.validateResponses('farmer', farmerYes, { cooperativeAllowsSharing: false });
  assert.equal(r.ok, true);
  assert.equal(r.thirdPartySharing, false, 'the cooperative refusal must win');
});

test('farmer: sharing is granted only when the cooperative also allows it', () => {
  const allowed = rules.validateResponses('farmer', farmerYes, { cooperativeAllowsSharing: true });
  assert.equal(allowed.thirdPartySharing, true);
});

// ───────────────────────────────────────────── Declined attempts (spec 4.4)

test('decline log records the refusal without personal details', () => {
  const entry = rules.declineLogEntry({
    entityType: 'farmer',
    responses: { F1: false, F2: true, F3: false },
    agentId: 'agent-1',
    cooperativeId: 'coop-1',
  });

  assert.deepEqual(entry.refused_items, ['F1']);
  assert.equal(entry.agent_id, 'agent-1');

  // "log the declined attempt without storing personal details"
  const serialised = JSON.stringify(entry);
  for (const field of ['name', 'phone', 'nin', 'bvn', 'email', 'address']) {
    assert.ok(!serialised.includes(field), `the decline log must not carry ${field}`);
  }
});

// ───────────────────────────────────────────── Status and gates

test('status: a verified signer starts active', () => {
  const s = rules.initialStatus({ otpVerified: true, signerEmail: 'leader@example.com' });
  assert.deepEqual(s, { status: 'active', otpStatus: 'verified' });
});

test('status: captured offline, awaiting the emailed code', () => {
  const s = rules.initialStatus({ otpVerified: false, signerEmail: 'leader@example.com' });
  assert.deepEqual(s, { status: 'pending_verification', otpStatus: 'pending' });
});

test('status: no email address to verify against is pending, not failed', () => {
  // Many cooperative leaders have no email. The spec verifies by SMS; with
  // email only, this case is the one the SMS flow would have covered, so it
  // lands in Pending Verification for an admin rather than being refused.
  const s = rules.initialStatus({ otpVerified: false, signerEmail: null });
  assert.deepEqual(s, { status: 'pending_verification', otpStatus: 'not_required' });
});

test('gate: pending verification still lets onboarding proceed (spec 6)', () => {
  // The whole flow must work with no network. Blocking an unverified record
  // would make the app unusable in the field, which is the opposite of what
  // the offline section requires.
  assert.equal(rules.satisfiesGate({ status: 'active' }), true);
  assert.equal(rules.satisfiesGate({ status: 'pending_verification' }), true);
  assert.equal(rules.satisfiesGate({ status: 'withdrawn' }), false);
  assert.equal(rules.satisfiesGate({ status: 'superseded' }), false);
  assert.equal(rules.satisfiesGate(null), false, 'no consent at all must not pass the gate');
});

// ───────────────────────────────────────────── Sharing (spec 8 and 9)

test('sharing: requires a live consent AND the third-party item agreed', () => {
  assert.equal(
    rules.allowsThirdPartySharing({ status: 'active', third_party_sharing: true }),
    true
  );
  assert.equal(
    rules.allowsThirdPartySharing({ status: 'active', third_party_sharing: false }),
    false
  );
});

test('sharing: a withdrawn consent blocks sharing however its items were answered', () => {
  // Spec 8: withdrawal stops third-party sharing from that date.
  assert.equal(
    rules.allowsThirdPartySharing({ status: 'withdrawn', third_party_sharing: true }),
    false
  );
  assert.equal(
    rules.allowsThirdPartySharing({ status: 'superseded', third_party_sharing: true }),
    false
  );
  assert.equal(rules.allowsThirdPartySharing(null), false);
});

// ───────────────────────────────────────────── Voice and versioning

test('voice: a statement under three seconds is not acceptable (spec 3.6)', () => {
  assert.equal(rules.voiceIsAcceptable({ durationSeconds: 5 }), true);
  assert.equal(rules.voiceIsAcceptable({ durationSeconds: 3 }), true);
  assert.equal(rules.voiceIsAcceptable({ durationSeconds: 2.9 }), false);
  assert.equal(rules.voiceIsAcceptable({ durationSeconds: 0 }), false);
  assert.equal(rules.voiceIsAcceptable({ durationSeconds: null }), false);
});

test('versioning: a new agreement version requires fresh consent (spec 8)', () => {
  assert.equal(rules.needsRecollection({ status: 'active', agreement_version: 'v1.0' }), false);
  assert.equal(rules.needsRecollection({ status: 'active', agreement_version: 'v0.9' }), true);
  assert.equal(rules.needsRecollection({ status: 'withdrawn', agreement_version: 'v1.0' }), true);
  assert.equal(rules.needsRecollection(null), true);
});

test('languages: only reviewed notice translations are offered', () => {
  // Pidgin, Yoruba, Hausa and Igbo are open items in the spec — the wording and
  // recordings are not written yet, so they must not be selectable and recorded
  // as though the signer heard a notice in their own language.
  assert.deepEqual(rules.SUPPORTED_LANGUAGES, ['en']);
});

// ───────────────────────────────────── Gate wiring (controller integration)

const Module = require('node:module');
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Loads a controller with a stubbed Supabase so the gate can be driven without
 * a database. `rows` maps a table name to the single row its lookups return.
 */
function loadControllerWithRows(file, rows, captured = {}) {
  const resolved = require.resolve(path.join(__dirname, '..', 'src', 'controllers', file));
  delete require.cache[resolved];

  const builder = (table) => {
    const q = {
      select() { return q; },
      eq() { return q; },
      is() { return q; },
      in() { return q; },
      order() { return q; },
      limit() { return q; },
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      single: async () => ({ data: rows[table] ?? null, error: null }),
      insert(row) { captured[table] = row; return q; },
      update(patch) { captured[`${table}:update`] = patch; return q; },
    };
    return q;
  };

  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request.endsWith('config/supabase')) return { supabaseAdmin: () => ({ from: builder }) };
    if (request.endsWith('utils/logger')) return silentLogger;
    if (request.endsWith('utils/activity')) return { logActivity: async () => {} };
    return originalLoad(request, parent, isMain);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
  }
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('gate: a cooperative cannot be registered without consent (spec 3, Rule)', async () => {
  const ctrl = loadControllerWithRows('cooperatives.controller.js', {});
  const res = fakeRes();

  await ctrl.create(
    { body: { name: 'Oju Farmers Coop' }, user: { userId: 'agent-1' } },
    res
  );

  assert.equal(res.body?.success, false);
  assert.match(JSON.stringify(res.body), /consent is required/i);
});

test('gate: a withdrawn consent cannot be used to register a cooperative', async () => {
  const ctrl = loadControllerWithRows('cooperatives.controller.js', {
    consent_records: {
      id: 'c-1',
      entity_type: 'cooperative',
      entity_id: null,
      status: 'withdrawn',
      third_party_sharing: false,
    },
  });
  const res = fakeRes();

  await ctrl.create(
    { body: { name: 'Oju Farmers Coop', consentId: 'c-1' }, user: { userId: 'agent-1' } },
    res
  );

  assert.equal(res.body?.success, false);
  assert.match(JSON.stringify(res.body), /withdrawn/i);
});

test('gate: a consent already attached to a cooperative cannot be reused', async () => {
  // Reusing one would record one cooperative's consent against another's
  // registration.
  const ctrl = loadControllerWithRows('cooperatives.controller.js', {
    consent_records: {
      id: 'c-1',
      entity_type: 'cooperative',
      entity_id: 'already-attached',
      status: 'active',
      third_party_sharing: true,
    },
  });
  const res = fakeRes();

  await ctrl.create(
    { body: { name: 'Another Coop', consentId: 'c-1' }, user: { userId: 'agent-1' } },
    res
  );

  assert.equal(res.body?.success, false);
  assert.match(JSON.stringify(res.body), /already attached/i);
});

test('gate: a farmer consent cannot be passed off as cooperative consent', async () => {
  const ctrl = loadControllerWithRows('cooperatives.controller.js', {
    consent_records: {
      id: 'c-1',
      entity_type: 'farmer',
      entity_id: null,
      status: 'active',
      third_party_sharing: true,
    },
  });
  const res = fakeRes();

  await ctrl.create(
    { body: { name: 'Coop', consentId: 'c-1' }, user: { userId: 'agent-1' } },
    res
  );

  assert.equal(res.body?.success, false);
  assert.match(JSON.stringify(res.body), /not a cooperative consent/i);
});
