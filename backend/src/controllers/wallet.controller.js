'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated, badRequest, conflict } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const email = require('../services/email');
const { ADMIN_ROLES } = require('../middleware/auth');
const { getProfilesForMany } = require('../utils/profiles');
const logger = require('../utils/logger');

/**
 * Fetch (or lazily create) an agent's wallet.
 *
 * FIXED — both queries discarded their error. On a transient failure this
 * returned `undefined`, and every caller then dereferenced `wallet.id` /
 * `wallet.balance` and produced a generic 500. Worse, the insert's error was
 * also dropped, so a unique-violation race (two concurrent requests both
 * creating the wallet) silently returned `undefined` instead of the row that
 * the other request had just created.
 */
async function ensureWallet(sb, agentId) {
  const { data: existing, error } = await sb
    .from('agent_wallets')
    .select('*')
    .eq('agent_id', agentId)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data, error: insErr } = await sb
    .from('agent_wallets')
    .insert({ agent_id: agentId })
    .select()
    .single();
  if (insErr) {
    // Lost the create race — the row exists now, so read it back rather than
    // failing the request.
    if (insErr.code === '23505') {
      const { data: raced, error: reReadErr } = await sb
        .from('agent_wallets')
        .select('*')
        .eq('agent_id', agentId)
        .maybeSingle();
      if (reReadErr) throw reReadErr;
      if (raced) return raced;
    }
    throw insErr;
  }
  return data;
}

/**
 * Recompute a wallet's balance from its own transaction ledger.
 *
 * FIXED — `agent_wallets.balance` was a stored counter mutated with
 * read-then-write arithmetic in two places (`recordAgentDisbursement` adds,
 * `decideSettlement` subtracts). Two concurrent writes lost one of the updates,
 * and a failed follow-up insert left the counter ahead of the ledger with
 * nothing to reconcile against. Deriving the balance from the ledger makes both
 * operations idempotent and self-healing: re-running one cannot double-count.
 *
 * The projection reproduces exactly what the two writers intended, so no
 * balance changes meaning:
 *   + completed `credit`     (admin → agent disbursements)
 *   − completed `settlement` (approved agent cash-outs)
 *
 * Pending/failed rows are excluded. `cash_purchase` debits are deliberately
 * NOT subtracted — see the note in AUDIT_BACKEND.md; that is an open product
 * question, not something to decide here.
 */
const BALANCE_CREDIT_TYPES = ['credit'];
const BALANCE_DEBIT_TYPES = ['settlement'];

