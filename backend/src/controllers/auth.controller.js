'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { signAccessToken, signRefreshToken, verifyToken } = require('../utils/jwt');
const { generateOtp } = require('../utils/crypto');
const { ok, created, badRequest, unauthorized, notFound, conflict, serverError } = require('../utils/response');
const email = require('../services/email');
const { logActivity } = require('../utils/activity');
const logger = require('../utils/logger');
const { ADMIN_ROLES } = require('../middleware/auth');

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
/** Supabase's duplicate-email error text varies by version; match broadly. */
function isDuplicateUserError(message) {
  return /already been registered|already registered|already exists|duplicate key/i.test(
    message || ''
  );
}

async function signupStep1(req, res) {
  const sb = supabaseAdmin();
  const { email: emailAddr, password } = req.body;
  const normalized = normalizeEmail(emailAddr);

  // FIXED — this used to call `sb.auth.admin.listUsers()` and scan the result
  // for a matching address. Two bugs:
  //   1. `listUsers()` paginates at 50 by default, so past 50 agents the
  //      duplicate check silently stopped working.
  //   2. It fetched the whole user table on every signup, which is the main
  //      reason signup felt slow ("takes forever before they get the OTP").
  // `createUser` already rejects a duplicate, so we let it tell us.
  const { data, error } = await sb.auth.admin.createUser({
    email: normalized,
    password,
    // FIXED — was `false`. Heabron runs its own OTP verification and its own
    // admin approval, so Supabase's email-confirmation flag is not the gate.
    //
    // Leaving it false was breaking logins outright: `login()` uses
    // `signInWithPassword`, which Supabase rejects with "Email not confirmed"
    // while this flag is false. The flag was only flipped in
    // `verifySignupOtp` via the same broken `listUsers()` lookup, so any agent
    // who wasn't in the first 50 users verified their OTP successfully and
    // then could never log in — surfacing as "Invalid email or password".
    email_confirm: true,
    user_metadata: { role: 'field_agent' },
  });

  if (error) {
    if (isDuplicateUserError(error.message)) {
      return conflict(res, 'Email already registered');
    }
    logger.warn({ err: error.message }, 'signup create user failed');
    return badRequest(res, error.message);
  }

  // If creating the OTP row fails we MUST surface that. Previously the insert
  // was awaited without checking the result, so a silent RLS / key failure
  // produced a 201 with no row in otp_codes and a confusing "OTP not_found"
  // on verify.
  let code;
  try {
    code = await createOtp(normalized, 'signup');
  } catch (e) {
    logger.error({ err: e.message }, 'createOtp threw inside signupStep1');
    return serverError(res, 'Could not create verification code, please try again');
  }

  // FIXED — this was `email.safe(email.sendOtp)(...)`, which is deliberately
  // fire-and-forget. That is fatal on a serverless host: Vercel freezes the
  // function as soon as the response is returned, killing the in-flight HTTPS
  // request to Resend. Whether the mail escaped depended on whether the
  // instance happened to stay warm — which is exactly why agents sometimes
  // got the code and sometimes never did.
  //
  // The send is now awaited, and a delivery failure is reported rather than
  // swallowed, so the app can tell the agent to retry instead of parking them
  // on an OTP screen for a code that will never arrive.
  const delivery = await email.sendOtp(normalized, {
    fullName: '',
    otpCode: code,
    purpose: 'signup',
  });

  if (delivery?.error) {
    logger.error(
      { err: delivery.error, email: normalized },
      'OTP email delivery failed during signup'
    );
    return serverError(
      res,
      'We could not send your verification code. Please check the address and try again.'
    );
  }

  return created(res, {
    userId: data.user.id,
    email: normalized,
    nextStep: 'verify_otp',
    otpSentTo: normalized,
    // `true` when RESEND_API_KEY is unset (dry run) so staging is obvious.
    emailSkipped: Boolean(delivery?.skipped),
  });
}

