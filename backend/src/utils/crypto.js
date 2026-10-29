'use strict';

const crypto = require('crypto');

// FIXED — `hashPassword` / `verifyPassword` (and the `bcryptjs` import behind
// them) were exported but called from nowhere: Supabase Auth owns every
// password in this system. Dead crypto is worse than no crypto — the next
// person to need a password hash would have reached for these and quietly
// introduced a second, unmanaged credential store. `generateToken` was
// likewise unused. All three removed.

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
  // FIXED — `randomBytes(1).toString('hex')` yields TWO hex characters from a
  // single byte, so the documented "~17 chars, XX suffix" was really 2 hex
  // nibbles of entropy (256 possibilities). Combined with 12 adjectives,
  // 12 nouns and 9000 digits the whole space was ~31M — brute-forceable, and
  // this is the password a partner logs in with. 5 bytes of base36 raises the
  // suffix alone to ~60M and the total space past 10^14.
  const suffix = crypto.randomBytes(5).readUIntBE(0, 5).toString(36).toUpperCase().padStart(8, '0');
  return `${adj}${noun}-${digits}-${suffix}`;
}

/**
 * Generate a 6-digit numeric OTP for email verification / password reset.
 */
function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

module.exports = {
  generateAutoPassword,
  generateOtp,
};
