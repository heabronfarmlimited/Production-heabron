/**
 * User + NIN verification models — ported from
 * lib/src/core/utils/base/dto/user.dart
 *
 * JSON keys are preserved exactly as the backend sends them. Note the mixed
 * convention: `User` uses camelCase while the nested `Verification` object
 * uses snake_case (it comes straight from a Postgres row). Both are kept
 * as-is so no server change is required.
 *
 * FIXED — the Dart `User.toJson()` wrote `'nin': nin`, serialising the
 * Verification *object* rather than calling `nin.toJson()`. The cached user
 * therefore could not round-trip its NIN block. `serializeUser` below does it
 * properly.
 */

/** Account lifecycle status — drives the splash screen's routing decision. */
export type UserStatus = 'pending' | 'active' | 'rejected' | 'suspended' | string;

/** NIN check outcome, per APP_DEV_HANDOFF.md. */
export type NinVerificationStatus =
  | 'verified'
  | 'mismatch'
  | 'failed'
  | 'pending'
  | string;

export interface NinVerificationPayload {
  error?: string;
  providerData?: Record<string, unknown> | null;
  providerStatus?: number;
}

/** The `nin` block on a user — an identity-verification record. */
export interface Verification {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  nin: string;
  dateOfBirth?: string | null;
  state: string;
  lga: string;
  selfieUrl: string;
  ninVerificationStatus: NinVerificationStatus;
  ninVerificationPayload?: NinVerificationPayload | null;
  selfieVerified: boolean;
  status: string;
  rejectionReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  partnerId?: string | null;
  status: UserStatus;
  mustChangePassword: boolean;
  avatarUrl?: string | null;
  phone?: string | null;
  state?: string | null;
  lga?: string | null;
  nin?: Verification | null;
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;

const bool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : fallback;

/** `NinVerificationPayload.fromJson` */
export function parseNinPayload(raw: unknown): NinVerificationPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  return {
    error: str(p.error),
    providerData:
      p.providerData && typeof p.providerData === 'object'
        ? (p.providerData as Record<string, unknown>)
        : null,
    providerStatus: typeof p.providerStatus === 'number' ? p.providerStatus : 0,
  };
}

/** `Verification.fromJson` — snake_case keys, as sent by the backend. */
export function parseVerification(raw: unknown): Verification | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  return {
    id: str(v.id),
    userId: str(v.user_id),
    fullName: str(v.full_name),
    email: str(v.email),
    phone: str(v.phone),
    nin: str(v.nin),
    dateOfBirth: nullableStr(v.date_of_birth),
    state: str(v.state),
    lga: str(v.lga),
    selfieUrl: str(v.selfie_url),
    ninVerificationStatus: str(v.nin_verification_status),
    ninVerificationPayload: parseNinPayload(v.nin_verification_payload),
    selfieVerified: bool(v.selfie_verified),
    status: str(v.status),
    rejectionReason: str(v.rejection_reason),
    reviewedBy: str(v.reviewed_by),
    reviewedAt: nullableStr(v.reviewed_at),
    createdAt: nullableStr(v.created_at),
    updatedAt: nullableStr(v.updated_at),
  };
}

/** `User.fromJson` */
export function parseUser(raw: unknown): User {
  const u = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(u.id),
    email: str(u.email),
    fullName: str(u.fullName),
    role: str(u.role),
    partnerId: nullableStr(u.partnerId),
    status: str(u.status),
    mustChangePassword: bool(u.mustChangePassword),
    avatarUrl: nullableStr(u.avatarUrl),
    phone: nullableStr(u.phone),
    state: nullableStr(u.state),
    lga: nullableStr(u.lga),
    nin: parseVerification(u.nin),
  };
}

/** `Verification.toJson` */
export function serializeVerification(v: Verification): Record<string, unknown> {
  return {
    id: v.id,
    user_id: v.userId,
    full_name: v.fullName,
    email: v.email,
    phone: v.phone,
    nin: v.nin,
    date_of_birth: v.dateOfBirth ?? null,
    state: v.state,
    lga: v.lga,
    selfie_url: v.selfieUrl,
    nin_verification_status: v.ninVerificationStatus,
    nin_verification_payload: v.ninVerificationPayload ?? null,
    selfie_verified: v.selfieVerified,
    status: v.status,
    rejection_reason: v.rejectionReason ?? null,
    reviewed_by: v.reviewedBy ?? null,
    reviewed_at: v.reviewedAt ?? null,
    created_at: v.createdAt ?? null,
    updated_at: v.updatedAt ?? null,
  };
}

/** `User.toJson` — with the nested-NIN serialisation bug fixed. */
export function serializeUser(u: User): Record<string, unknown> {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    partnerId: u.partnerId ?? null,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    avatarUrl: u.avatarUrl ?? null,
    phone: u.phone ?? null,
    state: u.state ?? null,
    lga: u.lga ?? null,
    nin: u.nin ? serializeVerification(u.nin) : null,
  };
}

// --------------------------------------------------------------- predicates
/** An approved agent who can use the authenticated app. */
export const isActive = (u?: User | null): boolean => u?.status === 'active';

/** Awaiting admin approval — routes to the "under review" screen. */
export const isPending = (u?: User | null): boolean => u?.status === 'pending';

/** Application rejected — routes to the NIN re-submission screen. */
export const isRejected = (u?: User | null): boolean => u?.status === 'rejected';
