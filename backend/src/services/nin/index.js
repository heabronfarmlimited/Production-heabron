'use strict';

const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * NIN verification service.
 *
 * Active provider: Dojah (https://dojah.io). The Heabron team has a verified
 * Dojah application — set DOJAH_APP_ID and DOJAH_SECRET_KEY in env to
 * activate. Dojah's NIN lookup hits NIMC and returns the resident's
 * registered details which we can match against the field-agent-submitted
 * first/last name.
 *
 * Fallback provider: NINAuth (NIMC's official OAuth2 service). Kept wired
 * so the system can be switched back via NIN_PROVIDER=ninauth without
 * code changes.
 *
 * Integration notes:
 *   - Dojah uses two-header auth: `AppId: <app_id>` and
 *     `Authorization: <secret_key>` (no Bearer prefix).
 *   - Endpoint: GET {baseUrl}/api/v1/kyc/nin?nin={nin}
 *   - Sandbox base URL: https://sandbox.dojah.io
 *     Production base URL: https://api.dojah.io
 *     Test NIN in sandbox: 70123456789
 *   - In dev mode (NIN_DEV_MODE=true OR no credentials configured) the
 *     service returns a deterministic stub so the rest of the app can be
 *     exercised end-to-end without spending live verifications.
 *
 * Returned shape (always):
 *   {
 *     status: 'verified' | 'mismatch' | 'failed',
 *     reference: string|null,
 *     details: { firstName, lastName, middleName, gender, dateOfBirth,
 *                phone, photo, address } | null,
 *     raw: <provider response>
 *   }
 */

let cachedToken = null;
let cachedTokenExpiresAt = 0;
// Holds the request that is currently fetching a token, so that concurrent
// callers share one round-trip instead of each starting their own (single
// flight). Note this cache is per-process, so on a serverless host each warm
// instance keeps its own.
let inFlightTokenRequest = null;

async function getNinAuthToken() {
  const { ninauth } = config.nin;
  if (!ninauth.clientId || !ninauth.clientSecret) {
    throw new Error('NINAuth client credentials not configured');
  }

  // Re-use a live token, keeping 30s of headroom.
  if (cachedToken && cachedTokenExpiresAt > Date.now() + 30_000) {
    return cachedToken;
  }
  if (inFlightTokenRequest) return inFlightTokenRequest;

  const url = `${ninauth.baseUrl}/oauth/token`;

  inFlightTokenRequest = (async () => {
    const res = await axios.post(
      url,
      {
        grant_type: 'client_credentials',
        client_id: ninauth.clientId,
        client_secret: ninauth.clientSecret,
      },
      { timeout: 15_000 }
    );

    const token = res.data?.access_token;
    if (!token) throw new Error('NINAuth token response contained no access_token');

    // Measured from when the response arrived, not from before the request was
    // sent — the previous version added expires_in to a pre-request timestamp,
    // so a slow handshake shortened the cached lifetime by its own duration.
    cachedToken = token;
    cachedTokenExpiresAt = Date.now() + (res.data.expires_in || 3600) * 1000;
    return token;
  })();

  try {
    return await inFlightTokenRequest;
  } finally {
    // Cleared on success and on failure, so a failed fetch does not pin every
    // later caller to the same rejected promise. Resetting the same variable
    // the await was taken from is the point of the single-flight latch, not a
    // lost update.
    // eslint-disable-next-line require-atomic-updates
    inFlightTokenRequest = null;
  }
}

async function verifyWithNinAuth({ nin, firstName, lastName, dateOfBirth }) {
  const { ninauth } = config.nin;
  const token = await getNinAuthToken();

  const url = `${ninauth.baseUrl}/v1/verification/nin/match`;
  const body = {
    nin,
    firstname: firstName || undefined,
    surname: lastName || undefined,
    dateOfBirth: dateOfBirth || undefined,
  };

  const res = await axios.post(url, body, {
    timeout: 20_000,
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = res.data || {};
  const found = data.status === true || data.status === 'success' || data.statusCode === 200;
  if (!found) {
    return {
      status: 'failed',
      reference: data.reference || null,
      details: null,
      raw: data,
    };
  }

  const d = data.data || data;
  const details = {
    firstName: d.firstname || d.first_name,
    lastName: d.surname || d.last_name,
    middleName: d.middlename || d.middle_name,
    gender: d.gender,
    dateOfBirth: d.birthdate || d.date_of_birth,
    phone: d.telephoneno || d.phone || d.phone_number,
    photo: d.photo || d.image,
    address: d.residence_address || d.address || null,
  };

  // If caller provided names, decide match vs mismatch via shared helper
  const status = decideNameMatch({
    providedFirst: firstName,
    providedLast: lastName,
    returnedFirst: details.firstName,
    returnedLast: details.lastName,
  });

  return {
    status,
    reference: data.reference || data.reportID || null,
    details,
    raw: data,
  };
}

function decideNameMatch({ providedFirst, providedLast, returnedFirst, returnedLast }) {
  if (!providedFirst || !providedLast) return 'verified';

  const norm = (s) => (s || '').trim().toLowerCase();
  const a = norm(providedFirst), b = norm(returnedFirst);
  const c = norm(providedLast), d = norm(returnedLast);

  // FIXED — callers derive the name parts with
  // `parts[0]` / `parts.slice(-1)[0]`, so a farmer recorded with a single
  // name ("Adaeze") yields firstName === lastName === "Adaeze". That was then
  // compared against the provider's distinct first and last names, which
  // always produced a 'mismatch' and left a legitimately-registered farmer
  // flagged. For a single-name record, match it against either part.
  if (a === c) {
    const single = a;
    const matchesEither =
      (b && (single.includes(b) || b.includes(single))) ||
      (d && (single.includes(d) || d.includes(single)));
    return matchesEither ? 'verified' : 'mismatch';
  }

  const fnMatch = a && b && (a.includes(b) || b.includes(a));
  const lnMatch = c && d && (c.includes(d) || d.includes(c));

  // Nigerian records frequently have first and last names transposed between
  // the NIMC record and what an agent types, so accept the swap too.
  const swappedFirst = a && d && (a.includes(d) || d.includes(a));
  const swappedLast = c && b && (c.includes(b) || b.includes(c));

  if (fnMatch && lnMatch) return 'verified';
  if (swappedFirst && swappedLast) return 'verified';
  return 'mismatch';
}

/**
 * Dojah NIN lookup.
 *
 * Endpoint:  GET {baseUrl}/api/v1/kyc/nin?nin={nin}
 * Headers:   AppId: <app_id>
 *            Authorization: <secret_key>     (no Bearer prefix)
 *
 * Success response shape:
 *   { entity: { first_name, last_name, middle_name, gender,
 *               date_of_birth, phone_number, photo,
 *               residence_address_line_1, residence_state, ... } }
 *
 * On the sandbox base URL, the test NIN `70123456789` returns a working
 * record so the wiring can be exercised end-to-end without spending live
 * verifications.
 */
async function verifyWithDojah({ nin, firstName, lastName }) {
  const { dojah } = config.nin;
  if (!dojah.appId || !dojah.secretKey) {
    throw new Error('Dojah credentials (DOJAH_APP_ID, DOJAH_SECRET_KEY) not configured');
  }

  const url = `${dojah.baseUrl}/api/v1/kyc/nin`;
  const res = await axios.get(url, {
    params: { nin },
    headers: {
      AppId: dojah.appId,
      Authorization: dojah.secretKey,
    },
    timeout: 20_000,
  });

  const body = res.data || {};
  const entity = body.entity || null;
  if (!entity) {
    return {
      status: 'failed',
      reference: body.reference || body.entity_reference || null,
      details: null,
      raw: body,
    };
  }

  // Compose Heabron's address field from whichever residence parts Dojah returned.
  const addressParts = [
    entity.residence_address_line_1,
    entity.residence_address_line_2,
    entity.residence_lga,
    entity.residence_state,
  ].filter(Boolean);

  const details = {
    firstName: entity.first_name,
    lastName: entity.last_name,
    middleName: entity.middle_name,
    gender: entity.gender,
    dateOfBirth: entity.date_of_birth,
    phone: entity.phone_number,
    photo: entity.photo,
    address: addressParts.length ? addressParts.join(', ') : null,
  };

  const status = decideNameMatch({
    providedFirst: firstName,
    providedLast: lastName,
    returnedFirst: details.firstName,
    returnedLast: details.lastName,
  });

  return {
    status,
    reference: body.reference || body.entity_reference || null,
    details,
    raw: body,
  };
}

function devModeVerify({ nin, firstName, lastName }) {
  return {
    status: 'verified',
    reference: 'DEV-' + nin,
    details: {
      firstName: firstName || 'Test',
      lastName: lastName || 'User',
      middleName: 'Dev',
      gender: 'male',
      dateOfBirth: '1990-01-01',
      phone: '08000000000',
      photo: null,
      address: 'Lagos, Nigeria',
    },
    raw: { devMode: true, message: 'NIN_DEV_MODE=true — no provider call made' },
  };
}

/**
 * Public entry point used by controllers.
 */
async function verifyNin({ nin, firstName, lastName, dateOfBirth }) {
  if (!/^\d{11}$/.test(nin || '')) {
    return {
      status: 'failed',
      reference: null,
      details: null,
      raw: { error: 'NIN must be exactly 11 digits' },
    };
  }

  const { ninauth, dojah, provider } = config.nin;
  const providerHasCreds =
    (provider === 'dojah' && dojah?.appId && dojah?.secretKey) ||
    (provider === 'ninauth' && ninauth?.clientId && ninauth?.clientSecret);

  // Explicit dev mode — a deliberate opt-in, fine anywhere.
  if (config.nin.devMode) {
    logger.warn({ provider }, 'verifyNin running in DEV mode (NIN_DEV_MODE=true) — stub response');
    return devModeVerify({ nin, firstName, lastName });
  }

  // FIXED — the old condition was `if (config.nin.devMode || !providerHasCreds)`,
  // so a production deployment with DOJAH_APP_ID or DOJAH_SECRET_KEY missing
  // fell through to `devModeVerify()` and returned `status: 'verified'` with
  // fabricated details ("Test User", 1990-01-01, Lagos) for EVERY NIN. The
  // only trace was a log warning. Nothing failed, nothing was flagged, and the
  // admin dashboard showed every farmer as verified — so a missing env var
  // silently turned identity verification into a no-op.
  //
  // Missing credentials outside explicit dev mode is now a hard failure:
  // `status: 'failed'` is recorded, the farmer is left unverified, and an
  // admin can see there is a configuration problem.
  if (!providerHasCreds) {
    const missing =
      provider === 'dojah'
        ? ['DOJAH_APP_ID', 'DOJAH_SECRET_KEY'].filter(
            (k) => !process.env[k]
          )
        : ['NINAUTH_CLIENT_ID', 'NINAUTH_CLIENT_SECRET'].filter(
            (k) => !process.env[k]
          );

    logger.error(
      { provider, missing },
      'NIN provider credentials missing — verification cannot run. ' +
        'Set the missing env vars, or set NIN_DEV_MODE=true to use the stub deliberately.'
    );

    return {
      status: 'failed',
      reference: null,
      details: null,
      raw: {
        error: `NIN provider "${provider}" is not configured`,
        missingEnv: missing,
        hint: 'Set NIN_DEV_MODE=true to use the development stub intentionally.',
      },
    };
  }

  try {
    if (provider === 'dojah') {
      return await verifyWithDojah({ nin, firstName, lastName });
    }
    if (provider === 'ninauth') {
      return await verifyWithNinAuth({ nin, firstName, lastName, dateOfBirth });
    }
    throw new Error(`Unknown NIN provider: ${provider}`);
  } catch (err) {
    logger.error({ err: err.message, status: err.response?.status }, 'NIN verification error');
    return {
      status: 'failed',
      reference: null,
      details: null,
      raw: {
        error: err.message,
        providerStatus: err.response?.status,
        providerData: err.response?.data,
      },
    };
  }
}

module.exports = { verifyNin };
