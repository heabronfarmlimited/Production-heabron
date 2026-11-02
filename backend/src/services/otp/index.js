'use strict';

/**
 * One-time codes, shared by every flow that needs to verify an email address.
 *
 * Extracted from auth.controller.js unchanged so the consent flow verifies a
 * signer with exactly the same code path the signup flow uses — same table,
 * same expiry, same invalidate-previous behaviour, same error reporting. A
 * second implementation would be a second thing to keep correct, and OTP bugs
 * are the kind that fail silently.
 *
 * Purposes must be in the `otp_codes.purpose` CHECK constraint; see
 * `OTP_PURPOSES` below and migration 011.
 */

const { supabaseAdmin } = require('../../config/supabase');
const { generateOtp } = require('../../utils/crypto');
const logger = require('../../utils/logger');

/** Minutes a code stays valid. */
const OTP_TTL_MIN = 10;

/** Must match the CHECK constraint on otp_codes.purpose. */
const OTP_PURPOSES = Object.freeze({
  SIGNUP: 'signup',
  PASSWORD_RESET: 'password_reset',
  EMAIL_VERIFY: 'email_verify',
  CONSENT: 'consent',
});

function normalizeEmail(e) {
  return String(e || '').toLowerCase().trim();
}

/**
 * Issues a code for `emailAddr` and `purpose`, invalidating any previous
 * unconsumed code for the same pair. Returns the code so the caller can send
 * it; it is never logged.
 *
 * Throws when the insert fails — a code that was not stored can never be
 * verified, so the caller must not go on to tell the user one was sent.
 */
async function createOtp(emailAddr, purpose) {
  const sb = supabaseAdmin();
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();
  const normalized = normalizeEmail(emailAddr);

  const { error: updErr } = await sb
    .from('otp_codes')
    .update({ consumed: true })
    .eq('email', normalized)
    .eq('purpose', purpose)
    .eq('consumed', false);
  if (updErr) {
    // Not fatal on its own, but log loudly. If this is an RLS error it is the
    // same root cause that will break the insert below.
    logger.error(
      { err: updErr.message, code: updErr.code, hint: updErr.hint, details: updErr.details, email: normalized, purpose },
      'OTP invalidate-previous failed'
    );
  }

  const { data, error: insErr } = await sb
    .from('otp_codes')
    .insert({ email: normalized, code, purpose, expires_at: expiresAt })
    .select('id')
    .single();
  if (insErr) {
    logger.error(
      { err: insErr.message, code: insErr.code, hint: insErr.hint, details: insErr.details, email: normalized, purpose },
      'OTP insert failed'
    );
    throw new Error(`OTP insert failed: ${insErr.message}`);
  }

  logger.info({ otpId: data.id, email: normalized, purpose }, 'OTP created');
  return code;
}

/**
 * Verifies and consumes a code.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }`, where reason is one of
 * `lookup_error`, `not_found`, `invalid`, `expired`, `mark_consumed_failed`.
 * Distinguishing them lets the caller log precisely while still showing the
 * user a single message, so a wrong code cannot be told apart from a missing
 * one by probing.
 */
async function consumeOtp(emailAddr, code, purpose) {
  const sb = supabaseAdmin();
  const normalized = normalizeEmail(emailAddr);

  const { data, error } = await sb
    .from('otp_codes')
    .select('id, code, expires_at, consumed')
    .eq('email', normalized)
    .eq('purpose', purpose)
    .eq('consumed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error(
      { err: error.message, code: error.code, hint: error.hint, details: error.details, email: normalized, purpose },
      'OTP lookup failed'
    );
    return { ok: false, reason: 'lookup_error' };
  }
  if (!data) return { ok: false, reason: 'not_found' };
  if (String(data.code) !== String(code)) return { ok: false, reason: 'invalid' };
  if (new Date(data.expires_at) < new Date()) return { ok: false, reason: 'expired' };

  const { error: markErr } = await sb
    .from('otp_codes')
    .update({ consumed: true })
    .eq('id', data.id);
  if (markErr) {
    logger.error({ err: markErr.message, otpId: data.id }, 'OTP mark-consumed failed');
    return { ok: false, reason: 'mark_consumed_failed' };
  }
  return { ok: true };
}

module.exports = {
  OTP_TTL_MIN,
  OTP_PURPOSES,
  normalizeEmail,
  createOtp,
  consumeOtp,
};
