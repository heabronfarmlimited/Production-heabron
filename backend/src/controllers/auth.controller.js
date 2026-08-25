'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { signAccessToken, signRefreshToken, verifyToken } = require('../utils/jwt');
const { generateOtp } = require('../utils/crypto');
const { ok, created, badRequest, unauthorized, notFound, conflict, serverError } = require('../utils/response');
const email = require('../services/email');
const { logActivity } = require('../utils/activity');
const config = require('../config');
const logger = require('../utils/logger');

const OTP_TTL_MIN = 10;

/**
 * Normalize an email the same way the Joi validators do (lowercase + trim).
 * Used everywhere OTP rows are written or read so we never miss a row
 * because of case/whitespace differences.
 */
function normalizeEmail(e) {
  return String(e || '').toLowerCase().trim();
}

async function createOtp(emailAddr, purpose) {
  const sb = supabaseAdmin();
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();
  const normalized = normalizeEmail(emailAddr);

  // Invalidate prior unconsumed OTPs for the same purpose
  const { error: updErr } = await sb
    .from('otp_codes')
    .update({ consumed: true })
    .eq('email', normalized)
    .eq('purpose', purpose)
    .eq('consumed', false);
  if (updErr) {
    // Not fatal on its own, but log loudly. If this is an RLS error it's the
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

async function consumeOtp(emailAddr, code, purpose) {
  const sb = supabaseAdmin();
  const normalized = normalizeEmail(emailAddr);

  // Fetch the latest non-consumed OTP for this email + purpose, then verify
  // the code in JS so we can distinguish "no OTP at all" from "wrong code".
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

function buildAuthPayload(profile, role, partnerId) {
  const payload = {
    sub: profile.user_id,
    role: role || 'field_agent',
    partnerId: partnerId || null,
    status: profile.status,
    email: profile.email,
  };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    user: {
      id: profile.user_id,
      email: profile.email,
      fullName: profile.full_name,
      role: role || 'field_agent',
      partnerId: partnerId || null,
      status: profile.status,
      mustChangePassword: profile.must_change_password,
      avatarUrl: profile.avatar_url,
    },
  };
}

// ============================================================================
// STEP 1 — Sign up: email + password
// Creates the auth.users row and triggers a verification OTP. The agent's
// profile/KYC is added in step 3.
// ============================================================================
async function signupStep1(req, res) {
  const sb = supabaseAdmin();
  const { email: emailAddr, password } = req.body;
  const normalized = normalizeEmail(emailAddr);

  // Check if email already exists
  const { data: existing } = await sb.auth.admin.listUsers();
  const taken = existing?.users?.some((u) => u.email?.toLowerCase() === normalized);
  if (taken) return conflict(res, 'Email already registered');

  const { data, error } = await sb.auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: false,
    user_metadata: { role: 'field_agent' },
  });
  if (error) {
    logger.warn({ err: error.message }, 'signup create user failed');
    return badRequest(res, error.message);
  }

  // Send OTP — if creating the OTP row fails we MUST surface that. Previously
  // the insert was awaited without checking the result, so a silent RLS / key
  // failure produced a 201 with no row in otp_codes and a confusing
  // "OTP not_found" on verify.
  let code;
  try {
    code = await createOtp(normalized, 'signup');
  } catch (e) {
    logger.error({ err: e.message }, 'createOtp threw inside signupStep1');
    return serverError(res, 'Could not create verification code, please try again');
  }
  email.safe(email.sendOtp)(normalized, { fullName: '', otpCode: code, purpose: 'signup' });

  return created(res, {
    userId: data.user.id,
    email: normalized,
    nextStep: 'verify_otp',
    otpSentTo: normalized,
  });
}

// ============================================================================
// STEP 2 — Verify OTP
// ============================================================================
async function verifySignupOtp(req, res) {
  const { email: emailAddr, code, purpose } = req.body;
  const result = await consumeOtp(emailAddr, code, purpose);
  if (!result.ok) return badRequest(res, `OTP ${result.reason}`);

  if (purpose === 'signup') {
    const sb = supabaseAdmin();
    const normalized = normalizeEmail(emailAddr);
    const { data: list } = await sb.auth.admin.listUsers();
    const user = list?.users?.find((u) => u.email?.toLowerCase() === normalized);
    if (user) {
      await sb.auth.admin.updateUserById(user.id, { email_confirm: true });
    }
  }
  return ok(res, { verified: true });
}

