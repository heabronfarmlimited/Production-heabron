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

async function getNinAuthToken() {
  const { ninauth } = config.nin;
  if (!ninauth.clientId || !ninauth.clientSecret) {
    throw new Error('NINAuth client credentials not configured');
  }

  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt > now + 30_000) {
    return cachedToken;
  }

  const url = `${ninauth.baseUrl}/oauth/token`;
  const res = await axios.post(
    url,
    {
      grant_type: 'client_credentials',
      client_id: ninauth.clientId,
      client_secret: ninauth.clientSecret,
    },
    { timeout: 15_000 }
  );

  cachedToken = res.data.access_token;
  cachedTokenExpiresAt = now + (res.data.expires_in || 3600) * 1000;
  return cachedToken;
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
  const fnMatch = a && b && (a.includes(b) || b.includes(a));
  const lnMatch = c && d && (c.includes(d) || d.includes(c));
  return (fnMatch && lnMatch) ? 'verified' : 'mismatch';
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

  if (config.nin.devMode || !providerHasCreds) {
    logger.warn(
      { devMode: config.nin.devMode, provider, providerHasCreds },
      'verifyNin running in DEV mode — stub response'
    );
    return devModeVerify({ nin, firstName, lastName });
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
