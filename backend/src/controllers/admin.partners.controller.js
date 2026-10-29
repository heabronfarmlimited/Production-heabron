'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, paginated, conflict, badRequest, fail } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { generateAutoPassword } = require('../utils/crypto');
const { loanPrincipal } = require('../services/credit-score');
const email = require('../services/email');
const config = require('../config');
const logger = require('../utils/logger');
const { containsPattern } = require('../utils/search');
const { getProfileFor } = require('../utils/profiles');

/**
 * Admin creates a partner organisation. The flow:
 *   1. Insert the partner row (org name, email, logo, etc.)
 *   2. Auto-generate a strong password
 *   3. Create the Supabase auth user
 *   4. Update profile + replace default field_agent role with partner_admin
 *   5. Email the partner their credentials + login URL
 *   6. Mark must_change_password=true so the partner is forced to change
 *      it on first login.
 */
async function createPartner(req, res) {
  const sb = supabaseAdmin();
  const { organizationName, organizationEmail, contactPhone, address, state, logoUrl, contactName, website, taxId } = req.body;

  const { data: existing, error: dupeErr } = await sb
    .from('partners')
    .select('id')
    .eq('organization_email', organizationEmail)
    .maybeSingle();
  // Discarded before: a failed duplicate check read as "no duplicate", so the
  // flow proceeded to create a second partner for the same login email.
  if (dupeErr) throw dupeErr;
  if (existing) return conflict(res, 'Partner with this email already exists');

  // 1. Insert partner
  const { data: partner, error: pErr } = await sb.from('partners').insert({
    organization_name: organizationName,
    organization_email: organizationEmail,
    contact_phone: contactPhone,
    address,
    state,
    logo_url: logoUrl,
    website: website || null,
    tax_id: taxId || null,
    contact_name: contactName || null,
    created_by_admin_id: req.user.userId,
  }).select().single();
  if (pErr) {
    logger.error({ err: pErr.message, code: pErr.code, hint: pErr.hint, details: pErr.details }, 'partners insert failed');
    throw pErr;
  }

  // 2. Auto-password
  const autoPassword = generateAutoPassword();

  // 3. Auth user
  const { data: userData, error: uErr } = await sb.auth.admin.createUser({
    email: organizationEmail,
    password: autoPassword,
    email_confirm: true,
    user_metadata: { full_name: contactName || organizationName, role: 'partner_admin', partner_id: partner.id },
  });
  if (uErr) {
    // Rollback partner row if auth user creation failed
    await sb.from('partners').delete().eq('id', partner.id);
    return badRequest(res, `Could not create partner login: ${uErr.message}`);
  }
  const userId = userData.user.id;

  // 4. Override profile defaults + role.
  // FIXED — this was an UPDATE against a row created by a database trigger on
  // auth.users. An UPDATE that matches no rows is NOT an error in PostgREST,
  // so if the trigger had not run (or does not exist in this environment) the
  // partner ended up with an auth user and NO profile row. `requireAuth` reads
  // the profile, so that partner could never sign in — and nothing anywhere
  // reported a problem. An upsert makes the outcome the same either way.
  const profilePayload = {
    user_id: userId,
    full_name: contactName || organizationName,
    email: organizationEmail,
    phone: contactPhone,
    status: 'active',
    must_change_password: true,
  };
  const { error: profileErr } = await sb
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'user_id' });
  if (profileErr) {
    logger.error({ err: profileErr.message, code: profileErr.code, userId }, 'partner profile upsert failed');
    // Best-effort rollback of the auth user we just created. Logged rather
    // than silently swallowed: if it fails, an orphaned auth user is left
    // behind and someone has to know.
    await sb.auth.admin
      .deleteUser(userId)
      .catch((e) => logger.error({ err: e.message, userId }, 'partner rollback: auth user not deleted'));
    await sb.from('partners').delete().eq('id', partner.id);
    throw profileErr;
  }

  // FIXED — both role writes discarded their error. A failed insert after a
  // successful delete left the partner user with NO role at all, which
  // `requirePartner` rejects: another silent way to create a partner who
  // cannot log in.
  const { error: roleDelErr } = await sb.from('user_roles').delete().eq('user_id', userId);
  if (roleDelErr) throw roleDelErr;
  const { error: roleInsErr } = await sb
    .from('user_roles')
    .insert({ user_id: userId, role: 'partner_admin', partner_id: partner.id });
  if (roleInsErr) {
    logger.error({ err: roleInsErr.message, code: roleInsErr.code, userId }, 'partner role insert failed');
    // Best-effort rollback of the auth user we just created. Logged rather
    // than silently swallowed: if it fails, an orphaned auth user is left
    // behind and someone has to know.
    await sb.auth.admin
      .deleteUser(userId)
      .catch((e) => logger.error({ err: e.message, userId }, 'partner rollback: auth user not deleted'));
    await sb.from('partners').delete().eq('id', partner.id);
    throw roleInsErr;
  }

  // 5. Email credentials.
  // FIXED — this was fire-and-forget. The auto-generated password is never
  // stored anywhere, so this email is the ONLY copy of it; on Vercel the
  // lambda froze when the response was written and the send was killed
  // mid-flight. The admin saw "partner created" and the partner received
  // nothing, with no way for anyone to recover the password — the account had
  // to be reset before it could ever be used. Awaited, and a delivery failure
  // is now reported in the response so the admin knows to reset immediately.
  const delivery = await email.safe(email.sendPartnerCreated)(organizationEmail, {
    organizationName,
    contactName: contactName || organizationName,
    email: organizationEmail,
    autoPassword,
    loginUrl: `${config.publicAppUrl}/partner/login`,
  });
  if (delivery?.error) {
    logger.error(
      { err: delivery.error, to: organizationEmail, partnerId: partner.id },
      'partner credentials email FAILED — password was not delivered'
    );
  }

  await logActivity({ actor: req.user, action: 'partner_created', entityType: 'partner', entityId: partner.id, metadata: { organizationName }, req });
  return created(res, {
    partner,
    loginUserId: userId,
    // Additive field: present only when the credentials email did not go out,
    // so the dashboard can tell the admin to use "Reset password".
    ...(delivery?.error ? { credentialsEmailError: delivery.error } : {}),
  });
}

