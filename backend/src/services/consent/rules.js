'use strict';

/**
 * Data-consent rules — "CoopScore Data Consent Specification" v1.0.
 *
 * Pure functions only: no database, no network. The decisions that matter
 * legally live here so they can be tested exhaustively and read in one place.
 *
 * Two layers, both mandatory gates:
 *   Flow A  cooperative consent, given once by the leader at registration
 *   Flow B  farmer acknowledgment, given by each farmer during onboarding
 */

/** The agreement wording version these item sets belong to. */
const AGREEMENT_VERSION = 'v1.0';

/**
 * Cooperative items (spec 3.4).
 *   C1 collect information about the cooperative and its members
 *   C2 use it to create credit scores
 *   C3 share it with lenders, input suppliers and buyers
 *   C4 confirm members have been told and will each be asked
 *
 * C1, C2 and C4 must all be Yes to proceed. C3 may be No: the cooperative is
 * still registered, but third-party sharing is disabled for it.
 */
const COOPERATIVE_ITEMS = ['C1', 'C2', 'C3', 'C4'];
const COOPERATIVE_REQUIRED = ['C1', 'C2', 'C4'];
const COOPERATIVE_SHARING_ITEM = 'C3';

/**
 * Farmer items (spec 4.3).
 *   F1 give farm and repayment information to Heabron
 *   F2 use it to create the farmer's credit score
 *   F3 share it with lenders, input suppliers and buyers
 *
 * F1 and F2 must be Yes. F3 is hidden and forced to No when the cooperative
 * declined C3 — a farmer cannot grant sharing their cooperative refused.
 */
const FARMER_ITEMS = ['F1', 'F2', 'F3'];
const FARMER_REQUIRED = ['F1', 'F2'];
const FARMER_SHARING_ITEM = 'F3';

/** Languages with a reviewed notice. Others are pending translation. */
const SUPPORTED_LANGUAGES = ['en'];

/** Minimum length of the leader's recorded statement (spec 3.6). */
const MIN_VOICE_SECONDS = 3;

function itemsFor(entityType) {
  return entityType === 'cooperative' ? COOPERATIVE_ITEMS : FARMER_ITEMS;
}

function requiredFor(entityType) {
  return entityType === 'cooperative' ? COOPERATIVE_REQUIRED : FARMER_REQUIRED;
}

function sharingItemFor(entityType) {
  return entityType === 'cooperative' ? COOPERATIVE_SHARING_ITEM : FARMER_SHARING_ITEM;
}

/**
 * Validates a set of item responses.
 *
 * Returns `{ ok, errors, thirdPartySharing }`. `errors` carries a field and a
 * message per problem so the client can mark the offending question rather
 * than showing one generic failure.
 */
function validateResponses(entityType, responses, { cooperativeAllowsSharing = true } = {}) {
  const errors = [];
  const expected = itemsFor(entityType);
  const required = requiredFor(entityType);
  const sharingItem = sharingItemFor(entityType);

  if (!responses || typeof responses !== 'object') {
    return {
      ok: false,
      errors: [{ field: 'itemResponses', message: 'Consent answers are required' }],
      thirdPartySharing: false,
    };
  }

  // Every item must be answered explicitly. A missing answer is not a No:
  // the agent must have asked the question, so an absent key is an error.
  for (const item of expected) {
    const value = responses[item];
    if (typeof value !== 'boolean') {
      errors.push({ field: `itemResponses.${item}`, message: `${item} must be answered Yes or No` });
    }
  }

  // Unknown items usually mean a client built against a different agreement
  // version; rejecting them stops a silent mismatch being recorded as consent.
  for (const key of Object.keys(responses)) {
    if (!expected.includes(key)) {
      errors.push({ field: `itemResponses.${key}`, message: `${key} is not part of the ${entityType} consent` });
    }
  }

  for (const item of required) {
    if (responses[item] === false) {
      errors.push({
        field: `itemResponses.${item}`,
        message:
          entityType === 'cooperative'
            ? `${item} must be agreed to register the cooperative`
            : `${item} must be agreed to register the farmer`,
      });
    }
  }

  let thirdPartySharing = responses[sharingItem] === true;

  // A farmer cannot grant sharing that their cooperative refused (spec 4.3:
  // F3 is hidden and set to No automatically when the cooperative is flagged
  // No Third-Party Sharing).
  if (entityType === 'farmer' && !cooperativeAllowsSharing) {
    thirdPartySharing = false;
  }

  return { ok: errors.length === 0, errors, thirdPartySharing };
}