// ============================================================================
// STEP 2 — Verify OTP
// ============================================================================
async function verifySignupOtp(req, res) {
  const { email: emailAddr, code, purpose } = req.body;
  const result = await consumeOtp(emailAddr, code, purpose);
  if (!result.ok) return badRequest(res, `OTP ${result.reason}`);

  // FIXED — this used to run a second full `listUsers()` scan to find the user
  // and set `email_confirm: true`. Past 50 users the lookup returned nothing,
  // the flag was never set, and the agent could never log in afterwards.
  //
  // `signupStep1` now creates the user already confirmed, so there is nothing
  // to patch up here. Consuming the OTP is the verification.
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
  // FIXED — was fire-and-forget, which is killed when a serverless instance
  // freezes on response. Awaited so a resend that fails says so instead of
  // leaving the agent tapping "Resend" against a code that never ships.
  const delivery = await email.sendOtp(normalized, {
    fullName: '',
    otpCode: code,
    purpose,
  });

  if (delivery?.error) {
    logger.error({ err: delivery.error, email: normalized, purpose }, 'OTP resend failed');
    return serverError(res, 'We could not resend your code. Please try again shortly.');
  }

  return ok(res, { resent: true, emailSkipped: Boolean(delivery?.skipped) });
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

  // FIXED (audit) — the last remaining fire-and-forget email in the codebase.
  // `email.safe()` used to return undefined; it now returns the promise, so
  // this is awaited like the other 15 call sites. On Vercel the lambda is
  // frozen when the response is written, so the agent's "we received your
  // application" confirmation was being killed in flight — the same defect
  // the OTP send above was already fixed for.
  const appEmail = await email.safe(email.sendAgentApplicationSubmitted)(req.user.email, { fullName });
  if (appEmail?.error) {
    logger.warn({ err: appEmail.error, to: req.user.email }, 'application received email rejected');
  }

  // Notify all admins.
  // FIXED (audit) — this filtered `.eq('role', 'super_admin')`, so ops_admin
  // and finance_admin were never told a new application had arrived, unlike
  // every other admin broadcast in the codebase (which use ADMIN_ROLES).
  const { data: admins, error: adminErr } = await sb
    .from('user_roles')
    .select('user_id')
    .in('role', ADMIN_ROLES);
  if (adminErr) logger.warn({ err: adminErr.message, code: adminErr.code }, 'admin lookup for application notification failed');
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
  const { data, error } = await sb.auth.signInWithPassword({
    email: normalizeEmail(emailAddr),
    password,
  });

  if (error) {
    // FIXED — this logged at `debug`, which is below the production log level,
    // so the real Supabase reason was invisible. "Email not confirmed" in
    // particular was being reported to agents as "Invalid email or password",
    // which made a configuration bug look like a forgotten password.
    logger.warn(
      { err: error.message, status: error.status, email: normalizeEmail(emailAddr) },
      'login failed'
    );

    // Self-heal accounts left unconfirmed by the old signup path: Heabron
    // gates on its own OTP plus admin approval, so an unconfirmed Supabase
    // flag is a leftover of the previous bug, never a security boundary.
    if (/email not confirmed/i.test(error.message || '')) {
      const healed = await confirmEmailByAddress(normalizeEmail(emailAddr));
      if (healed) {
        const retry = await sb.auth.signInWithPassword({
          email: normalizeEmail(emailAddr),
          password,
        });
        if (!retry.error && retry.data?.user) {
          logger.info(
            { email: normalizeEmail(emailAddr) },
            'login recovered after confirming a legacy unconfirmed account'
          );
          return finishLogin(req, res, sb, retry.data.user.id);
        }
      }
    }

    return unauthorized(res, 'Invalid email or password');
  }

  return finishLogin(req, res, sb, data.user.id);
}

/**
 * Loads the profile and role for an authenticated user and returns the token
 * payload. Extracted so the legacy-account recovery path above can reuse it
 * rather than duplicating the response shape.
 */