async function recomputeWalletBalance(sb, walletId) {
  const { data, error } = await sb
    .from('wallet_transactions')
    .select('transaction_type, amount')
    .eq('wallet_id', walletId)
    .eq('status', 'completed')
    .in('transaction_type', [...BALANCE_CREDIT_TYPES, ...BALANCE_DEBIT_TYPES])
    .limit(10000);
  if (error) throw error;

  let balance = 0;
  for (const row of data || []) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    if (BALANCE_CREDIT_TYPES.includes(row.transaction_type)) balance += amount;
    else balance -= amount;
  }
  // Naira with 2dp. Round away binary-float drift before it is stored.
  balance = Math.round(balance * 100) / 100;

  const { data: updated, error: updErr } = await sb
    .from('agent_wallets')
    .update({ balance })
    .eq('id', walletId)
    .select()
    .single();
  if (updErr) throw updErr;
  return updated;
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
  const { data, error } = await sb
    .from('wallet_transactions')
    .select('*')
    .eq('id', req.params.transactionId)
    .eq('wallet_id', wallet.id)
    .maybeSingle();
  if (error) throw error;
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

  // FIXED — the check was `amount > wallet.balance` against the stored balance
  // only. Nothing reserved the funds, so an agent with ₦100k could file ten
  // separate ₦100k requests, each passing the check. The admin then approved
  // them one by one and `decideSettlement` clamped the balance with
  // `Math.max(0, …)`, absorbing the ₦900k overdraft without a trace.
  // Pending requests now count against the available balance.
  const { data: pending, error: pendErr } = await sb
    .from('settlement_requests')
    .select('amount')
    .eq('agent_id', req.user.userId)
    .eq('status', 'pending')
    .limit(1000);
  if (pendErr) throw pendErr;

  const reserved = (pending || []).reduce((s, r) => {
    const n = Number(r.amount);
    return Number.isFinite(n) && n > 0 ? s + n : s;
  }, 0);
  const balance = Number(wallet.balance) || 0;
  const available = Math.round((balance - reserved) * 100) / 100;

  if (Number(amount) > available) {
    return badRequest(res, 'Amount exceeds your available wallet balance', {
      balance,
      pendingSettlements: Math.round(reserved * 100) / 100,
      available,
      requested: Number(amount),
    });
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

  // Notify admins. FIXED — the notification insert's error was discarded and
  // the emails were fire-and-forget via `email.safe(...)`, which on Vercel are
  // killed when the response is written. An admin was therefore never told a
  // settlement was waiting. Both are awaited and reported now.
  try {
    const { data: admins, error: adminErr } = await sb
      .from('user_roles')
      .select('user_id')
      .in('role', ADMIN_ROLES);
    if (adminErr) throw adminErr;

    if (admins?.length) {
      const adminProfiles = await getProfilesForMany(sb, admins.map((a) => a.user_id));
      const { error: notifyErr } = await sb.from('notifications').insert(admins.map((a) => ({
        user_id: a.user_id,
        type: 'settlement_requested',
        title: 'New settlement request',
        message: `${req.user.fullName || 'Field agent'} requested ₦${Number(amount).toLocaleString()}`,
        metadata: { settlementId: data.id },
      })));
      if (notifyErr) throw notifyErr;

      await Promise.all(
        admins.map(async (a) => {
          const p = adminProfiles.get(a.user_id);
          if (!p?.email) return;
          const result = await email.safe(email.sendSettlementRequested)(p.email, {
            adminName: p.full_name,
            agentName: req.user.fullName,
            amount,
          });
          if (result?.error) {
            logger.warn({ err: result.error, to: p.email }, 'settlement request email rejected');
          }
        })
      );
    }
  } catch (e) {
    logger.warn({ err: e.message, code: e.code }, 'settlement admin notifications failed');
  }

  await logActivity({ actor: req.user, action: 'settlement_requested', entityType: 'settlement', entityId: data.id, req });
  return created(res, data);
}