/**
 * Whether a declined registration should be recorded.
 *
 * Spec 4.4: if a farmer declines, the farmer is NOT registered and the
 * declined attempt is logged "without storing personal details". So the log
 * keeps who asked, when and which item was refused — never the person's name,
 * phone or identity numbers.
 */
function declineLogEntry({ entityType, responses, agentId, cooperativeId = null }) {
  const required = requiredFor(entityType);
  const refused = required.filter((item) => responses?.[item] === false);
  return {
    entity_type: entityType,
    cooperative_id: cooperativeId,
    refused_items: refused,
    agent_id: agentId,
    occurred_at: new Date().toISOString(),
  };
}

/**
 * Decides the status a new consent record starts in.
 *
 * `verified`  the signer confirmed the emailed code during capture
 * `pending`   captured offline, or no email address to send a code to — the
 *             spec's Pending Verification state, which an admin resolves
 */
function initialStatus({ otpVerified, signerEmail }) {
  if (otpVerified) return { status: 'active', otpStatus: 'verified' };
  if (!signerEmail) return { status: 'pending_verification', otpStatus: 'not_required' };
  return { status: 'pending_verification', otpStatus: 'pending' };
}

/**
 * The gate: may this cooperative be activated / this farmer be submitted?
 *
 * A record that is `pending_verification` still satisfies the gate — the spec
 * explicitly allows an offline capture to proceed and be verified at sync, and
 * blocking it would make the app unusable without a signal. `withdrawn` and
 * `superseded` do not.
 */
function satisfiesGate(consent) {
  if (!consent) return false;
  return consent.status === 'active' || consent.status === 'pending_verification';
}

/**
 * Whether a record may be shared with a partner organisation.
 *
 * Requires BOTH a live consent and the third-party item agreed. Withdrawal
 * stops sharing from the withdrawal date (spec 8), so a withdrawn record never
 * qualifies however its items were answered.
 */
function allowsThirdPartySharing(consent) {
  if (!consent) return false;
  if (consent.status === 'withdrawn' || consent.status === 'superseded') return false;
  return consent.third_party_sharing === true;
}

/** Whether a voice statement is long enough to count (spec 3.6). */
function voiceIsAcceptable({ durationSeconds }) {
  const n = Number(durationSeconds);
  return Number.isFinite(n) && n >= MIN_VOICE_SECONDS;
}

/**
 * Whether a newer agreement version means existing consent must be re-collected
 * (spec 8: "When the agreement version changes, the app prompts the agent to
 * collect fresh consent for existing cooperatives at the next visit").
 */
function needsRecollection(consent, currentVersion = AGREEMENT_VERSION) {
  if (!consent) return true;
  if (consent.status === 'withdrawn' || consent.status === 'superseded') return true;
  return consent.agreement_version !== currentVersion;
}

// `itemsFor`, `requiredFor`, `sharingItemFor`, COOPERATIVE_REQUIRED and
// FARMER_REQUIRED stay module-internal: they are implementation detail of
// validateResponses, and exporting them invites a caller to re-implement the
// validation rather than use it.
module.exports = {
  AGREEMENT_VERSION,
  COOPERATIVE_ITEMS,
  FARMER_ITEMS,
  SUPPORTED_LANGUAGES,
  MIN_VOICE_SECONDS,
  validateResponses,
  declineLogEntry,
  initialStatus,
  satisfiesGate,
  allowsThirdPartySharing,
  voiceIsAcceptable,
  needsRecollection,
};
