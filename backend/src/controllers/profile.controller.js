'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, badRequest, notFound } = require('../utils/response');
const { logActivity } = require('../utils/activity');
const { fetchAllRows } = require('../utils/pagination');
const logger = require('../utils/logger');

async function updateProfile(req, res) {
  const sb = supabaseAdmin();
  const patch = {};
  if (req.body.fullName !== undefined) patch.full_name = req.body.fullName;
  if (req.body.phone !== undefined) patch.phone = req.body.phone;
  if (req.body.state !== undefined) patch.state = req.body.state;
  if (req.body.lga !== undefined) patch.lga = req.body.lga;
  if (req.body.avatarUrl !== undefined) patch.avatar_url = req.body.avatarUrl;
  if (Object.keys(patch).length === 0) return badRequest(res, 'No fields to update');

  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb
    .from('profiles')
    .update(patch)
    .eq('user_id', req.user.userId)
    .select()
    .maybeSingle();
  if (error) throw error;
  // FIXED — `.single()` throws when no row matches, which surfaced as a
  // generic 500 for a user whose profile row is missing. `maybeSingle()` plus
  // an explicit 404 says what actually happened.
  if (!data) return notFound(res, 'Profile not found');
  await logActivity({ actor: req.user, action: 'profile_updated', entityType: 'profile', entityId: req.user.userId, req });
  return ok(res, data);
}

/**
 * GET /api/agent/bank-account
 * Returns the field agent's saved default bank account (used to pre-fill
 * the settlement-request form). Returns null fields if not saved yet.
 */
async function getBankAccount(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('profiles')
    .select('bank_name, bank_account_number, bank_account_name')
    .eq('user_id', req.user.userId)
    .maybeSingle();
  if (error) throw error;
  return ok(res, {
    bankName: data?.bank_name || null,
    accountNumber: data?.bank_account_number || null,
    accountName: data?.bank_account_name || null,
  });
}

/**
 * PUT /api/agent/bank-account
 * Saves the field agent's default bank account. All three fields required
 * together (an account is meaningless with any one missing).
 */
async function saveBankAccount(req, res) {
  const sb = supabaseAdmin();
  const { bankName, accountNumber, accountName } = req.body;

  const { data, error } = await sb
    .from('profiles')
    .update({
      bank_name: bankName,
      bank_account_number: accountNumber,
      bank_account_name: accountName,
    })
    .eq('user_id', req.user.userId)
    .select('bank_name, bank_account_number, bank_account_name')
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res, 'Profile not found');

  await logActivity({
    actor: req.user,
    action: 'bank_account_saved',
    entityType: 'profile',
    entityId: req.user.userId,
    req,
  });
  return ok(res, {
    bankName: data.bank_name,
    accountNumber: data.bank_account_number,
    accountName: data.bank_account_name,
  });
}

/**
 * Self-service account closure.
 *
 * FIXED — the comment said "Soft-suspend rather than hard delete to preserve
 * audit trail" and the code then did BOTH: it suspended the profile AND called
 * `auth.admin.deleteUser()`, with any failure swallowed by `.catch(() => null)`.
 *
 * Deleting the auth user is destructive far beyond this account. These all
 * reference `auth.users(id)` with ON DELETE CASCADE:
 *   profiles.user_id, user_roles.user_id, agent_applications.user_id,
 *   agent_wallets.agent_id — and wallet_transactions cascades from the wallet.
 * So an agent tapping "delete my account" erased their own wallet and its
 * entire transaction ledger — the record of real money disbursed to them —
 * while the farmers, loans and repayments they had created were left pointing
 * at a user id that no longer existed.
 *
 * The documented intent (and the safe behaviour for a credit system under
 * audit) is suspension only. `requireAuth` already refuses a suspended
 * account, so access ends immediately either way.
 */
async function deleteAccount(req, res) {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from('profiles')
    .update({ status: 'suspended', updated_at: new Date().toISOString() })
    .eq('user_id', req.user.userId);
  if (error) throw error;

  await logActivity({ actor: req.user, action: 'account_self_deleted', entityType: 'user', entityId: req.user.userId, req });
  // Response shape unchanged for the mobile client.
  return ok(res, { deleted: true });
}

/**
 * Export all data the field agent created (cooperatives + farmers).
 */
async function exportMyData(req, res) {
  const sb = supabaseAdmin();
  // FIXED — five un-ranged selects whose errors were discarded. PostgREST
  // truncates an un-ranged select at `db-max-rows` (1000) with NO error, so a
  // productive agent's "export all my data" silently returned the first 1000
  // of each table and presented it as a complete export. Paged, error-checked,
  // and the response now says when a cap was hit.
  const [coops, farmers, deliveries, financings, repayments] = await Promise.all([
    fetchAllRows(() => sb.from('cooperatives').select('*').eq('created_by_agent_id', req.user.userId)),
    fetchAllRows(() => sb.from('farmers').select(`*, farm_profiles(*)`).eq('created_by_agent_id', req.user.userId)),
    fetchAllRows(() => sb.from('produce_deliveries').select('*').eq('logged_by_agent_id', req.user.userId)),
    fetchAllRows(() => sb.from('financing_requests').select('*').eq('submitted_by_agent_id', req.user.userId)),
    fetchAllRows(() => sb.from('repayment_records').select('*').eq('recorded_by_agent_id', req.user.userId)),
  ]);
  for (const r of [coops, farmers, deliveries, financings, repayments]) {
    if (r.error) throw r.error;
  }
  const truncated = [coops, farmers, deliveries, financings, repayments].some((r) => r.truncated);
  if (truncated) logger.warn({ agentId: req.user.userId }, 'agent data export hit the paging cap');

  return ok(res, {
    exportedAt: new Date().toISOString(),
    agent: { id: req.user.userId, email: req.user.email, fullName: req.user.fullName },
    cooperatives: coops.rows,
    farmers: farmers.rows,
    deliveries: deliveries.rows,
    financingRequests: financings.rows,
    repayments: repayments.rows,
    // Additive: tells the client the export is partial.
    ...(truncated ? { truncated: true } : {}),
  });
}

module.exports = { updateProfile, deleteAccount, exportMyData, getBankAccount, saveBankAccount };
