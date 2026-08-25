'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, paginated, badRequest } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const email = require('../services/email');
const { ADMIN_ROLES } = require('../middleware/auth');
const logger = require('../utils/logger');

async function ensureWallet(sb, agentId) {
  const { data: existing } = await sb.from('agent_wallets').select('*').eq('agent_id', agentId).maybeSingle();
  if (existing) return existing;
  const { data } = await sb.from('agent_wallets').insert({ agent_id: agentId }).select().single();
  return data;
}

async function getProfilesForMany(sb, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await sb.from('profiles').select('user_id, email, full_name').in('user_id', ids);
  return new Map((data || []).map((p) => [p.user_id, p]));
}

async function getWallet(req, res) {
  const sb = supabaseAdmin();
  const wallet = await ensureWallet(sb, req.user.userId);
  return ok(res, wallet);
}

async function listTransactions(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const wallet = await ensureWallet(sb, req.user.userId);
  const { data, count, error } = await sb
    .from('wallet_transactions')
    .select('*', { count: 'exact' })
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function getTransaction(req, res) {
  const sb = supabaseAdmin();
  const wallet = await ensureWallet(sb, req.user.userId);
  const { data } = await sb.from('wallet_transactions').select('*').eq('id', req.params.transactionId).eq('wallet_id', wallet.id).maybeSingle();
  if (!data) return notFound(res, 'Transaction not found');
  return ok(res, data);
}

/**
 * Agent requests a cash-out settlement to their bank. Admin will approve and
 * (manually) wire the funds, attaching a receipt image in the decide step.
 */
async function requestSettlement(req, res) {
  const sb = supabaseAdmin();
  const wallet = await ensureWallet(sb, req.user.userId);
  const { amount, bankName, accountNumber, accountName } = req.body;

  if (amount > Number(wallet.balance)) {
    return badRequest(res, 'Amount exceeds wallet balance');
  }

  const { data, error } = await sb.from('settlement_requests').insert({
    agent_id: req.user.userId,
    amount,
    bank_name: bankName,
    account_number: accountNumber,
    account_name: accountName,
  }).select().single();
  if (error) {
    logger.error({ err: error.message, code: error.code, hint: error.hint, details: error.details }, 'settlement insert failed');
    throw error;
  }

  // Notify admins (no broken embeds)
  try {
    const { data: admins } = await sb.from('user_roles').select('user_id').in('role', ADMIN_ROLES);
    const adminProfiles = await getProfilesForMany(sb, (admins || []).map((a) => a.user_id));
    if (admins?.length) {
      await sb.from('notifications').insert(admins.map((a) => ({
        user_id: a.user_id,
        type: 'settlement_requested',
        title: 'New settlement request',
        message: `${req.user.fullName || 'Field agent'} requested ₦${Number(amount).toLocaleString()}`,
        metadata: { settlementId: data.id },
      })));
      for (const a of admins) {
        const p = adminProfiles.get(a.user_id);
        if (p?.email) {
          email.safe(email.sendSettlementRequested)(p.email, {
            adminName: p.full_name,
            agentName: req.user.fullName,
            amount,
          });
        }
      }
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'settlement admin notifications failed');
  }

  await logActivity({ actor: req.user, action: 'settlement_requested', entityType: 'settlement', entityId: data.id, req });
  return created(res, data);
}

async function listSettlements(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { data, count, error } = await sb
    .from('settlement_requests')
    .select('*', { count: 'exact' })
    .eq('agent_id', req.user.userId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

// ============================================================================
// MANUAL CASH-PURCHASE LOG (agent → farmer)
// ----------------------------------------------------------------------------
// The wallet system is not "live money" yet — Heabron operates a manual flow:
//   1. Partner sends funds to admin
//   2. Admin sends funds to field agent (admin records "disbursement" with
//      receipt image in admin.wallet controller — see recordAgentDisbursement)
//   3. Field agent purchases inputs (seeds, fertiliser, etc.) for the farmer
//      and uploads a photo + details of the purchase as PROOF — that's this
//      endpoint.
//
// We persist the proof as a wallet_transactions row with:
//   transaction_type = 'debit'
//   source           = 'cash_purchase'
//   status           = 'completed'
//   recipient_name   = farmer name
//   payment_method   = 'cash' (or whatever the agent used)
//   receipt_image_url + proof_image_urls = the photos
//   related_financing_id = the loan this purchase is funded from
// ============================================================================
async function recordCashPurchase(req, res) {
  const sb = supabaseAdmin();
  const wallet = await ensureWallet(sb, req.user.userId);
  const body = req.body;

  // Validate farmer + (optional) financing request
  const { data: farmer } = await sb.from('farmers').select('id, full_name, created_by_agent_id').eq('id', body.farmerId).maybeSingle();
  if (!farmer) return notFound(res, 'Farmer not found');
  if (farmer.created_by_agent_id !== req.user.userId) {
    return badRequest(res, 'You did not create this farmer');
  }

  let financing = null;
  if (body.financingRequestId) {
    const { data } = await sb.from('financing_requests').select('id, status, submitted_by_agent_id').eq('id', body.financingRequestId).maybeSingle();
    if (!data) return notFound(res, 'Financing request not found');
    if (data.submitted_by_agent_id !== req.user.userId) return badRequest(res, 'Not your loan');
    financing = data;
  }

  const { data, error } = await sb.from('wallet_transactions').insert({
    wallet_id: wallet.id,
    transaction_type: 'debit',
    amount: body.amount,
    source: 'cash_purchase',
    // Starts pending — the field agent has uploaded proof of the purchase
    // and the admin confirms it (-> completed) or rejects it (-> failed).
    status: 'pending',
    description: body.description || `Purchase for ${farmer.full_name}`,
    reference_number: body.referenceNumber || null,
    recipient_name: farmer.full_name,
    payment_method: body.paymentMethod || 'cash',
    receipt_image_url: body.receiptImageUrl || null,
    proof_image_urls: body.proofImageUrls || null,
    related_financing_id: financing?.id || null,
  }).select().single();
  if (error) {
    logger.error({ err: error.message, code: error.code, hint: error.hint, details: error.details }, 'cash purchase insert failed');
    throw error;
  }

  await logActivity({
    actor: req.user,
    action: 'cash_purchase_recorded',
    entityType: 'wallet_transaction',
    entityId: data.id,
    metadata: { farmerId: farmer.id, amount: body.amount },
    req,
  });

  // Notify admins there's a purchase proof awaiting confirmation
  try {
    const { data: admins } = await sb.from('user_roles').select('user_id').in('role', ADMIN_ROLES);
    if (admins?.length) {
      await sb.from('notifications').insert(admins.map((a) => ({
        user_id: a.user_id,
        type: 'cash_purchase_submitted',
        title: 'Purchase proof submitted',
        message: `${req.user.fullName || 'A field agent'} recorded a ₦${Number(body.amount).toLocaleString()} purchase for ${farmer.full_name}`,
        metadata: { transactionId: data.id, farmerId: farmer.id },
      })));
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'cash purchase admin notification failed');
  }

  return created(res, data);
}

async function listCashPurchases(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const wallet = await ensureWallet(sb, req.user.userId);
  const { data, count, error } = await sb
    .from('wallet_transactions')
    .select('*', { count: 'exact' })
    .eq('wallet_id', wallet.id)
    .eq('source', 'cash_purchase')
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

module.exports = {
  getWallet,
  listTransactions,
  getTransaction,
  requestSettlement,
  listSettlements,
  recordCashPurchase,
  listCashPurchases,
};
