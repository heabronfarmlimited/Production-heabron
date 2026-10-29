'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, paginated, notFound, badRequest, conflict } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const email = require('../services/email');
const { getProfileFor, getProfilesForMany } = require('../utils/profiles');
const { ensureWallet, recomputeWalletBalance } = require('./wallet.controller');
const logger = require('../utils/logger');

/**
 * List settlement (cash-out) requests with the agent profile attached.
 * Uses a two-step lookup because `settlement_requests.agent_id` references
 * `auth.users`, which PostgREST cannot join to `profiles`.
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
 *
 * FIXED — four separate money bugs:
 *
 *  1. DOUBLE APPROVAL. There was no status check. Approving the same
 *     settlement twice (an impatient admin, a double-tapped button, a retried
 *     request) debited the wallet twice and wrote two `settlement`
 *     transactions for one payout. The status transition is now guarded, and
 *     the guard is enforced in the UPDATE itself (`.eq('status','pending')`
 *     plus a row count) so two concurrent approvals cannot both win.
 *
 *  2. UNCHECKED WRITES. The `settlement_requests` update, the balance update
 *     and the transaction insert all discarded their `error`. A failed balance
 *     update still marked the settlement approved and emailed the agent
 *     "your settlement was approved" — money owed, nothing recorded.
 *
 *  3. SILENT OVERDRAFT. `balance: Math.max(0, balance - amount)` clamped a
 *     negative result to zero, so an over-approval quietly vanished instead of
 *     surfacing. The balance is now derived from the transaction ledger.
 *
 *  4. `notFound(res)` with no message on a missing settlement, and the
 *     decision branch validated *after* the row was already fetched and the
 *     agent profile loaded.
 */
