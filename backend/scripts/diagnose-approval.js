'use strict';

/**
 * Heabron CoopScore — field-agent approval diagnostic
 * ----------------------------------------------------
 * Run with:  node scripts/diagnose-approval.js agent@example.com
 *
 * Reported symptom: an admin approves a field agent, the agent receives the
 * "approved" email, but the admin list still shows them pending and the agent
 * still sees "Awaiting admin approval" when they sign in.
 *
 * The approval writes to TWO places:
 *
 *   agent_applications.status  -> 'active'     (what the admin Applications tab reads)
 *   profiles.status            -> 'active'     (what login and every API request read)
 *
 * The email is sent after both. So if the email arrived but the agent is still
 * blocked, one of those writes did not land. The most common cause is an
 * UPDATE that matched no rows, which PostgREST reports WITHOUT an error:
 *
 *   - no profiles row for that user_id (the on_auth_user_created trigger did
 *     not run), or
 *   - row-level security hid the row from this connection, which is what
 *     happens when SUPABASE_SERVICE_ROLE_KEY actually holds a publishable or
 *     anon key: reads still work, writes silently affect zero rows.
 *
 * This script prints the real state of all four records and, with --fix-write
 * test, proves whether this connection can actually write to profiles.
 *
 * Read-only unless you pass --repair.
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const EMAIL = process.argv[2];
const REPAIR = process.argv.includes('--repair');

const line = (c = '─') => console.log(c.repeat(72));
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);

if (!EMAIL) {
  console.error('Usage: node scripts/diagnose-approval.js agent@example.com [--repair]');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

/**
 * A service_role JWT carries `"role":"service_role"` in its payload. The newer
 * `sb_secret_…` / `sb_publishable_…` formats are opaque, so those are reported
 * by prefix instead.
 */
function describeKey(k) {
  if (k.startsWith('sb_secret_')) return { kind: 'secret', detail: 'sb_secret_… (service role)' };
  if (k.startsWith('sb_publishable_')) {
    return { kind: 'anon', detail: 'sb_publishable_… (PUBLIC key — RLS applies)' };
  }
  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      if (payload.role === 'service_role') return { kind: 'secret', detail: 'JWT role=service_role' };
      return { kind: 'anon', detail: `JWT role=${payload.role} — RLS APPLIES` };
    } catch {
      return { kind: 'unknown', detail: 'unparseable JWT' };
    }
  }
  return { kind: 'unknown', detail: 'unrecognised key format' };
}

