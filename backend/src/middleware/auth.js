'use strict';

const { verifyToken } = require('../utils/jwt');
const { supabaseAdmin } = require('../config/supabase');
const { unauthorized, forbidden, fail } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * Require a valid JWT. On success, attaches `req.user`:
 *   { userId, role, partnerId, status, email, fullName }
 */
function requireAuth(options = { requireActive: true }) {
  return async function (req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return unauthorized(res, 'Missing bearer token');

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      logger.debug({ err: err.message }, 'jwt verify failed');
      return unauthorized(res, 'Invalid or expired token');
    }

    if (payload.type === 'refresh') {
      return unauthorized(res, 'Refresh token cannot be used here');
    }

    // Re-read role/status from DB so revoked / suspended users can't keep using
    // an old token's claims.
    try {
      const sb = supabaseAdmin();
      const { data: profile, error: profileErr } = await sb
        .from('profiles')
        .select('user_id, full_name, email, status')
        .eq('user_id', payload.sub)
        .maybeSingle();

      // FIXED — the query error was discarded, so `profile` came back
      // undefined on any transient database problem and every signed-in user
      // was told "Account not found" (a 401, which the clients treat as a
      // logout). Distinguish "the lookup failed" from "there is no account".
      if (profileErr) {
        logger.error(
          { err: profileErr.message, code: profileErr.code, userId: payload.sub },
          'auth profile lookup failed'
        );
        return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Could not verify your session, please retry');
      }
      if (!profile) return unauthorized(res, 'Account not found');

      if (options.requireActive && profile.status === 'suspended') {
        return forbidden(res, 'Account suspended');
      }

      const { data: roleRow, error: roleErr } = await sb
        .from('user_roles')
        .select('role, partner_id')
        .eq('user_id', payload.sub)
        .maybeSingle();

      // FIXED — this error was discarded too, and the code then fell back to
      // `payload.role` (the role baked into the token). That defeats the whole
      // point of re-reading from the database: a demoted admin whose role row
      // read happened to fail kept their admin claim. Fail closed on an error.
      // A genuinely absent row still falls back to the token claim, because a
      // freshly created agent may hit this before the profile trigger has run.
      if (roleErr) {
        logger.error(
          { err: roleErr.message, code: roleErr.code, userId: payload.sub },
          'auth role lookup failed'
        );
        return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Could not verify your session, please retry');
      }
      if (!roleRow) {
        logger.warn({ userId: payload.sub, tokenRole: payload.role }, 'no user_roles row — falling back to token claim');
      }

      // `req` is per-request: no other task can observe or mutate this object
      // between the awaits above and this assignment, so there is no
      // interleaving for require-atomic-updates to protect against here.
      // eslint-disable-next-line require-atomic-updates
      req.user = {
        userId: profile.user_id,
        email: profile.email,
        fullName: profile.full_name,
        status: profile.status,
        role: roleRow?.role || payload.role,
        partnerId: roleRow?.partner_id || payload.partnerId || null,
      };

      return next();
    } catch (err) {
      logger.error({ err }, 'auth lookup failed');
      return unauthorized(res, 'Authentication failed');
    }
  };
}

const ADMIN_ROLES = ['super_admin', 'ops_admin', 'finance_admin'];
const PARTNER_ROLES = ['partner_admin', 'partner_analyst'];

// FIXED — `requireRole(...)` and `requireSuperAdmin` were exported but never
// mounted on any route. Removed rather than left as plausible-looking
// scaffolding that a future route might reach for believing it is in use.

const requireAdmin = (req, res, next) => {
  if (!req.user) return unauthorized(res);
  if (!ADMIN_ROLES.includes(req.user.role)) return forbidden(res, 'Admin only');
  // FIXED — only `requireFieldAgent` checked the account status, so a
  // `rejected` admin or partner kept full access to every endpoint on their
  // side of the API. `requireAuth` blocks `suspended`; this blocks the rest.
  if (req.user.status !== 'active') return forbidden(res, `Account is ${req.user.status}`);
  return next();
};

const requirePartner = (req, res, next) => {
  if (!req.user) return unauthorized(res);
  if (!PARTNER_ROLES.includes(req.user.role)) return forbidden(res, 'Partner only');
  if (!req.user.partnerId) return forbidden(res, 'Partner organization not linked');
  if (req.user.status !== 'active') return forbidden(res, `Account is ${req.user.status}`);
  return next();
};

const requireFieldAgent = (req, res, next) => {
  if (!req.user) return unauthorized(res);
  if (req.user.role !== 'field_agent') return forbidden(res, 'Field agent only');
  if (req.user.status !== 'active') {
    return forbidden(res, `Account is ${req.user.status}. Awaiting admin approval.`);
  }
  return next();
};

module.exports = {
  requireAuth,
  requireAdmin,
  requirePartner,
  requireFieldAgent,
  ADMIN_ROLES,
  PARTNER_ROLES,
};
