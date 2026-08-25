'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

const standardLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, slow down.' } },
});

// Tighter limits on auth endpoints to slow credential stuffing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many auth attempts. Try again later.' } },
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'OTP request limit reached. Try again in an hour.' } },
});

module.exports = { standardLimiter, authLimiter, otpLimiter };
