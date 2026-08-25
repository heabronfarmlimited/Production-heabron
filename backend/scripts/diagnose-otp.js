'use strict';

/**
 * Heabron CoopScore — OTP Insert Diagnostic
 * -----------------------------------------
 * Run with:  node scripts/diagnose-otp.js
 *
 * This script bypasses Express, the logger, and the whole HTTP stack so you
 * see the EXACT raw Supabase error when writing to otp_codes. If anything is
 * misconfigured (wrong key, RLS blocking, missing column, project mismatch)
 * it will print the literal error here in plain English.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

function divider(label) {
  console.log('\n' + '─'.repeat(60));
  console.log(label);
  console.log('─'.repeat(60));
}

function decodeJwt(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return null; }
}

(async () => {
  divider('1. ENV VARS');
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL || '(missing)');
  console.log('SERVICE_ROLE_KEY present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log('ANON_KEY present:', !!process.env.SUPABASE_ANON_KEY);

  const payload = decodeJwt(process.env.SUPABASE_SERVICE_ROLE_KEY);
  divider('2. SERVICE ROLE KEY JWT PAYLOAD');
  console.log(payload || '(could not decode — not a JWT)');
  if (payload) {
    console.log('Role claim:', payload.role);
    console.log('Project ref:', payload.ref);
    if (payload.exp) console.log('Expires:', new Date(payload.exp * 1000).toISOString());
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('\nMissing env vars — aborting.');
    process.exit(1);
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  divider('3. READ TEST — list any 1 row from otp_codes');
  const readRes = await sb.from('otp_codes').select('id, email, purpose, created_at').limit(1);
  console.log('data:', readRes.data);
  console.log('error:', readRes.error);
  console.log('status:', readRes.status, readRes.statusText);

  divider('4. INSERT TEST — write a probe OTP row');
  const probe = {
    email: 'diag.probe@example.com',
    code: '000000',
    purpose: 'signup',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  console.log('Inserting:', probe);
  const insRes = await sb.from('otp_codes').insert(probe).select('id').single();
  console.log('data:', insRes.data);
  console.log('error:', insRes.error);
  console.log('status:', insRes.status, insRes.statusText);

  divider('5. UPDATE TEST — try the "invalidate previous" update');
  const updRes = await sb
    .from('otp_codes')
    .update({ consumed: true })
    .eq('email', 'diag.probe@example.com')
    .eq('purpose', 'signup')
    .eq('consumed', false);
  console.log('data:', updRes.data);
  console.log('error:', updRes.error);
  console.log('status:', updRes.status, updRes.statusText);

  divider('6. CLEANUP — delete probe rows');
  const delRes = await sb.from('otp_codes').delete().eq('email', 'diag.probe@example.com');
  console.log('error:', delRes.error);
  console.log('status:', delRes.status, delRes.statusText);

  divider('DONE');
  if (insRes.error) {
    console.error('\n❌ Insert failed. The error message above is the root cause.');
    console.error('Common interpretations:');
    console.error('  • "new row violates row-level security policy" → service role is not bypassing RLS. Check SUPABASE_SERVICE_ROLE_KEY value.');
    console.error('  • "permission denied for table otp_codes" → the role does not have INSERT GRANT.');
    console.error('  • "relation \\"otp_codes\\" does not exist" → wrong project, or migration not applied.');
    console.error('  • "Invalid API key" → key was rotated or copied with whitespace.');
    process.exit(1);
  } else {
    console.log('\n✅ Insert succeeded. The bug is not in Supabase access — it is in the controller path.');
  }
})();