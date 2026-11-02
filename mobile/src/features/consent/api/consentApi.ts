/**
 * Consent endpoints.
 *
 * Every call goes through `api` from core/api/client.ts, which unwraps the
 * response envelope and throws `AppError`.
 */
import { api } from '../../../core/api/client';
import { endpoints } from '../../../core/api/endpoints';
import { uploadFile } from '../../auth/api/authApi';
import {
  parseConsent,
  type ConsentAnswers,
  type ConsentEntityType,
  type ConsentRecord,
} from '../model/consent';

export interface RecordConsentInput {
  entityType: ConsentEntityType;
  /** Absent when the subject does not exist yet, which is the normal case. */
  entityId?: string;
  /** Required for a farmer: the cooperative's sharing decision constrains F3. */
  cooperativeId?: string;
  agreementVersion: string;
  language: string;
  itemResponses: ConsentAnswers;

  signerName: string;
  signerRole?: string;
  signerPhone?: string;
  signerEmail?: string;

  secondOfficerName?: string;
  secondOfficerPhone?: string;
  secondOfficerEmail?: string;

  /** Storage paths, already uploaded. */
  signatureFile?: string;
  voiceFile?: string;
  voiceDurationSeconds?: number;
  unableToSign?: boolean;

  timestampDevice?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
}

export async function recordConsent(input: RecordConsentInput): Promise<ConsentRecord> {
  const data = await api.post<Record<string, unknown>>(endpoints.consent, input);
  return parseConsent(data);
}

export async function verifyConsentOtp(
  consentId: string,
  code: string,
): Promise<ConsentRecord> {
  const data = await api.post<Record<string, unknown>>(endpoints.consentVerify(consentId), {
    code,
  });
  return parseConsent(data);
}

export async function resendConsentOtp(consentId: string): Promise<void> {
  await api.post(endpoints.consentResend(consentId), {});
}

export interface EntityConsentState {
  consent: ConsentRecord | null;
  satisfiesGate: boolean;
  allowsThirdPartySharing: boolean;
  needsRecollection: boolean;
}

export async function fetchConsentForEntity(
  entityType: ConsentEntityType,
  entityId: string,
): Promise<EntityConsentState> {
  const data = await api.get<Record<string, unknown>>(
    endpoints.consentForEntity(entityType, entityId),
  );
  return {
    consent: data?.consent ? parseConsent(data.consent) : null,
    satisfiesGate: data?.satisfiesGate === true,
    allowsThirdPartySharing: data?.allowsThirdPartySharing === true,
    needsRecollection: data?.needsRecollection === true,
  };
}

/**
 * Uploads the signature image and returns its stored URL.
 *
 * `consent_signature` is a private bucket: only an admin can view what is
 * uploaded here, and partners never see it at all.
 */
export function uploadSignature(uri: string): Promise<string> {
  return uploadFile({
    uri,
    kind: 'consent_signature',
    fileName: `signature-${Date.now()}.png`,
    mimeType: 'image/png',
  });
}

/** Uploads a thumbprint photo, used when the signer cannot sign (spec 3.7). */
export function uploadThumbprint(uri: string): Promise<string> {
  return uploadFile({
    uri,
    kind: 'consent_thumbprint',
    fileName: `thumbprint-${Date.now()}.jpg`,
    mimeType: 'image/jpeg',
  });
}

/** Uploads the recorded voice statement. */
export function uploadVoice(uri: string): Promise<string> {
  const name = uri.split('/').pop() ?? `voice-${Date.now()}.m4a`;
  return uploadFile({ uri, kind: 'consent_voice', fileName: name, mimeType: 'audio/m4a' });
}
