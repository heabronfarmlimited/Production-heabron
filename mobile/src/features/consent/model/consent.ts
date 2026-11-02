/**
 * Data-consent model — "CoopScore Data Consent Specification" v1.0.
 *
 * Two layers, both mandatory gates before any data is captured:
 *   Flow A  cooperative consent, given once by the leader at registration
 *   Flow B  farmer acknowledgment, given by each farmer during onboarding
 *
 * Verification is by EMAIL, not the SMS code the specification describes:
 * there is no SMS provider on this platform. A signer with no email address
 * lands in Pending Verification for an admin to resolve, which is the state
 * the spec already defines for an offline capture.
 */

export type ConsentEntityType = 'cooperative' | 'farmer';

export type ConsentStatus = 'active' | 'pending_verification' | 'withdrawn' | 'superseded';

export type ConsentOtpStatus = 'verified' | 'pending' | 'failed' | 'not_required';

/** The agreement wording these item sets belong to. */
export const AGREEMENT_VERSION = 'v1.0';

/**
 * Languages with a reviewed notice and recording.
 *
 * Pidgin, Yoruba, Hausa and Igbo are open items in the specification — the
 * wording is not written or legally reviewed yet. Offering them would record a
 * signer as having heard a notice in their own language when they did not.
 */
export const CONSENT_LANGUAGES = [{ value: 'en', label: 'English' }] as const;

/** Minimum length of the leader's recorded statement (spec 3.6). */
export const MIN_VOICE_SECONDS = 3;

export interface ConsentQuestion {
  /** C1..C4 or F1..F3 */
  id: string;
  /** Read aloud to the signer, one question per screen. */
  prompt: string;
  /** Required answers block registration when declined. */
  required: boolean;
  /** The item that grants third-party sharing. */
  grantsSharing?: boolean;
}

/**
 * Cooperative questions, verbatim from spec 3.4.
 * C1, C2 and C4 must be Yes. C3 may be No — the cooperative is still
 * registered, but flagged No Third-Party Sharing.
 */
export const COOPERATIVE_QUESTIONS: readonly ConsentQuestion[] = [
  {
    id: 'C1',
    prompt:
      'Do you agree that Heabron may collect information about your cooperative and its members, such as farm size, crops, harvest and repayment records?',
    required: true,
  },
  {
    id: 'C2',
    prompt:
      'Do you agree that this information may be used to create credit scores for the cooperative and its members?',
    required: true,
  },
  {
    id: 'C3',
    prompt:
      'Do you agree that this information and scores may be shared with lenders, input suppliers and buyers that work with Heabron?',
    required: false,
    grantsSharing: true,
  },
  {
    id: 'C4',
    prompt:
      'Do you confirm that your members have been told about this and that each member will also be asked for their own agreement?',
    required: true,
  },
];

/**
 * Farmer questions, verbatim from spec 4.3.
 * F1 and F2 must be Yes. F3 is hidden and forced to No when the cooperative
 * declined C3 — a farmer cannot grant sharing their cooperative refused.
 */
export const FARMER_QUESTIONS: readonly ConsentQuestion[] = [
  {
    id: 'F1',
    prompt: 'Do you agree to give your farm and repayment information to Heabron?',
    required: true,
  },
  {
    id: 'F2',
    prompt: 'Do you agree that it may be used to create your credit score?',
    required: true,
  },
  {
    id: 'F3',
    prompt:
      'Do you agree that it may be shared with lenders, input suppliers and buyers?',
    required: false,
    grantsSharing: true,
  },
];

/** The notice read aloud before the questions (spec 5). */
export const CONSENT_NOTICE: Record<ConsentEntityType, string> = {
  cooperative:
    'Heabron collects information about your cooperative and its farmers, such as farm size, ' +
    'crops, harvest and loan repayment. We use it to build credit scores that help your members ' +
    'get farm inputs and loans. With your agreement, we may share this information and the scores ' +
    'with lenders, input suppliers and buyers that work with Heabron. We keep your information ' +
    'safe and only use it for these reasons. You or any member can ask us to stop collecting new ' +
    'information at any time by calling the number we will send you. Existing loan records must be ' +
    'kept until loans are settled.',
  farmer:
    'Heabron wants to record information about your farm and your loan repayment. We use it to ' +
    'create your credit score so you can get inputs and loans. If you agree, lenders, input ' +
    'suppliers and buyers that work with Heabron may see it. You can say no and nothing will be ' +
    'recorded. You can ask us to stop at any time by calling the number we will send you. Do you agree?',
};

export function questionsFor(entityType: ConsentEntityType): readonly ConsentQuestion[] {
  return entityType === 'cooperative' ? COOPERATIVE_QUESTIONS : FARMER_QUESTIONS;
}

/** Answers collected so far: item id -> Yes/No. */
export type ConsentAnswers = Record<string, boolean>;

/**
 * Whether the required items are all agreed.
 *
 * Mirrors the server rule so the app can show the outcome immediately; the
 * server decides, and re-checks every one of these.
 */
export function requiredItemsAgreed(
  entityType: ConsentEntityType,
  answers: ConsentAnswers,
): boolean {
  return questionsFor(entityType)
    .filter((q) => q.required)
    .every((q) => answers[q.id] === true);
}

/** Which required items were declined, for the "cannot continue" message. */
export function declinedRequiredItems(
  entityType: ConsentEntityType,
  answers: ConsentAnswers,
): string[] {
  return questionsFor(entityType)
    .filter((q) => q.required && answers[q.id] === false)
    .map((q) => q.id);
}

export interface ConsentRecord {
  id: string;
  entityType: ConsentEntityType;
  entityId: string | null;
  agreementVersion: string;
  language: string;
  itemResponses: ConsentAnswers;
  thirdPartySharing: boolean;
  signerName: string;
  signerRole: string | null;
  otpStatus: ConsentOtpStatus;
  status: ConsentStatus;
  createdAt: string | null;
  /** Present on the create response only. */
  requiresVerification?: boolean;
  verificationEmailSent?: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function parseConsent(raw: unknown): ConsentRecord {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(c.id),
    entityType: (str(c.entity_type) || 'cooperative') as ConsentEntityType,
    entityId: nullableStr(c.entity_id),
    agreementVersion: str(c.agreement_version) || AGREEMENT_VERSION,
    language: str(c.language) || 'en',
    itemResponses: (c.item_responses ?? {}) as ConsentAnswers,
    thirdPartySharing: c.third_party_sharing === true,
    signerName: str(c.signer_name),
    signerRole: nullableStr(c.signer_role),
    otpStatus: (str(c.otp_status) || 'pending') as ConsentOtpStatus,
    status: (str(c.status) || 'pending_verification') as ConsentStatus,
    createdAt: nullableStr(c.created_at),
    requiresVerification: c.requiresVerification === true,
    verificationEmailSent: c.verificationEmailSent === true,
  };
}

/** The gate: may onboarding proceed on this consent? */
export function satisfiesGate(consent: ConsentRecord | null): boolean {
  if (!consent) return false;
  return consent.status === 'active' || consent.status === 'pending_verification';
}