// ============================================================================
// Resend OTP
// ============================================================================
async function resendOtp(req, res) {
  const { email: emailAddr, purpose } = req.body;
  const normalized = normalizeEmail(emailAddr);
  let code;
  try {
    code = await createOtp(normalized, purpose);
  } catch (e) {
    logger.error({ err: e.message }, 'createOtp threw inside resendOtp');
    return serverError(res, 'Could not create verification code, please try again');
  }
  email.safe(email.sendOtp)(normalized, { fullName: '', otpCode: code, purpose });
  return ok(res, { resent: true });
}

// ============================================================================
// STEP 3 — Complete signup (submit KYC: name, phone, NIN, DOB, state, LGA, selfie)
// Body: { fullName, phone, nin, dateOfBirth, state, lga, selfieUrl? }
// Auth: requires Bearer of a freshly-issued pre-approval token OR
//       email+password basic auth. We accept a Bearer issued at login.
// ============================================================================
async function completeSignup(req, res) {
  const sb = supabaseAdmin();
  const userId = req.user.userId;
  const { fullName, phone, nin, dateOfBirth, state, lga, selfieUrl } = req.body;

  // Update profile
  await sb.from('profiles').update({
    full_name: fullName,
    phone,
    state,
    lga,
    // The onboarding selfie doubles as the agent's profile avatar so it shows
    // on their profile/dashboard (read back as `avatarUrl` from /auth/me).
    // Only overwrite when a selfie was actually provided.
    ...(selfieUrl ? { avatar_url: selfieUrl } : {}),
    status: 'pending',
  }).eq('user_id', userId);

  // Create / update agent_applications row
  const { data: existing } = await sb
    .from('agent_applications')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  const appPayload = {
    user_id: userId,
    full_name: fullName,
    email: req.user.email,
    phone,
    nin,
    date_of_birth: dateOfBirth,
    state,
    lga,
    selfie_url: selfieUrl || null,
    status: 'pending',
  };

  if (existing) {
    await sb.from('agent_applications').update(appPayload).eq('id', existing.id);
  } else {
    await sb.from('agent_applications').insert(appPayload);
  }

  // Run NIN verification (best-effort)
  const ninService = require('../services/nin');
  const ninResult = await ninService.verifyNin({ nin, firstName: fullName.split(' ')[0], lastName: fullName.split(' ').slice(-1)[0], dateOfBirth });
  await sb.from('agent_applications').update({
    nin_verification_status: ninResult.status === 'verified' || ninResult.status === 'mismatch' ? ninResult.status : 'failed',
    nin_verification_payload: ninResult.raw,
  }).eq('user_id', userId);

  email.safe(email.sendAgentApplicationSubmitted)(req.user.email, { fullName });

  // Notify all super_admins
  const { data: admins } = await sb.from('user_roles').select('user_id').eq('role', 'super_admin');
  if (admins?.length) {
    const userIds = admins.map((a) => a.user_id);
    await sb.from('notifications').insert(userIds.map((uid) => ({
      user_id: uid,
      type: 'agent_application_submitted',
      title: 'New field agent application',
      message: `${fullName} submitted a field agent application`,
      metadata: { agentUserId: userId },
    })));
  }

  await logActivity({ actor: { userId, role: 'field_agent' }, action: 'agent_application_submitted', entityType: 'agent_application', entityId: userId, req });

  return ok(res, {
    status: 'pending',
    message: 'Application submitted. You will receive an email when an admin approves it.',
    ninVerification: ninResult.status,
  });
}