async function decideSettlement(req, res) {
  const sb = supabaseAdmin();
  const { decision, adminNotes, receiptImageUrl, referenceNumber } = req.body;

  if (decision !== 'approve' && decision !== 'reject') {
    return badRequest(res, 'decision must be "approve" or "reject"');
  }

  const { data: settlement, error: readErr } = await sb
    .from('settlement_requests')
    .select('*')
    .eq('id', req.params.settlementId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!settlement) return notFound(res, 'Settlement request not found');

  if (settlement.status !== 'pending') {
    return conflict(res, `This settlement has already been ${settlement.status}`, {
      settlementId: settlement.id,
      currentStatus: settlement.status,
    });
  }

  const decidedAt = new Date().toISOString();
  const nextStatus = decision === 'approve' ? 'approved' : 'rejected';

  // Conditional update: only the request that still sees `pending` wins, so a
  // concurrent second approval gets zero rows back and is rejected below.
  const { data: claimed, error: claimErr } = await sb
    .from('settlement_requests')
    .update({
      status: nextStatus,
      admin_notes: adminNotes,
      approved_by_admin_id: req.user.userId,
      approved_at: decidedAt,
    })
    .eq('id', settlement.id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    return conflict(res, 'This settlement was decided by someone else a moment ago', {
      settlementId: settlement.id,
    });
  }

  const agentProfile = await getProfileFor(sb, settlement.agent_id);

  if (decision === 'approve') {
    // Record the payout in the ledger, then recompute the balance from it.
    // Ledger first means a crash leaves the balance understated-but-derivable
    // rather than a counter that no longer matches any record.
    const wallet = await ensureWallet(sb, settlement.agent_id);

    const { error: txErr } = await sb.from('wallet_transactions').insert({
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
      created_by_user_id: req.user.userId,
      confirmed_by_admin_id: req.user.userId,
      confirmed_at: decidedAt,
    });
    if (txErr) {
      // Put the request back so the payout is not silently lost: it returns to
      // the queue instead of being marked paid with no transaction behind it.
      await sb
        .from('settlement_requests')
        .update({ status: 'pending', approved_by_admin_id: null, approved_at: null })
        .eq('id', settlement.id);
      logger.error(
        { err: txErr.message, code: txErr.code, details: txErr.details, settlementId: settlement.id },
        'settlement transaction insert failed — settlement returned to pending'
      );
      throw txErr;
    }

    await recomputeWalletBalance(sb, wallet.id);

    if (agentProfile?.email) {
      const result = await email.safe(email.sendSettlementApproved)(agentProfile.email, {
        recipientName: agentProfile.full_name,
        amount: settlement.amount,
      });
      if (result?.error) {
        logger.warn({ err: result.error, to: agentProfile.email }, 'settlement approved email rejected');
      }
    }
    const { error: notifyErr } = await sb.from('notifications').insert({
      user_id: settlement.agent_id,
      type: 'settlement_approved',
      title: 'Settlement approved',
      message: `Your ₦${Number(settlement.amount).toLocaleString()} settlement was approved`,
      metadata: { settlementId: settlement.id },
    });
    if (notifyErr) logger.warn({ err: notifyErr.message }, 'settlement approved notification failed');
  } else {
    // FIXED — a rejection told the agent nothing at all. They watched a
    // pending request become "rejected" with no explanation delivered.
    //
    // NOTE: `settlement_rejected` is a new `notification_type` enum value —
    // see migrations/010_settlement_rejected_notification.sql. Until that
    // migration is applied the insert fails the enum check, which is logged
    // and non-fatal (the previous behaviour was no notification at all, so
    // this cannot regress).
    const { error: notifyErr } = await sb.from('notifications').insert({
      user_id: settlement.agent_id,
      type: 'settlement_rejected',
      title: 'Settlement rejected',
      message: `Your ₦${Number(settlement.amount).toLocaleString()} settlement request was rejected${adminNotes ? `: ${adminNotes}` : ''}`,
      metadata: { settlementId: settlement.id },
    });
    if (notifyErr) logger.warn({ err: notifyErr.message }, 'settlement rejected notification failed');
  }

  await logActivity({
    actor: req.user,
    action: `settlement_${nextStatus}`,
    entityType: 'settlement',
    entityId: settlement.id,
    metadata: { amount: settlement.amount },
    req,
  });
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

  // Validate target agent. FIXED — the lookup error was discarded, so a
  // transient failure answered "Field agent not found" and the admin
  // reasonably concluded the agent did not exist.
  const { data: agentRole, error: roleErr } = await sb
    .from('user_roles')
    .select('user_id, role')
    .eq('user_id', body.agentId)
    .eq('role', 'field_agent')
    .maybeSingle();
  if (roleErr) throw roleErr;
  if (!agentRole) return notFound(res, 'Field agent not found');

  // FIXED — a repeated submission credited the wallet again. A bank transfer
  // reference identifies one real-world movement of money, so it must be
  // unique. Without this, one double-tapped "record disbursement" button put
  // twice the cash into an agent's wallet with no way to tell afterwards.
  if (body.referenceNumber) {
    const { data: dupe, error: dupeErr } = await sb
      .from('wallet_transactions')
      .select('id, wallet_id')
      .eq('source', body.source || 'admin_disbursement')
      .eq('reference_number', body.referenceNumber)
      .limit(1);
    if (dupeErr) throw dupeErr;
    if (dupe?.length) {
      return conflict(res, 'A disbursement with this reference number is already recorded', {
        referenceNumber: body.referenceNumber,
        existingTransactionId: dupe[0].id,
      });
    }
  }

  // FIXED — the wallet was fetched and created with two unchecked queries,
  // then credited with `balance: Number(wallet.balance) + amount`. That is a
  // read-then-write with no constraint: two disbursements recorded at the same
  // moment both read the old balance and one credit was lost. The transaction
  // is now written first and the balance derived from the ledger.
  const wallet = await ensureWallet(sb, body.agentId);

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
    created_by_user_id: req.user.userId,
    confirmed_by_admin_id: req.user.userId,
    confirmed_at: new Date().toISOString(),
  }).select().single();
  if (error) {
    logger.error({ err: error.message, code: error.code, hint: error.hint, details: error.details }, 'admin disbursement insert failed');
    throw error;
  }

  await recomputeWalletBalance(sb, wallet.id);

  // Notify the agent
  try {
    const agentProfile = await getProfileFor(sb, body.agentId);
    const { error: notifyErr } = await sb.from('notifications').insert({
      user_id: body.agentId,
      type: 'financing_disbursed',
      title: 'Funds received from admin',
      message: `₦${Number(body.amount).toLocaleString()} credited to your wallet`,
      metadata: { transactionId: tx.id, source: 'admin_disbursement' },
    });
    if (notifyErr) throw notifyErr;

    if (agentProfile?.email) {
      // Reuse the existing "settlement approved" template — same shape of
      // information ("recipient X has received Y amount").
      const result = await email.safe(email.sendSettlementApproved)(agentProfile.email, {
        recipientName: agentProfile.full_name,
        amount: body.amount,
      });
      if (result?.error) {
        logger.warn({ err: result.error, to: agentProfile.email }, 'disbursement email rejected');
      }
    }
  } catch (e) {
    logger.warn({ err: e.message, code: e.code }, 'agent disbursement notification failed');
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

  // FIXED — `agentId` was applied with a JS `.filter()` AFTER `.range()`. The
  // database returned page N of *all* transactions, then the filter threw away
  // the ones belonging to other agents. Filtering by agent therefore returned
  // a near-empty page while `meta.total` reported the unfiltered count, so the
  // admin saw "247 results" and three rows. Resolve the agent's wallet first
  // and filter in the query, before pagination.
  if (agentId) {
    const { data: wallets, error: wErr } = await sb
      .from('agent_wallets')
      .select('id')
      .eq('agent_id', agentId);
    if (wErr) throw wErr;
    const walletIds = (wallets || []).map((w) => w.id);
    if (walletIds.length === 0) {
      return paginated(res, [], { page, pageSize, total: 0 });
    }
    q = q.in('wallet_id', walletIds);
  }

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, to);
  if (error) throw error;

  const rows = data || [];
  const profiles = await getProfilesForMany(sb, rows.map((r) => r.agent_wallets?.agent_id));
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
  const { status, agentId } = req.query;

  let q = sb
    .from('wallet_transactions')
    .select('*, agent_wallets(agent_id)', { count: 'exact' })
    .eq('source', 'cash_purchase');
  if (status) q = q.eq('status', status);

  if (agentId) {
    const { data: wallets, error: wErr } = await sb
      .from('agent_wallets')
      .select('id')
      .eq('agent_id', agentId);
    if (wErr) throw wErr;
    const walletIds = (wallets || []).map((w) => w.id);
    if (walletIds.length === 0) return paginated(res, [], { page, pageSize, total: 0 });
    q = q.in('wallet_id', walletIds);
  }

  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, to);
  if (error) throw error;

  const rows = data || [];
  const profiles = await getProfilesForMany(sb, rows.map((r) => r.agent_wallets?.agent_id));
  const enriched = rows.map((r) => ({
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

  const { data: tx, error: readErr } = await sb
    .from('wallet_transactions')
    .select('*, agent_wallets(agent_id)')
    .eq('id', req.params.transactionId)
    .eq('source', 'cash_purchase')
    .maybeSingle();
  if (readErr) throw readErr;
  if (!tx) return notFound(res, 'Purchase record not found');

  // FIXED — there was no status guard, so a purchase could be confirmed and
  // then rejected (or confirmed twice). Each pass appended the admin note to
  // `description` again, so the stored description grew a new "— note" tail on
  // every decision and the audit trail became unreadable.
  if (tx.status !== 'pending') {
    return conflict(res, `This purchase has already been ${tx.status === 'completed' ? 'confirmed' : 'rejected'}`, {
      transactionId: tx.id,
      currentStatus: tx.status,
    });
  }

  const newStatus = decision === 'confirm' ? 'completed' : 'failed';
  const note = adminNotes ? `${tx.description || ''} — ${adminNotes}`.trim() : tx.description;

  const { data: claimed, error: updErr } = await sb
    .from('wallet_transactions')
    .update({
      status: newStatus,
      description: note,
      confirmed_by_admin_id: req.user.userId,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', tx.id)
    .eq('status', 'pending')
    .select('id');
  if (updErr) throw updErr;
  if (!claimed || claimed.length === 0) {
    return conflict(res, 'This purchase was decided by someone else a moment ago', { transactionId: tx.id });
  }

  const agentId = tx.agent_wallets?.agent_id;
  if (agentId) {
    try {
      const { error: notifyErr } = await sb.from('notifications').insert({
        user_id: agentId,
        type: decision === 'confirm' ? 'cash_purchase_confirmed' : 'cash_purchase_rejected',
        title: decision === 'confirm' ? 'Purchase confirmed' : 'Purchase rejected',
        message: decision === 'confirm'
          ? `Your ₦${Number(tx.amount).toLocaleString()} purchase was confirmed`
          : `Your ₦${Number(tx.amount).toLocaleString()} purchase was rejected${adminNotes ? `: ${adminNotes}` : ''}`,
        metadata: { transactionId: tx.id },
      });
      if (notifyErr) throw notifyErr;

      const ap = await getProfileFor(sb, agentId);
      if (ap?.email) {
        const result = await email.safe(email.sendCashPurchaseDecision)(ap.email, {
          recipientName: ap.full_name,
          amount: tx.amount,
          decision,
          adminNotes,
        });
        if (result?.error) {
          logger.warn({ err: result.error, to: ap.email }, 'cash purchase decision email rejected');
        }
      }
    } catch (e) {
      logger.warn({ err: e.message, code: e.code }, 'cash purchase confirm notification failed');
    }
  }

  await logActivity({
    actor: req.user,
    action: `cash_purchase_${decision === 'confirm' ? 'confirmed' : 'rejected'}`,
    entityType: 'wallet_transaction',
    entityId: tx.id,
    metadata: { amount: tx.amount },
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
