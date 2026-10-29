'use strict';

require('dotenv').config();

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  // Without this the email service logs "[EMAIL DRY RUN]", returns
  // { skipped: true } and discards the message. Every signup OTP and every
  // password reset is silently dropped while the logs look clean — which is
  // precisely the failure mode that made the OTP problem so hard to find. A
  // platform that cannot send a verification code cannot onboard an agent or
  // recover an account, so a deployment missing this is not serviceable and
  // should not start.
  'RESEND_API_KEY',
];

/** The value this file used to fall back to, which is committed to the repo. */
const PLACEHOLDER_JWT_SECRET = 'dev-only-secret-change-me';
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Whether this process is running on a real deployment.
 *
 * This deliberately does NOT rely on NODE_ENV alone. The production deployment
 * was observed serving `"env": "development"` from /api/health, which meant the
 * guard below never ran: JWT_SECRET fell back to the placeholder above, and
 * because that value is in the repository, anyone who could read it could mint
 * a token for any role. Vercel always sets VERCEL/VERCEL_ENV regardless of
 * NODE_ENV, so a deployment is recognised even when NODE_ENV is unset.
 */
const isDeployed = Boolean(
  process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.K_SERVICE ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME
);

const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

/** Treat anything deployed as needing real secrets, whatever NODE_ENV says. */
const mustHaveRealSecrets = isProd || isDeployed;

if (mustHaveRealSecrets) {
  const problems = [];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) problems.push(`missing env vars: ${missing.join(', ')}`);

  const secret = process.env.JWT_SECRET;
  if (secret === PLACEHOLDER_JWT_SECRET) {
    problems.push(
      'JWT_SECRET is the development placeholder that is committed to the ' +
        'repository — tokens signed with it can be forged by anyone who can ' +
        'read the source. Set a new random secret.'
    );
  } else if (secret && secret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(
      `JWT_SECRET is only ${secret.length} characters; use at least ` +
        `${MIN_JWT_SECRET_LENGTH} (e.g. \`openssl rand -base64 48\`).`
    );
  }

  if (problems.length > 0) {
    const message = [
      'Refusing to start: this deployment is not safely configured.',
      ...problems.map((p) => `  - ${p}`),
      '',
      `  NODE_ENV=${process.env.NODE_ENV || '(unset)'}  VERCEL_ENV=${process.env.VERCEL_ENV || '(unset)'}`,
      '',
      '  Set the missing values as environment variables and redeploy.',
      '  If JWT_SECRET is among them, note that setting or rotating it',
      '  invalidates existing sessions, so users will sign in again.',
    ].join('\n');

    console.error(message);
    // Thrown rather than process.exit(1) so the reason appears in the platform
    // logs under both the long-running server and the serverless handler.
    throw new Error('Unsafe deployment configuration — see the details logged above.');
  }
}

if (!process.env.JWT_SECRET && !mustHaveRealSecrets) {
  console.warn(
    '[config] JWT_SECRET is unset; using the local development placeholder. ' +
      'This is refused on any deployed environment.'
  );
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  isDeployed,
  port: parseInt(process.env.PORT || '4000', 10),

  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:5173',
  publicApiUrl: process.env.PUBLIC_API_URL || 'http://localhost:4000',

  jwt: {
    // Reached only on a local developer machine; a deployment without a real
    // secret has already been refused above.
    secret: process.env.JWT_SECRET || PLACEHOLDER_JWT_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL || 'Heabron CoopScore <noreply@heabroncoopscore.com>',
    replyTo: process.env.RESEND_REPLY_TO || 'info@heabroncoopscore.com',
  },

  nin: {
    // Dojah is now the active provider (the team has a verified app).
    // The NINAuth config is kept in case we need to switch back later.
    provider: process.env.NIN_PROVIDER || 'dojah',
    devMode: process.env.NIN_DEV_MODE === 'true',
    dojah: {
      // Use https://sandbox.dojah.io for the sandbox; api.dojah.io for prod.
      baseUrl: process.env.DOJAH_BASE_URL || 'https://api.dojah.io',
      appId: process.env.DOJAH_APP_ID,
      secretKey: process.env.DOJAH_SECRET_KEY,
    },
    ninauth: {
      baseUrl: process.env.NINAUTH_BASE_URL || 'https://api.ninauth.nimc.gov.ng',
      clientId: process.env.NINAUTH_CLIENT_ID,
      clientSecret: process.env.NINAUTH_CLIENT_SECRET,
    },
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
  },

  brand: {
    name: process.env.BRAND_NAME || 'Heabron CoopScore',
    logoUrl: process.env.BRAND_LOGO_URL || 'https://i.imgur.com/RIpNqJw.png',
    primary: process.env.BRAND_PRIMARY_COLOR || '#2C6B47',
    accent: process.env.BRAND_ACCENT_COLOR || '#E0A82E',
    supportEmail: process.env.BRAND_SUPPORT_EMAIL || 'info@heabroncoopscore.com',
    website: process.env.BRAND_WEBSITE || 'https://www.heabroncoopscore.com',
  },
};