async function finishLogin(req, res, sb, userId) {
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

/**
 * Finds one auth user by email address, paging through `listUsers()`.
 *
 * FIXED — three separate call sites each did:
 *
 *     const { data: list } = await sb.auth.admin.listUsers();
 *     const user = list?.users?.find((u) => u.email?.toLowerCase() === normalized);
 *
 * `listUsers()` returns **page 1 at 50 per page** by default. Past 50 users
 * every one of those lookups silently returned `undefined`, producing three
 * failures with no error logged anywhere:
 *
 *   - `verifySignupOtp` never set `email_confirm`, so the agent could never
 *     log in (surfaced to them as "Invalid email or password")
 *   - `forgotPassword` returned `{ sent: true }` and sent nothing — the
 *     deliberate non-enumeration response made the miss invisible
 *   - `resetPassword` returned "Account not found"
 *
 * Net effect for any agent beyond the 50th: locked out, with every recovery
 * path also broken. This helper pages properly and is bounded.
 *
 * Note it is still O(users / 200) requests. Once the user table passes a few
 * thousand, replace it with a direct lookup — a `profiles.email` index
 * populated at signup is the obvious one.
 */
const LIST_USERS_PER_PAGE = 200;
const LIST_USERS_MAX_PAGES = 25; // 5,000 users

async function findAuthUserByEmail(normalized) {
  if (!normalized) return null;
  const sb = supabaseAdmin();

  for (let page = 1; page <= LIST_USERS_MAX_PAGES; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PER_PAGE,
    });

    if (error) {
      logger.error({ err: error.message, page }, 'listUsers failed');
      return null;
    }

    const users = data?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === normalized);
    if (match) return match;

    if (users.length < LIST_USERS_PER_PAGE) return null; // last page
  }

  logger.warn(
    { email: normalized, maxPages: LIST_USERS_MAX_PAGES },
    'findAuthUserByEmail exhausted its page budget — the user table has ' +
      'outgrown this lookup; add a profiles.email index and query that instead'
  );
  return null;
}

/**
 * Sets `email_confirm: true` for one address. Used only to recover accounts
 * stranded by the previous signup path; new signups are created confirmed.
 */
async function confirmEmailByAddress(normalized) {
  const match = await findAuthUserByEmail(normalized);
  if (!match) return false;

  const { error } = await supabaseAdmin().auth.admin.updateUserById(match.id, {
    email_confirm: true,
  });
  if (error) {
    logger.error({ err: error.message, userId: match.id }, 'email_confirm update failed');
    return false;
  }
  return true;
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

  // FIXED — was an unpaginated `listUsers()`, so for any agent past the 50th
  // this returned undefined and the function returned `{ sent: true }` having
  // sent nothing. The non-enumeration response made that completely silent:
  // password reset simply did not work and nobody could tell.
  const user = await findAuthUserByEmail(normalized);

  // Always reply OK to avoid leaking which emails exist
  if (!user) {
    logger.info({ email: normalized }, 'forgot-password requested for unknown address');
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
  // Awaited for the same serverless reason as signup. The response stays a
  // flat `{ sent: true }` either way so the endpoint cannot be used to probe
  // which addresses exist; a delivery failure is recorded in the log.
  const delivery = await email.sendOtp(normalized, {
    fullName: profile?.full_name || '',
    otpCode: code,
    purpose: 'password_reset',
  });

  if (delivery?.error) {
    logger.error(
      { err: delivery.error, email: normalized },
      'password-reset OTP delivery failed'
    );
  }

  return ok(res, { sent: true });
}

async function resetPassword(req, res) {
  const { email: emailAddr, code, newPassword } = req.body;
  const result = await consumeOtp(emailAddr, code, 'password_reset');
  if (!result.ok) return badRequest(res, `OTP ${result.reason}`);

  const sb = supabaseAdmin();
  const normalized = normalizeEmail(emailAddr);

  // FIXED — same unpaginated `listUsers()` bug: an agent past the 50th who
  // somehow obtained a valid code was told "Account not found".
  const user = await findAuthUserByEmail(normalized);
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