async function listPartners(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { search, status } = req.query;
  let q = sb.from('partners').select('*', { count: 'exact' });
  if (search) q = q.ilike('organization_name', containsPattern(search));
  if (status) q = q.eq('status', status);
  q = q.order('created_at', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function getPartner(req, res) {
  const sb = supabaseAdmin();
  const { data, error: readErr } = await sb
    .from('partners')
    .select('*')
    .eq('id', req.params.partnerId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!data) return notFound(res, 'Partner not found');

  const [userRes, financing] = await Promise.all([
    sb.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('partner_id', req.params.partnerId),
    sb
      .from('financing_requests')
      .select('id, partner_decision, loan_amount, approved_amount, disbursed_amount')
      .eq('forwarded_to_partner_id', req.params.partnerId)
      .limit(5000),
  ]);
  if (userRes.error) throw userRes.error;
  if (financing.error) throw financing.error;

  const totals = { pending: 0, approved: 0, rejected: 0, totalAmount: 0 };
  for (const r of financing.data || []) {
    if (r.partner_decision === 'approved') {
      totals.approved += 1;
      // FIXED — summed `loan_amount`, the amount REQUESTED, and labelled it
      // the partner's committed total. Shared `loanPrincipal` definition.
      totals.totalAmount += loanPrincipal(r);
    } else if (r.partner_decision === 'rejected') totals.rejected += 1;
    else totals.pending += 1;
  }
  totals.totalAmount = Math.round(totals.totalAmount * 100) / 100;

  return ok(res, { ...data, stats: { users: userRes.count || 0, financing: totals } });
}

/** camelCase body field -> partners column. */
const PARTNER_COLUMNS = {
  organizationName: 'organization_name',
  organizationEmail: 'organization_email',
  contactPhone: 'contact_phone',
  contactName: 'contact_name',
  address: 'address',
  state: 'state',
  logoUrl: 'logo_url',
  website: 'website',
  taxId: 'tax_id',
};

async function updatePartner(req, res) {
  const sb = supabaseAdmin();
  // FIXED — this mapped only 5 of the 9 fields `updatePartner` accepts, so an
  // admin editing a partner's contact name, website or tax ID got a 200 with
  // the change silently dropped. (The partner's own self-edit endpoint handled
  // all of them, so the admin form was strictly less capable than the
  // partner's.) `organizationEmail` is included here because it is admin-only
  // — the partner self-edit schema deliberately excludes it as the login id.
  const patch = {};
  for (const [key, column] of Object.entries(PARTNER_COLUMNS)) {
    if (req.body[key] !== undefined) patch[column] = req.body[key];
  }
  // FIXED — an empty patch reached PostgREST as `update({})`, which errors,
  // and `.single()` turned that into a generic 500.
  if (Object.keys(patch).length === 0) return badRequest(res, 'No fields to update');
  patch.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from('partners')
    .update(patch)
    .eq('id', req.params.partnerId)
    .select()
    .single();
  if (error) throw error;
  await logActivity({ actor: req.user, action: 'partner_updated', entityType: 'partner', entityId: data.id, req });
  return ok(res, data);
}

/**
 * FIXED — both of these updated by id with the error discarded and no
 * existence check, so suspending or reactivating a partner id that does not
 * exist answered `{ suspended: true }` / `{ reactivated: true }`. Suspension
 * is the control that stops a lender seeing borrower data, so a silently
 * failed suspend is a security-relevant false confirmation.
 *
 * Suspending a partner also suspends its user seats, which is what an
 * operator means by "suspend this partner" — previously the organisation was
 * flagged but every partner_admin kept full portal access.
 */
async function setPartnerStatus(req, res, status) {
  const sb = supabaseAdmin();
  const partnerId = req.params.partnerId;

  const { data: partner, error: readErr } = await sb
    .from('partners')
    .select('id, status, organization_name')
    .eq('id', partnerId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!partner) return notFound(res, 'Partner not found');
  if (partner.status === status) {
    return conflict(res, `This partner is already ${status}`, { partnerId, currentStatus: partner.status });
  }

  const { error: updErr } = await sb.from('partners').update({ status }).eq('id', partnerId);
  if (updErr) throw updErr;

  const { data: seats, error: seatErr } = await sb
    .from('user_roles')
    .select('user_id')
    .eq('partner_id', partnerId);
  if (seatErr) {
    logger.warn({ err: seatErr.message, partnerId }, 'partner seat lookup failed — org status changed but seats untouched');
  } else {
    const seatIds = (seats || []).map((s) => s.user_id).filter(Boolean);
    if (seatIds.length) {
      const { error: seatUpdErr } = await sb
        .from('profiles')
        .update({ status: status === 'suspended' ? 'suspended' : 'active' })
        .in('user_id', seatIds);
      if (seatUpdErr) {
        logger.warn({ err: seatUpdErr.message, partnerId }, 'partner seat status update failed');
      }
    }
  }

  await logActivity({
    actor: req.user,
    action: `partner_${status === 'suspended' ? 'suspended' : 'reactivated'}`,
    entityType: 'partner',
    entityId: partnerId,
    req,
  });
  return ok(res, status === 'suspended' ? { suspended: true } : { reactivated: true });
}

const suspendPartner = (req, res) => setPartnerStatus(req, res, 'suspended');
const reactivatePartner = (req, res) => setPartnerStatus(req, res, 'active');

/**
 * Reset a partner's auto-generated password. Uses a two-step profile lookup
 * (NOT a PostgREST embed) because user_roles.user_id references auth.users,
 * not profiles, and PostgREST can't infer that relationship.
 */
async function resetPartnerPassword(req, res) {
  const sb = supabaseAdmin();
  const { data: partner, error: partnerErr } = await sb
    .from('partners')
    .select('*')
    .eq('id', req.params.partnerId)
    .maybeSingle();
  if (partnerErr) throw partnerErr;
  if (!partner) return notFound(res, 'Partner not found');

  const { data: roles, error: roleErr } = await sb
    .from('user_roles')
    .select('user_id')
    .eq('partner_id', partner.id)
    .eq('role', 'partner_admin');
  if (roleErr) throw roleErr;
  if (!roles?.length) return notFound(res, 'No partner admin user linked');
  const primary = roles[0];

  const primaryProfile = await getProfileFor(sb, primary.user_id, 'email, full_name');
  if (!primaryProfile?.email) return notFound(res, 'Partner admin profile missing email');

  const newPassword = generateAutoPassword();
  const { error: pwErr } = await sb.auth.admin.updateUserById(primary.user_id, { password: newPassword });
  if (pwErr) {
    logger.error({ err: pwErr.message }, 'partner password reset failed');
    return badRequest(res, 'Could not reset password');
  }
  const { error: flagErr } = await sb
    .from('profiles')
    .update({ must_change_password: true })
    .eq('user_id', primary.user_id);
  if (flagErr) logger.warn({ err: flagErr.message, userId: primary.user_id }, 'must_change_password flag not set');

  // FIXED — fire-and-forget, and this email is the ONLY copy of the new
  // password: the old one has already been replaced by the time it is sent. On
  // Vercel the send was killed when the response was written, which locked the
  // partner out of their own account — the admin saw "reset: true" and the
  // partner never received anything. Awaited, and a failure is now surfaced as
  // an error so the admin does not believe the reset succeeded.
  const delivery = await email.safe(email.sendPartnerPasswordReset)(primaryProfile.email, {
    organizationName: partner.organization_name,
    contactName: primaryProfile.full_name,
    newPassword,
    loginUrl: `${config.publicAppUrl}/partner/login`,
  });

  await logActivity({ actor: req.user, action: 'partner_password_reset', entityType: 'partner', entityId: partner.id, req });

  if (delivery?.error) {
    logger.error(
      { err: delivery.error, to: primaryProfile.email, partnerId: partner.id },
      'partner password reset email FAILED — the new password was not delivered'
    );
    return fail(
      res,
      502,
      'EMAIL_DELIVERY_FAILED',
      'The password was reset but the email could not be delivered. Try again to issue a new one.',
      { partnerId: partner.id }
    );
  }
  return ok(res, { reset: true });
}

module.exports = {
  createPartner,
  listPartners,
  getPartner,
  updatePartner,
  suspendPartner,
  reactivatePartner,
  resetPartnerPassword,
};
