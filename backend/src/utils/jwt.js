'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Sign an access token. Payload should include at minimum:
 *   { sub: userId, role, partnerId?, status }
 */
function signAccessToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: 'heabron-coopscore',
    audience: 'heabron-coopscore-api',
  });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, type: 'refresh' }, config.jwt.secret, {
    expiresIn: config.jwt.refreshExpiresIn,
    issuer: 'heabron-coopscore',
    audience: 'heabron-coopscore-api',
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    issuer: 'heabron-coopscore',
    audience: 'heabron-coopscore-api',
  });
}

module.exports = { signAccessToken, signRefreshToken, verifyToken };
