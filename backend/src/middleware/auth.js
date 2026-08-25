'use strict';

const { verifyToken } = require('../utils/jwt');
const { supabaseAdmin } = require('../config/supabase');
const { unauthorized, forbidden } = require('../utils/response');
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
      const { data: profile } = await sb
        .from('profiles')
        .select('user_id, full_name, email, status')
        .eq('user_id', payload.sub)
        .maybeSingle();

      if (!profile) return unauthorized(res, 'Account not found');

      if (options.requireActive && profile.status === 'suspended') {
        return forbidden(res, 'Account suspended');
      }

      const { data: roleRow } = await sb
        .from('user_roles')
        .select('role, partner_id')
        .eq('user_id', payload.sub)
        .maybeSingle();

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

/**
 * Require any of the listed roles.
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) return unauthorized(res);
    if (!roles.includes(req.user.role)) {
      return forbidden(res, `Requires role: ${roles.join(' or ')}`);
    }
    return next();
  };
}

const requireAdmin = (req, res, next) => {
  if (!req.user) return unauthorized(res);
  if (!ADMIN_ROLES.includes(req.user.role)) return forbidden(res, 'Admin only');
  return next();
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user) return unauthorized(res);
  if (req.user.role !== 'super_admin') return forbidden(res, 'Super admin only');
  return next();
};

const requirePartner = (req, res, next) => {
  if (!req.user) return unauthorized(res);
  if (!PARTNER_ROLES.includes(req.user.role)) return forbidden(res, 'Partner only');
  if (!req.user.partnerId) return forbidden(res, 'Partner organization not linked');
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
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requirePartner,
  requireFieldAgent,
  ADMIN_ROLES,
  PARTNER_ROLES,
};
