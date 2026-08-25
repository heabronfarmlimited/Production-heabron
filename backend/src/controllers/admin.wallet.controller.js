'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, paginated, notFound, badRequest } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const email = require('../services/email');
const logger = require('../utils/logger');

async function getProfileFor(sb, userId) {
  if (!userId) return null;
  const { data } = await sb.from('profiles').select('email, full_name').eq('user_id', userId).maybeSingle();
  return data || null;
}

async function getProfilesForMany(sb, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await sb.from('profiles').select('user_id, email, full_name').in('user_id', ids);
  return new Map((data || []).map((p) => [p.user_id, p]));
}

/**
 * List settlement (cash-out) requests with the agent profile attached.
 * Replaces the broken `profiles:agent_id(...)` embed with a two-step lookup.
 */
async function listSettlements(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const status = req.query.status || 'pending';
  const { data, count, error } = await sb
    .from('settlement_requests')
    .select('*', { count: 'exact' })
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const profiles = await getProfilesForMany(sb, (data || []).map((s) => s.agent_id));
  const enriched = (data || []).map((s) => ({
    ...s,
    agent: profiles.get(s.agent_id) || null,
  }));

  return paginated(res, enriched, { page, pageSize, total: count || 0 });
}

/**
 * Admin decides on an agent's cash-out settlement request. On `approve`,
 * the admin can attach a receipt image (proof of bank transfer / cash
 * delivery). We record that as a follow-up wallet_transactions row so the
 * agent can see it in their transaction history.
 */
async function decideSettlement(req, res) {
  const sb = supabaseAdmin();
  const { decision, adminNotes, receiptImageUrl, referenceNumber } = req.body;

  const { data: settlement } = await sb
    .from('settlement_requests')
    .select('*')
    .eq('id', req.params.settlementId)
    .maybeSingle();
  if (!settlement) return notFound(res);

  const agentProfile = await getProfileFor(sb, settlement.agent_id);

  if (decision === 'approve') {
    await sb.from('settlement_requests').update({
      status: 'approved',
      admin_notes: adminNotes,
      approved_by_admin_id: req.user.userId,
      approved_at: new Date().toISOString(),
    }).eq('id', settlement.id);

    // Adjust wallet balance + log the settlement as a transaction with
    // the admin's receipt image as proof.
    const { data: wallet } = await sb.from('agent_wallets').select('*').eq('agent_id', settlement.agent_id).maybeSingle();
    if (wallet) {
      await sb.from('agent_wallets').update({
        balance: Math.max(0, Number(wallet.balance) - Number(settlement.amount)),
      }).eq('id', wallet.id);

      await sb.from('wallet_transactions').insert({
        wallet_id: wallet.id,
        transaction_type: 'settlement',
        amount: settlement.amount,
        description: adminNotes || 'Settlement approved by admin',
        source: 'settlement_transfer',
        status: 'completed',
        reference_number: referenceNumber || null,
        recipient_name: settlement.account_name,
        payment_method: 'bank_transfer',
        receipt_image_url: receiptImageUrl || null,
      });
    }

    if (agentProfile?.email) {
      email.safe(email.sendSettlementApproved)(agentProfile.email, {
        recipientName: agentProfile.full_name,
        amount: settlement.amount,
      });
    }
    await sb.from('notifications').insert({
      user_id: settlement.agent_id,
      type: 'settlement_approved',
      title: 'Settlement approved',
      message: `Your ₦${Number(settlement.amount).toLocaleString()} settlement was approved`,
      metadata: { settlementId: settlement.id },
    });
  } else if (decision === 'reject') {
    await sb.from('settlement_requests').update({
      status: 'rejected',
      admin_notes: adminNotes,
      approved_by_admin_id: req.user.userId,
      approved_at: new Date().toISOString(),
    }).eq('id', settlement.id);
  } else {
    return badRequest(res, 'decision must be "approve" or "reject"');
  }

  await logActivity({ actor: req.user, action: `settlement_${decision}d`, entityType: 'settlement', entityId: settlement.id, req });
  return ok(res, { decision });
}