async function listSettlements(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { status } = req.query;
  let q = sb
    .from('settlement_requests')
    .select('*', { count: 'exact' })
    .eq('agent_id', req.user.userId);
  if (status) q = q.eq('status', status);
  const { data, count, error } = await q
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
//   status           = 'pending'  (admin confirms -> completed, rejects -> failed)
//   recipient_name   = farmer name
//   payment_method   = 'cash' (or whatever the agent used)
//   receipt_image_url + proof_image_urls = the photos
//   related_financing_id = the loan this purchase is funded from
//
// OPEN QUESTION (see AUDIT_BACKEND.md "Open — for the API owner"): nothing
// here validates the amount against the agent's wallet balance or against the
// related loan's disbursed amount, so an agent can file purchases totalling
// more than they were ever given. Deliberately NOT changed here — it is a
// product decision about what the proof log means, not a code defect.
// ============================================================================
async function recordCashPurchase(req, res) {
  const sb = supabaseAdmin();
  const wallet = await ensureWallet(sb, req.user.userId);
  const body = req.body;

  // Validate farmer + (optional) financing request.
  // FIXED — the lookup error was discarded (a transient failure read as
  // "farmer not found"), and an ownership failure answered 400 BAD_REQUEST.
  // Being refused someone else's record is 403 FORBIDDEN; the 400 made the
  // mobile client show a form-validation error for an authorisation problem.
  const { data: farmer, error: farmerErr } = await sb
    .from('farmers')
    .select('id, full_name, created_by_agent_id')
    .eq('id', body.farmerId)
    .maybeSingle();
  if (farmerErr) throw farmerErr;
  if (!farmer) return notFound(res, 'Farmer not found');
  if (farmer.created_by_agent_id !== req.user.userId) {
    return forbidden(res, 'You did not onboard this farmer');
  }

  let financing = null;
  if (body.financingRequestId) {
    const { data, error: finErr } = await sb
      .from('financing_requests')
      .select('id, status, submitted_by_agent_id, farmer_id')
      .eq('id', body.financingRequestId)
      .maybeSingle();
    if (finErr) throw finErr;
    if (!data) return notFound(res, 'Financing request not found');
    if (data.submitted_by_agent_id !== req.user.userId) {
      return forbidden(res, 'That financing request is not yours');
    }
    // FIXED — a purchase could be attached to a loan belonging to a different
    // farmer, which silently mis-attributed the spend in every report that
    // joins on `related_financing_id`.
    if (data.farmer_id && data.farmer_id !== farmer.id) {
      return badRequest(res, 'That financing request belongs to a different farmer');
    }
    financing = data;
  }

  // FIXED — a duplicate submission (the mobile client retrying on a flaky
  // connection) filed the same purchase twice, inflating the admin's queue and
  // the agent's spend record. A supplied reference number must be unique per
  // agent wallet.
  if (body.referenceNumber) {
    const { data: dupe, error: dupeErr } = await sb
      .from('wallet_transactions')
      .select('id')
      .eq('wallet_id', wallet.id)
      .eq('source', 'cash_purchase')
      .eq('reference_number', body.referenceNumber)
      .limit(1);
    if (dupeErr) throw dupeErr;
    if (dupe?.length) {
      return conflict(res, 'A purchase with this reference number has already been filed', {
        referenceNumber: body.referenceNumber,
        existingTransactionId: dupe[0].id,
      });
    }
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
    // Real column on wallet_transactions — previously unused, so a purchase
    // proof could not be traced back to the farmer it was made for.
    related_farmer_id: farmer.id,
    created_by_user_id: req.user.userId,
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

  // Notify admins there's a purchase proof awaiting confirmation.
  // FIXED — the in-app notification error was discarded, and the matching
  // email template (`sendCashPurchaseSubmitted`) was written and exported but
  // never called, so the admin only ever found out by refreshing the queue.
  try {
    const { data: admins, error: adminErr } = await sb
      .from('user_roles')
      .select('user_id')
      .in('role', ADMIN_ROLES);
    if (adminErr) throw adminErr;

    if (admins?.length) {
      const adminProfiles = await getProfilesForMany(sb, admins.map((a) => a.user_id));
      const { error: notifyErr } = await sb.from('notifications').insert(admins.map((a) => ({
        user_id: a.user_id,
        type: 'cash_purchase_submitted',
        title: 'Purchase proof submitted',
        message: `${req.user.fullName || 'A field agent'} recorded a ₦${Number(body.amount).toLocaleString()} purchase for ${farmer.full_name}`,
        metadata: { transactionId: data.id, farmerId: farmer.id },
      })));
      if (notifyErr) throw notifyErr;

      await Promise.all(
        admins.map(async (a) => {
          const p = adminProfiles.get(a.user_id);
          if (!p?.email) return;
          const result = await email.safe(email.sendCashPurchaseSubmitted)(p.email, {
            adminName: p.full_name,
            agentName: req.user.fullName,
            farmerName: farmer.full_name,
            amount: body.amount,
          });
          if (result?.error) {
            logger.warn({ err: result.error, to: p.email }, 'cash purchase email rejected');
          }
        })
      );
    }
  } catch (e) {
    logger.warn({ err: e.message, code: e.code }, 'cash purchase admin notification failed');
  }

  return created(res, data);
}

async function listCashPurchases(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { status } = req.query;
  const wallet = await ensureWallet(sb, req.user.userId);

  let q = sb
    .from('wallet_transactions')
    .select('*', { count: 'exact' })
    .eq('wallet_id', wallet.id)
    .eq('source', 'cash_purchase');
  if (status) q = q.eq('status', status);

  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

module.exports = {
  ensureWallet,
  recomputeWalletBalance,
  getWallet,
  listTransactions,
  getTransaction,
  requestSettlement,
  listSettlements,
  recordCashPurchase,
  listCashPurchases,
};
