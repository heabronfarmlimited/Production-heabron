'use strict';

/**
 * Heabron CoopScore — OTP **email delivery** diagnostic
 * -----------------------------------------------------
 * Run with:  node scripts/diagnose-email.js you@example.com
 *
 * Companion to `diagnose-otp.js`, which checks the `otp_codes` *row insert*
 * (Supabase keys / RLS). That part already reports its errors properly. This
 * script checks the half that was failing silently: the Resend send.
 *
 * It answers, in order:
 *   1. Is RESEND_API_KEY present, and does the key authenticate?
 *   2. Is the domain in RESEND_FROM_EMAIL verified on this account?
 *   3. Does a real send succeed — and if not, what does Resend actually say?
 *   4. Is NODE_ENV production, and are the required secrets present?
 *   5. Is the NIN provider configured, or is it silently stubbing?
 *
 * Nothing here writes to your database. The only side effect is one test
 * email, and only if you pass an address.
 */

require('dotenv').config();

function divider(label) {
  console.log('\n' + '─'.repeat(66));
  console.log(label);
  console.log('─'.repeat(66));
}

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);

(async () => {
  const recipient = process.argv[2];
  let problems = 0;

  // ───────────────────────────────────────────────────────────── 1. runtime
  divider('1. RUNTIME CONFIG');

  const nodeEnv = process.env.NODE_ENV || '(unset)';
  console.log('  NODE_ENV:', nodeEnv);
  if (nodeEnv !== 'production') {
    bad(
      'NODE_ENV is not "production". The startup guard in config/index.js is ' +
        'skipped, so missing secrets will NOT stop the server — it boots and ' +
        'fails at request time instead.'
    );
    problems += 1;
  } else {
    ok('NODE_ENV=production — the required-env guard is active');
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    bad(
      'JWT_SECRET is unset. config/index.js falls back to ' +
        '"dev-only-secret-change-me", which is committed to the repo — anyone ' +
        'who can read it can forge tokens for any role. Set a real secret and ' +
        'rotate (existing sessions will be invalidated).'
    );
    problems += 1;
  } else if (jwtSecret === 'dev-only-secret-change-me') {
    bad('JWT_SECRET is literally the committed development placeholder. Rotate it.');
    problems += 1;
  } else {
    ok(`JWT_SECRET present (${jwtSecret.length} chars)`);
  }

  ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].forEach((k) => {
    if (process.env[k]) ok(`${k} present`);
    else {
      bad(`${k} missing`);
      problems += 1;
    }
  });

  // ────────────────────────────────────────────────────────────── 2. resend
  divider('2. RESEND CONFIG');

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    'Heabron CoopScore <noreply@heabroncoopscore.com>';

  console.log('  RESEND_FROM_EMAIL:', fromEmail);

  if (!apiKey) {
    bad(
      'RESEND_API_KEY is unset. The email service logs "[EMAIL DRY RUN]" and ' +
        'returns { skipped: true } — every OTP is silently discarded. This ' +
        'alone would produce "agents never receive the code".'
    );
    console.log('\nStopping: nothing further can be checked without the key.');
    process.exit(1);
  }
  ok(`RESEND_API_KEY present (${apiKey.slice(0, 8)}…)`);

  const { Resend } = require('resend');
  const resend = new Resend(apiKey);

  // Extract the bare address out of "Name <addr>" form.
  const match = /<([^>]+)>/.exec(fromEmail);
  const bareFrom = (match ? match[1] : fromEmail).trim();
  const fromDomain = bareFrom.split('@')[1];
  console.log('  sending domain    :', fromDomain || '(could not parse)');

  // ──────────────────────────────────────────────────────── 3. domain check
  divider('3. SENDING DOMAIN VERIFICATION');

  try {
    const { data, error } = await resend.domains.list();

    if (error) {
      warn(`Could not list domains: ${error.message}`);
      warn('If this is a 401/403, the API key is invalid or revoked.');
      problems += 1;
    } else {
      const domains = data?.data ?? data ?? [];
      if (!Array.isArray(domains) || domains.length === 0) {
        bad(
          'No domains registered on this Resend account. A `from` address on ' +
            'an unverified domain is rejected on every send.'
        );
        problems += 1;
      } else {
        console.log('  registered domains:');
        domains.forEach((d) => console.log(`    - ${d.name} (${d.status})`));

        const hit = domains.find((d) => d.name === fromDomain);
        if (!hit) {
          bad(
            `"${fromDomain}" is NOT registered on this account. Every send ` +
              'using this from-address is rejected.'
          );
          problems += 1;
        } else if (hit.status !== 'verified') {
          bad(`"${fromDomain}" is registered but status is "${hit.status}", not "verified".`);
          problems += 1;
        } else {
          ok(`"${fromDomain}" is verified`);
        }
      }
    }
  } catch (err) {
    warn(`Domain check threw: ${err.message}`);
  }

  // ────────────────────────────────────────────────────────── 4. real send
  divider('4. LIVE SEND TEST');

  if (!recipient) {
    warn('No recipient given — skipping. Re-run as:');
    console.log('      node scripts/diagnose-email.js you@example.com');
  } else {
    console.log(`  sending to ${recipient} …`);

    const started = Date.now();
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [recipient],
      subject: 'Heabron CoopScore — delivery diagnostic',
      html:
        '<p>This is a delivery test from <code>scripts/diagnose-email.js</code>.</p>' +
        '<p>If you received it, Resend is configured correctly and the OTP ' +
        'problem is in the application code path, not the provider.</p>',
    });
    const elapsed = Date.now() - started;

    if (error) {
      bad(`Resend REJECTED the send after ${elapsed}ms:`);
      console.log('    ', JSON.stringify(error, null, 2));
      console.log(
        '\n  NOTE — the Resend v4 SDK returns this in `result.error` rather than\n' +
          '  throwing. The old services/email/index.js only caught thrown errors,\n' +
          '  then logged "email sent" with id: undefined. That is why failures like\n' +
          '  this one never appeared in your logs.'
      );
      problems += 1;
    } else {
      ok(`accepted in ${elapsed}ms — Resend id: ${data?.id}`);
      console.log('    Confirm it in Resend → Emails, and check the inbox/spam.');
    }
  }

  // ───────────────────────────────────────────────────────────────── 5. NIN
  divider('5. NIN PROVIDER');

  const provider = process.env.NIN_PROVIDER || 'dojah';
  const devMode = process.env.NIN_DEV_MODE === 'true';
  console.log('  NIN_PROVIDER :', provider);
  console.log('  NIN_DEV_MODE :', devMode);

  const creds =
    provider === 'dojah'
      ? ['DOJAH_APP_ID', 'DOJAH_SECRET_KEY']
      : ['NINAUTH_CLIENT_ID', 'NINAUTH_CLIENT_SECRET'];
  const missing = creds.filter((k) => !process.env[k]);

  if (devMode) {
    warn('NIN_DEV_MODE=true — every NIN returns "verified" with stub data. ' +
      'Intentional, but must be false in production.');
  } else if (missing.length > 0) {
    bad(
      `${missing.join(' and ')} missing. On the UNPATCHED service this falls ` +
        'through to devModeVerify() and returns status:"verified" with ' +
        'fabricated details for EVERY NIN — so no identity has actually been ' +
        'checked. The patched service fails loudly instead.'
    );
    problems += 1;
  } else {
    ok(`${creds.join(' and ')} present — real verification will run`);
  }

  // ───────────────────────────────────────────────────────────── summary
  divider('SUMMARY');
  if (problems === 0) {
    console.log('  No configuration problems found.');
    console.log('  If OTPs are still missing, the cause is in the code path —');
    console.log('  apply the auth.controller.js / email service patch.');
  } else {
    console.log(`  ${problems} problem(s) found above. Fix those first.`);
  }
  console.log('');
  process.exit(problems === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nDiagnostic crashed:', err);
  process.exit(1);
});