(async () => {
  let problems = 0;

  // ───────────────────────────────────────────────────────── 1. the key
  line();
  console.log('1. SUPABASE KEY');
  line();
  const k = describeKey(key);
  console.log(`  key: ${key.slice(0, 12)}…  (${k.detail})`);
  if (k.kind === 'anon') {
    bad(
      'This is a PUBLIC key. Row-level security applies to it, so UPDATEs can ' +
        'silently affect zero rows while reads still appear to work. This alone ' +
        'explains the symptom. Replace it with the service_role key.'
    );
    problems += 1;
  } else if (k.kind === 'secret') {
    ok('service-role key — RLS is bypassed, writes should land');
  } else {
    warn('Could not classify this key; continuing.');
  }

  // ─────────────────────────────────────────────────── 2. the auth user
  line();
  console.log('2. AUTH USER');
  line();

  let authUser = null;
  for (let page = 1; page <= 25 && !authUser; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      bad(`listUsers failed: ${error.message}`);
      problems += 1;
      break;
    }
    authUser = (data?.users || []).find((u) => (u.email || '').toLowerCase() === EMAIL.toLowerCase());
    if (!data?.users?.length || data.users.length < 200) break;
  }

  if (!authUser) {
    bad(`No auth user with email ${EMAIL}`);
    console.log('\nStopping — nothing further can be checked.');
    process.exit(1);
  }
  ok(`id ${authUser.id}`);
  console.log(`    email_confirmed_at : ${authUser.email_confirmed_at || '(null — cannot sign in)'}`);
  if (!authUser.email_confirmed_at) {
    bad('Email is not confirmed, so signInWithPassword will reject this account.');
    problems += 1;
  }

  // ───────────────────────────────────────────────────── 3. the records
  line();
  console.log('3. RECORDS');
  line();

  const [{ data: profile }, { data: roles }, { data: app }] = await Promise.all([
    sb.from('profiles').select('user_id, full_name, status, created_at').eq('user_id', authUser.id).maybeSingle(),
    sb.from('user_roles').select('role').eq('user_id', authUser.id),
    sb.from('agent_applications').select('id, status, reviewed_at, reviewed_by').eq('user_id', authUser.id).maybeSingle(),
  ]);

  if (!profile) {
    bad(
      'NO profiles row for this user. The on_auth_user_created trigger did not ' +
        'run (or was removed), so the approval UPDATE matches zero rows and ' +
        'silently does nothing. Re-run migrations/000_heabron_system_schema.sql.'
    );
    problems += 1;
  } else {
    console.log(`  profiles.status            : ${profile.status}`);
  }
  console.log(`  user_roles                 : ${(roles || []).map((r) => r.role).join(', ') || '(none)'}`);
  if (!app) {
    warn('No agent_applications row — this user never submitted an application.');
  } else {
    console.log(`  agent_applications.status  : ${app.status}`);
    console.log(`  reviewed_at                : ${app.reviewed_at || '(never)'}`);
  }

  // ─────────────────────────────────────────────── 4. the verdict
  line();
  console.log('4. VERDICT');
  line();

  const appDecided = app && app.status === 'active';
  const profileActive = profile && profile.status === 'active';

  if (appDecided && !profileActive) {
    bad(
      'THIS IS THE REPORTED BUG: the application is marked approved but the ' +
        `profile is still "${profile ? profile.status : 'missing'}".`
    );
    console.log('    The agent will keep seeing "Awaiting admin approval" on every');
    console.log('    sign-in, and the admin Agents list will keep showing them pending,');
    console.log('    because both read profiles.status.');
    console.log('    Re-run with --repair to set profiles.status = active for this user.');
    problems += 1;
  } else if (!appDecided && profileActive) {
    warn('Profile is active but the application is not marked approved — also inconsistent.');
    problems += 1;
  } else if (appDecided && profileActive) {
    ok('Consistent: application approved and profile active. This agent can sign in.');
  } else {
    ok(`Consistent: application "${app ? app.status : 'none'}", profile "${profile ? profile.status : 'none'}".`);
  }

  // ──────────────────────────────────────── 5. can this connection write?
  line();
  console.log('5. WRITE TEST (does an UPDATE actually affect a row?)');
  line();

  if (profile) {
    // Rewrite the status to its CURRENT value: a no-op in content, but it
    // proves whether the connection can match and return the row at all.
    const { data: rows, error: wErr } = await sb
      .from('profiles')
      .update({ status: profile.status })
      .eq('user_id', authUser.id)
      .select('user_id');

    if (wErr) {
      bad(`UPDATE returned an error: ${wErr.message}`);
      problems += 1;
    } else if (!rows || rows.length === 0) {
      bad(
        'UPDATE matched ZERO rows and returned no error. This is the silent ' +
          'failure: the row is invisible to this connection, which means RLS is ' +
          'applying — the key is not really service_role.'
      );
      problems += 1;
    } else {
      ok('UPDATE matched 1 row — this connection can write to profiles.');
    }
  }

  // ───────────────────────────────────────────────────────── 6. repair
  if (REPAIR && app && app.status === 'active' && profile && profile.status !== 'active') {
    line();
    console.log('6. REPAIR');
    line();
    const { data: fixed, error: fixErr } = await sb
      .from('profiles')
      .update({ status: 'active' })
      .eq('user_id', authUser.id)
      .select('user_id, status');
    if (fixErr) bad(`Repair failed: ${fixErr.message}`);
    else if (!fixed || fixed.length === 0) bad('Repair matched no rows (see the write test above).');
    else ok(`profiles.status is now "${fixed[0].status}" — the agent can sign in.`);
  }

  line();
  console.log(problems === 0 ? 'No problems found.' : `${problems} problem(s) found above.`);
  line();
  process.exit(problems === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nDiagnostic crashed:', err);
  process.exit(1);
});
