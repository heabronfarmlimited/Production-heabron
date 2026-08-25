'use strict';

require('dotenv').config();

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
];

const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port: parseInt(process.env.PORT || '4000', 10),

  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:5173',
  publicApiUrl: process.env.PUBLIC_API_URL || 'http://localhost:4000',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
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