async function listAllWallets(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { data, count, error } = await sb
    .from('agent_wallets')
    .select('*', { count: 'exact' })
    .order('balance', { ascending: false })
    .range(from, to);
  if (error) throw error;

  const profiles = await getProfilesForMany(sb, (data || []).map((w) => w.agent_id));
  const enriched = (data || []).map((w) => ({ ...w, agent: profiles.get(w.agent_id) || null }));

  return paginated(res, enriched, { page, pageSize, total: count || 0 });
}

// ============================================================================
// ADMIN → AGENT DISBURSEMENT
// ----------------------------------------------------------------------------
// Admin records a manual transfer of funds to a field agent (so the agent
// can purchase inputs for farmers). The admin attaches a receipt image as
// proof. This credits the agent's wallet and shows up in their transaction
// history under "Received" with proof attached.
// ============================================================================
async function recordAgentDisbursement(req, res) {
  const sb = supabaseAdmin();
  const body = req.body;

  // Validate target agent
  const { data: agentRole } = await sb
    .from('user_roles')
    .select('user_id, role')
    .eq('user_id', body.agentId)
    .eq('role', 'field_agent')
    .maybeSingle();
  if (!agentRole) return notFound(res, 'Field agent not found');

  // Ensure wallet exists
  let { data: wallet } = await sb.from('agent_wallets').select('*').eq('agent_id', body.agentId).maybeSingle();
  if (!wallet) {
    const { data } = await sb.from('agent_wallets').insert({ agent_id: body.agentId }).select().single();
    wallet = data;
  }

  // Credit wallet + record transaction
  await sb.from('agent_wallets').update({
    balance: Number(wallet.balance) + Number(body.amount),
  }).eq('id', wallet.id);

  const { data: tx, error } = await sb.from('wallet_transactions').insert({
    wallet_id: wallet.id,
    transaction_type: 'credit',
    amount: body.amount,
    source: body.source || 'admin_disbursement',
    status: 'completed',
    description: body.description || 'Disbursement from admin',
    reference_number: body.referenceNumber || null,
    recipient_name: body.recipientName || null, // e.g. agent's name
    payment_method: body.paymentMethod || 'bank_transfer',
    receipt_image_url: body.receiptImageUrl || null,
    proof_image_urls: body.proofImageUrls || null,
    related_financing_id: body.relatedFinancingId || null,
  }).select().single();
  if (error) {
    logger.error({ err: error.message, code: error.code, hint: error.hint, details: error.details }, 'admin disbursement insert failed');
    throw error;
  }

  // Notify the agent
  try {
    const agentProfile = await getProfileFor(sb, body.agentId);
    await sb.from('notifications').insert({
      user_id: body.agentId,
      type: 'financing_disbursed',
      title: 'Funds received from admin',
      message: `₦${Number(body.amount).toLocaleString()} credited to your wallet`,
      metadata: { transactionId: tx.id, source: 'admin_disbursement' },
    });
    if (agentProfile?.email) {
      // Reuse the existing "settlement approved" template — same shape of
      // information ("recipient X has received Y amount").
      email.safe(email.sendSettlementApproved)(agentProfile.email, {
        recipientName: agentProfile.full_name,
        amount: body.amount,
      });
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'agent disbursement notification failed');
  }

  await logActivity({
    actor: req.user,
    action: 'admin_disbursement_recorded',
    entityType: 'wallet_transaction',
    entityId: tx.id,
    metadata: { agentId: body.agentId, amount: body.amount },
    req,
  });

  return created(res, tx);
}

/**
 * List every disbursement (or any wallet transaction with optional filters).
 * Used by the admin wallet dashboard.
 */