// ============================================================================
// RESUBMIT NIN — used when an agent's application was rejected due to a
// NIN mismatch / failure. The agent updates their first name, last name,
// NIN, and date-of-birth, we re-verify with the provider, and flip the
// application back to pending for admin re-review.
//
// Body: { firstName, lastName, nin, dateOfBirth }
// Auth: requires Bearer; works for any account status (pending|rejected|active)
// ============================================================================
async function resubmitNin(req, res) {
  const sb = supabaseAdmin();
  const userId = req.user.userId;
  const { firstName, lastName, nin, dateOfBirth } = req.body;
  const fullName = `${firstName} ${lastName}`.trim();

  // Locate the existing application
  const { data: existing } = await sb
    .from('agent_applications')
    .select('id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (!existing) {
    return badRequest(res, 'No existing application found. Use /auth/signup/complete first.');
  }

  // Re-verify with Dojah (or current provider)
  const ninService = require('../services/nin');
  const ninResult = await ninService.verifyNin({ nin, firstName, lastName, dateOfBirth });

  // Persist the new identity details + provider result + flip status
  const appPatch = {
    full_name: fullName,
    nin,
    date_of_birth: dateOfBirth,
    nin_verification_status:
      ninResult.status === 'verified' || ninResult.status === 'mismatch'
        ? ninResult.status
        : 'failed',
    nin_verification_payload: ninResult.raw,
    status: 'pending',
    rejection_reason: null,
  };
  await sb.from('agent_applications').update(appPatch).eq('id', existing.id);

  // Mirror to profile so /me reflects the corrected name + pending status
  await sb.from('profiles').update({
    full_name: fullName,
    status: 'pending',
  }).eq('user_id', userId);

  // Notify admins so they know to re-review
  const { data: admins } = await sb.from('user_roles').select('user_id').in('role', ['super_admin', 'ops_admin']);
  if (admins?.length) {
    const userIds = admins.map((a) => a.user_id);
    try {
      await sb.from('notifications').insert(userIds.map((uid) => ({
        user_id: uid,
        type: 'agent_application_submitted',
        title: 'Field agent re-submitted NIN',
        message: `${fullName} re-submitted NIN details after rejection`,
        metadata: { agentUserId: userId },
      })));
    } catch (e) {
      logger.warn({ err: e.message }, 'NIN resubmit admin notification failed');
    }
  }

  await logActivity({
    actor: { userId, role: 'field_agent' },
    action: 'agent_nin_resubmitted',
    entityType: 'agent_application',
    entityId: userId,
    metadata: { ninVerificationStatus: appPatch.nin_verification_status },
    req,
  });

  return ok(res, {
    status: 'pending',
    ninVerification: ninResult.status,
    message: 'NIN details re-submitted. An admin will review again shortly.',
  });
}

// ============================================================================
// LOGIN
// ============================================================================
async function login(req, res) {
  const sb = supabaseAdmin();
  const { email: emailAddr, password } = req.body;

  // Use Supabase Auth to verify credentials
  const { data, error } = await sb.auth.signInWithPassword({ email: emailAddr, password });
  if (error) {
    logger.debug({ err: error.message }, 'login failed');
    return unauthorized(res, 'Invalid email or password');
  }

  const userId = data.user.id;
  const { data: profile } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (!profile) return unauthorized(res, 'Profile missing — contact support');

  const { data: roleRow } = await sb.from('user_roles').select('role, partner_id').eq('user_id', userId).maybeSingle();

  await sb.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('user_id', userId);

  const tokens = buildAuthPayload(profile, roleRow?.role, roleRow?.partner_id);

  // For partners, attach the partner organization details
  let partner = null;
  if (roleRow?.partner_id) {
    const { data: p } = await sb.from('partners').select('id, organization_name, logo_url, status').eq('id', roleRow.partner_id).maybeSingle();
    partner = p ? { id: p.id, organizationName: p.organization_name, logoUrl: p.logo_url, status: p.status } : null;
  }

  await logActivity({ actor: { userId, role: roleRow?.role }, action: 'login', entityType: 'user', entityId: userId, req });

  return ok(res, { ...tokens, partner });
}

// ============================================================================
// REFRESH
// ============================================================================
async function refresh(req, res) {
  const { refreshToken } = req.body;
  let payload;
  try {
    payload = verifyToken(refreshToken);
  } catch {
    return unauthorized(res, 'Invalid refresh token');
  }
  if (payload.type !== 'refresh') return unauthorized(res, 'Not a refresh token');

  const sb = supabaseAdmin();
  const { data: profile } = await sb.from('profiles').select('*').eq('user_id', payload.sub).maybeSingle();
  if (!profile) return unauthorized(res, 'User no longer exists');
  const { data: roleRow } = await sb.from('user_roles').select('role, partner_id').eq('user_id', payload.sub).maybeSingle();
  return ok(res, buildAuthPayload(profile, roleRow?.role, roleRow?.partner_id));
}

