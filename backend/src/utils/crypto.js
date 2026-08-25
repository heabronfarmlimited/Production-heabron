'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ROUNDS = 10;

async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Generate a memorable but secure auto-password for partner accounts.
 * Format: AdjNoun-1234-XX  (e.g. BrightHarvest-4729-QK)
 * Length: ~17 chars, includes letters + digits + symbol → meets typical strength bars.
 */
const ADJECTIVES = ['Bright','Golden','Green','Harvest','Mighty','Noble','Royal','Solar','Strong','Swift','Vast','Wise'];
const NOUNS = ['Field','Grain','Harvest','Maize','Millet','Palm','Rice','River','Sun','Valley','Wheat','Yield'];

function generateAutoPassword() {
  const adj = ADJECTIVES[crypto.randomInt(ADJECTIVES.length)];
  const noun = NOUNS[crypto.randomInt(NOUNS.length)];
  const digits = String(crypto.randomInt(1000, 10000));
  const suffix = crypto.randomBytes(1).toString('hex').toUpperCase();
  return `${adj}${noun}-${digits}-${suffix}`;
}

/**
 * Generate a 6-digit numeric OTP for email verification / password reset.
 */
function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Generate a URL-safe random token (e.g. for password reset links).
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateAutoPassword,
  generateOtp,
  generateToken,
};