async function listAllTransactions(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { source, agentId, transactionType } = req.query;

  let q = sb.from('wallet_transactions').select('*, agent_wallets(agent_id)', { count: 'exact' });
  if (source) q = q.eq('source', source);
  if (transactionType) q = q.eq('transaction_type', transactionType);
  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;

  let rows = data || [];
  if (agentId) rows = rows.filter((r) => r.agent_wallets?.agent_id === agentId);

  const agentIds = rows.map((r) => r.agent_wallets?.agent_id).filter(Boolean);
  const profiles = await getProfilesForMany(sb, agentIds);
  const enriched = rows.map((r) => ({
    ...r,
    agent: r.agent_wallets ? profiles.get(r.agent_wallets.agent_id) || null : null,
  }));

  return paginated(res, enriched, { page, pageSize, total: count || 0 });
}

/**
 * GET /api/admin/cash-purchases
 * List field-agent purchase records (proof of buying inputs for a farmer),
 * filterable by ?status=pending|completed|failed. Includes the agent profile.
 */
async function listCashPurchases(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const status = req.query.status; // optional

  let q = sb
    .from('wallet_transactions')
    .select('*, agent_wallets(agent_id)', { count: 'exact' })
    .eq('source', 'cash_purchase');
  if (status) q = q.eq('status', status);
  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;

  const agentIds = (data || []).map((r) => r.agent_wallets?.agent_id).filter(Boolean);
  const profiles = await getProfilesForMany(sb, agentIds);
  const enriched = (data || []).map((r) => ({
    ...r,
    agent: r.agent_wallets ? profiles.get(r.agent_wallets.agent_id) || null : null,
  }));

  return paginated(res, enriched, { page, pageSize, total: count || 0 });
}

/**
 * POST /api/admin/cash-purchases/:transactionId/confirm
 * Admin confirms (decision='confirm' -> completed) or rejects
 * (decision='reject' -> failed) a field-agent purchase proof.
 */
async function confirmCashPurchase(req, res) {
  const sb = supabaseAdmin();
  const { decision, adminNotes } = req.body;

  const { data: tx } = await sb
    .from('wallet_transactions')
    .select('*, agent_wallets(agent_id)')
    .eq('id', req.params.transactionId)
    .eq('source', 'cash_purchase')
    .maybeSingle();
  if (!tx) return notFound(res, 'Purchase record not found');

  const newStatus = decision === 'confirm' ? 'completed' : 'failed';
  const note = adminNotes ? `${tx.description || ''} — ${adminNotes}`.trim() : tx.description;
  await sb.from('wallet_transactions').update({ status: newStatus, description: note }).eq('id', tx.id);

  const agentId = tx.agent_wallets?.agent_id;
  if (agentId) {
    try {
      await sb.from('notifications').insert({
        user_id: agentId,
        type: decision === 'confirm' ? 'cash_purchase_confirmed' : 'cash_purchase_rejected',
        title: decision === 'confirm' ? 'Purchase confirmed' : 'Purchase rejected',
        message: decision === 'confirm'
          ? `Your ₦${Number(tx.amount).toLocaleString()} purchase was confirmed`
          : `Your ₦${Number(tx.amount).toLocaleString()} purchase was rejected${adminNotes ? `: ${adminNotes}` : ''}`,
        metadata: { transactionId: tx.id },
      });
      const ap = await getProfileFor(sb, agentId);
      if (ap?.email) {
        email.safe(email.sendCashPurchaseDecision)(ap.email, {
          recipientName: ap.full_name,
          amount: tx.amount,
          decision,
          adminNotes,
        });
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'cash purchase confirm notification failed');
    }
  }

  await logActivity({
    actor: req.user,
    action: `cash_purchase_${decision === 'confirm' ? 'confirmed' : 'rejected'}`,
    entityType: 'wallet_transaction',
    entityId: tx.id,
    req,
  });
  return ok(res, { status: newStatus });
}

module.exports = {
  listSettlements,
  decideSettlement,
  listAllWallets,
  recordAgentDisbursement,
  listAllTransactions,
  listCashPurchases,
  confirmCashPurchase,
};