// ============================================================================
// LOGOUT (best-effort, stateless JWT)
// ============================================================================
async function logout(req, res) {
  await logActivity({ actor: { userId: req.user?.userId, role: req.user?.role }, action: 'logout', entityType: 'user', entityId: req.user?.userId, req });
  return ok(res, { loggedOut: true });
}

// ============================================================================
// FORGOT / RESET PASSWORD
// ============================================================================
async function forgotPassword(req, res) {
  const { email: emailAddr } = req.body;
  const normalized = normalizeEmail(emailAddr);
  const sb = supabaseAdmin();
  const { data: list } = await sb.auth.admin.listUsers();
  const user = list?.users?.find((u) => u.email?.toLowerCase() === normalized);

  // Always reply OK to avoid leaking which emails exist
  if (!user) {
    return ok(res, { sent: true });
  }
  let code;
  try {
    code = await createOtp(normalized, 'password_reset');
  } catch (e) {
    logger.error({ err: e.message }, 'createOtp threw inside forgotPassword');
    // Still respond OK to avoid leaking that the account exists, but the user
    // won't receive an email. The error is in the log.
    return ok(res, { sent: true });
  }
  const { data: profile } = await sb.from('profiles').select('full_name').eq('user_id', user.id).maybeSingle();
  email.safe(email.sendOtp)(normalized, { fullName: profile?.full_name || '', otpCode: code, purpose: 'password_reset' });
  return ok(res, { sent: true });
}

async function resetPassword(req, res) {
  const { email: emailAddr, code, newPassword } = req.body;
  const result = await consumeOtp(emailAddr, code, 'password_reset');
  if (!result.ok) return badRequest(res, `OTP ${result.reason}`);

  const sb = supabaseAdmin();
  const normalized = normalizeEmail(emailAddr);
  const { data: list } = await sb.auth.admin.listUsers();
  const user = list?.users?.find((u) => u.email?.toLowerCase() === normalized);
  if (!user) return notFound(res, 'Account not found');

  await sb.auth.admin.updateUserById(user.id, { password: newPassword });
  await sb.from('profiles').update({ must_change_password: false }).eq('user_id', user.id);
  await logActivity({ actor: { userId: user.id }, action: 'password_reset', entityType: 'user', entityId: user.id, req });
  return ok(res, { reset: true });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const sb = supabaseAdmin();
  // Verify current password via signInWithPassword
  const { error: signErr } = await sb.auth.signInWithPassword({
    email: req.user.email,
    password: currentPassword,
  });
  if (signErr) return badRequest(res, 'Current password is incorrect');
  await sb.auth.admin.updateUserById(req.user.userId, { password: newPassword });
  await sb.from('profiles').update({ must_change_password: false }).eq('user_id', req.user.userId);
  await logActivity({ actor: { userId: req.user.userId, role: req.user.role }, action: 'password_changed', entityType: 'user', entityId: req.user.userId, req });
  return ok(res, { changed: true });
}

// ============================================================================
// ME — current user info
// ============================================================================
async function me(req, res) {
  const sb = supabaseAdmin();
  const { data: profile } = await sb.from('profiles').select('*').eq('user_id', req.user.userId).maybeSingle();
  const { data: roleRow } = await sb.from('user_roles').select('role, partner_id').eq('user_id', req.user.userId).maybeSingle();

  let application = null;
  let partner = null;
  if (roleRow?.role === 'field_agent') {
    const { data } = await sb.from('agent_applications').select('*').eq('user_id', req.user.userId).maybeSingle();
    application = data;
  }
  if (roleRow?.partner_id) {
    const { data } = await sb.from('partners').select('*').eq('id', roleRow.partner_id).maybeSingle();
    partner = data;
  }

  return ok(res, {
    user: {
      id: profile.user_id,
      email: profile.email,
      fullName: profile.full_name,
      phone: profile.phone,
      avatarUrl: profile.avatar_url,
      state: profile.state,
      lga: profile.lga,
      status: profile.status,
      mustChangePassword: profile.must_change_password,
      role: roleRow?.role,
      partnerId: roleRow?.partner_id,
    },
    application,
    partner,
  });
}

module.exports = {
  signupStep1,
  verifySignupOtp,
  resendOtp,
  completeSignup,
  resubmitNin,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  me,
};