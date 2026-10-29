'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * NOTE ON SERVERLESS — `express-rate-limit`'s default MemoryStore is
 * per-instance. On Vercel each lambda has its own counter, so the effective
 * limit is (instances x max) and varies with traffic. The limits below are
 * therefore a coarse abuse brake, not a precise quota. For real enforcement,
 * add a shared store:
 *
 *   npm i @upstash/ratelimit @upstash/redis rate-limit-redis
 *
 * and pass `store:` to each limiter. Until then, keep the limits generous
 * enough that legitimate traffic is never blocked — a false block on signup
 * costs a field agent their onboarding.
 */

/**
 * Keys OTP-ish limiters by email address rather than IP.
 *
 * FIXED — the auth limiters keyed on IP (the library default). Nigerian mobile
 * carriers run large-scale CGNAT, so hundreds of agents share one public
 * address: `authLimiter` at 10/15min and `otpLimiter` at 6/hour were being
 * consumed collectively by everyone behind the same MTN/Airtel gateway. An
 * agent who had never requested a code could be refused because strangers on
 * the same carrier had. That is a direct cause of "sometimes they never get
 * the OTP".
 *
 * Keying by the submitted email makes the quota per-account, which is what
 * was actually intended. Falls back to IP when there is no email in the body.
 */
function emailKey(req) {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (email) return `email:${email}`;
  return `ip:${req.ip}`;
}

const standardLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, slow down.' },
  },
});

/**
 * Login / credential endpoints. Keyed by email so credential stuffing against
 * one account is throttled without punishing everyone on a shared carrier IP.
 * Raised from 10 to 20: an agent mistyping a password on a phone keyboard
 * burns attempts quickly, and the window is 15 minutes.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: emailKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failures count toward the limit
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many attempts for this account. Try again in a few minutes.',
    },
  },
  handler: (req, res, _next, options) => {
    logger.warn({ key: emailKey(req), path: req.path }, 'auth rate limit hit');
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * OTP requests. Still deliberately tight — each one sends an email — but
 * per-account and raised from 6 to 10, because a genuine agent fighting a
 * delayed inbox will legitimately tap "Resend" several times.
 */
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: emailKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many verification codes requested. Try again in an hour.',
    },
  },
  handler: (req, res, _next, options) => {
    logger.warn({ key: emailKey(req), path: req.path }, 'otp rate limit hit');
    res.status(options.statusCode).json(options.message);
  },
});

module.exports = { standardLimiter, authLimiter, otpLimiter, emailKey };
