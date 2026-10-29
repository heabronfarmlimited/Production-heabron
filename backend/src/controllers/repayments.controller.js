'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated, badRequest, conflict, fail } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer, loanPrincipal } = require('../services/credit-score');
const { getProfileFor } = require('../utils/profiles');
const email = require('../services/email');
const logger = require('../utils/logger');

/** Statuses a loan must be in before a repayment can be recorded against it. */
const REPAYABLE_STATUSES = ['disbursed', 'approved'];

/**
 * Recompute a loan's repayment position from its active (non-voided) records,
 * and keep the cached `financing_requests.total_repaid` column in step.
 *
 * FIXED — the schema declares `total_repaid NUMERIC(12,2) DEFAULT 0` with the
 * comment "cached; maintained by app", but nothing in the codebase ever wrote
 * it. It sat at 0 for every loan ever created, so any consumer trusting that
 * column (it is selected by `financing.getById` via `select('*')`, and both
 * dashboards read the request object) reported a fully-repaid loan as having
 * repaid nothing. It is now maintained on every repayment and every void.
 */
async function recomputeLoanPosition(sb, financing) {
  const { data: payments, error } = await sb
    .from('repayment_records')
    .select('amount_paid')
    .eq('financing_request_id', financing.id)
    .eq('voided', false)
    .limit(5000);
  if (error) throw error;

  const totalPaid = (payments || []).reduce((s, r) => {
    const n = Number(r.amount_paid);
    return Number.isFinite(n) && n > 0 ? s + n : s;
  }, 0);
  const rounded = Math.round(totalPaid * 100) / 100;
  // `loanPrincipal` is shared with the credit-score engine so "how much is
  // owed" cannot mean two different things in two places.
  const principal = loanPrincipal(financing);
  const outstanding = Math.max(0, Math.round((principal - rounded) * 100) / 100);

  return { totalPaid: rounded, principal, outstanding, paymentCount: (payments || []).length };
}

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { startDate, endDate, farmerId } = req.query;

  let q = sb.from('repayment_records').select(
    `*, farmers(id, full_name), financing_requests(id, loan_amount, cooperative_id, cooperatives(name))`,
    { count: 'exact' }
  );
  if (req.user.role === 'field_agent') q = q.eq('recorded_by_agent_id', req.user.userId);
  if (farmerId) q = q.eq('farmer_id', farmerId);
  if (startDate) q = q.gte('payment_date', startDate);
  if (endDate) q = q.lte('payment_date', endDate);
  q = q.order('payment_date', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function create(req, res) {
  const sb = supabaseAdmin();
  const body = req.body;

  // Fetch financing request — without the broken PostgREST embed.
  const { data: financing, error: fErr } = await sb
    .from('financing_requests')
    .select('*, cooperatives(name)')
    .eq('id', body.financingRequestId)
    .maybeSingle();
  if (fErr) {
    logger.error({ err: fErr.message, code: fErr.code, hint: fErr.hint, details: fErr.details }, 'financing_requests lookup failed');
    throw fErr;
  }
  if (!financing) {
    logger.warn({ financingRequestId: body.financingRequestId, agentId: req.user.userId }, 'repayment: financing_request not found by id');
    return fail(res, 404, 'NOT_FOUND', 'Financing request not found', {
      attemptedFinancingRequestId: body.financingRequestId,
      hint: 'Check the ID matches a row in financing_requests. If the row exists in the dashboard but this endpoint returns 404, confirm the API and dashboard point at the same Supabase project.',
    });
  }
  if (!REPAYABLE_STATUSES.includes(financing.status)) {
    return badRequest(res, `Cannot record repayment — financing request status is "${financing.status}". Repayments can only be recorded after the request is approved or disbursed.`, {
      financingRequestId: financing.id,
      currentStatus: financing.status,
      allowedStatuses: REPAYABLE_STATUSES,
    });
  }

  if (req.user.role === 'field_agent' && financing.submitted_by_agent_id !== req.user.userId) {
    return forbidden(res, 'You are not the submitting agent for this loan');
  }

  const { data: farmer, error: faErr } = await sb
    .from('farmers')
    .select('id, full_name, created_by_agent_id')
    .eq('id', body.farmerId)
    .maybeSingle();
  if (faErr) throw faErr;
  if (!farmer) {
    return fail(res, 404, 'NOT_FOUND', 'Farmer not found', { attemptedFarmerId: body.farmerId });
  }

  // FIXED — nothing checked that the farmer being credited was actually the
  // borrower on this loan, or that the agent is allowed to touch that farmer.
  // An agent could record farmer A's repayment against farmer B's loan, which
  // moved credit score between farmers (the score reads
  // `repayment_records.financing_request_id`, the notification reads
  // `farmer_id`) and corrupted both farmers' histories.
  if (req.user.role === 'field_agent' && farmer.created_by_agent_id !== req.user.userId) {
    return forbidden(res, 'That farmer was not onboarded by you');
  }
  if (financing.farmer_id && financing.farmer_id !== farmer.id) {
    return badRequest(res, 'That farmer is not the borrower on this financing request', {
      financingRequestId: financing.id,
      loanFarmerId: financing.farmer_id,
      submittedFarmerId: farmer.id,
    });
  }

  // FIXED — no idempotency at all. The mobile app retries on a dropped
  // connection (the common case in the field), and each retry inserted another
  // repayment_record. The duplicate counted twice toward `total_paid`, which
  // feeds the repayment-rate component of the credit score and can
  // auto-complete a loan that is not actually repaid. A payment reference
  // identifies one real transfer, so it must be unique per loan.
  if (body.referenceNumber) {
    const { data: dupe, error: dupeErr } = await sb
      .from('repayment_records')
      .select('id, amount_paid, payment_date')
      .eq('financing_request_id', body.financingRequestId)
      .eq('reference_number', body.referenceNumber)
      .eq('voided', false)
      .limit(1);
    if (dupeErr) throw dupeErr;
    if (dupe?.length) {
      return conflict(res, 'A repayment with this reference number is already recorded for this loan', {
        referenceNumber: body.referenceNumber,
        existingRepaymentId: dupe[0].id,
      });
    }
  }

  const { data, error } = await sb
    .from('repayment_records')
    .insert({
      financing_request_id: body.financingRequestId,
      farmer_id: body.farmerId,
      amount_paid: body.amountPaid,
      payment_date: body.paymentDate || new Date().toISOString().slice(0, 10),
      payment_method: body.paymentMethod,
      reference_number: body.referenceNumber,
      proof_photo_url: body.proofPhotoUrl,
      context_flag: body.contextFlag || 'none',
      context_notes: body.contextNotes,
      recorded_by_agent_id: req.user.userId,
    })
    .select()
    .single();
  if (error) {
    logger.error({ err: error.message, code: error.code, hint: error.hint, details: error.details }, 'repayment insert failed');
    throw error;
  }

  const position = await recomputeLoanPosition(sb, financing);

  // Cache the repaid total + auto-complete if paid in full.
  // FIXED — the old code wrapped the status update in `try/catch`, but
  // supabase-js RESOLVES with `{ error }` instead of throwing, so the catch
  // was unreachable and a failed "mark completed" was silently discarded. The
  // loan stayed `disbursed` forever while showing a zero balance.
  const patch = { total_repaid: position.totalPaid };
  let financingStatus = financing.status;
  if (position.outstanding <= 0 && position.principal > 0) {
    patch.status = 'completed';
    financingStatus = 'completed';
  }
  const { error: updErr } = await sb
    .from('financing_requests')
    .update(patch)
    .eq('id', body.financingRequestId);
  if (updErr) {
    logger.error(
      { err: updErr.message, code: updErr.code, details: updErr.details, financingRequestId: body.financingRequestId },
      'financing position update failed — total_repaid/status now stale'
    );
    financingStatus = financing.status;
  }

  // FIXED — was called without `await`. On Vercel the lambda freezes when the
  // response is written, so this recalculation was killed and the farmer's
  // score never reflected the repayment that had just been recorded.
  await safeRecalculateFarmer(body.farmerId, { triggerReason: 'repayment_recorded' });

  // Notify the submitting agent (two-step profile lookup — see utils/profiles).
  try {
    if (financing.submitted_by_agent_id) {
      const submitter = await getProfileFor(sb, financing.submitted_by_agent_id);

      const { error: notifyErr } = await sb.from('notifications').insert({
        user_id: financing.submitted_by_agent_id,
        type: 'repayment_recorded',
        title: 'Repayment recorded',
        message: `₦${Number(body.amountPaid).toLocaleString()} from ${farmer.full_name}`,
        metadata: {
          repaymentId: data.id,
          financingRequestId: body.financingRequestId,
          outstandingBalance: position.outstanding,
        },
      });
      if (notifyErr) throw notifyErr;

      if (submitter?.email) {
        const result = await email.safe(email.sendRepaymentRecorded)(submitter.email, {
          recipientName: submitter.full_name,
          farmerName: farmer.full_name,
          amount: body.amountPaid,
          outstandingBalance: position.outstanding,
        });
        if (result?.error) {
          logger.warn({ err: result.error, to: submitter.email }, 'repayment email rejected');
        }
      }
    }
  } catch (e) {
    logger.warn({ err: e.message, code: e.code }, 'repayment notification/email failed');
  }

  await logActivity({
    actor: req.user,
    action: 'repayment_recorded',
    entityType: 'repayment',
    entityId: data.id,
    metadata: { amount: body.amountPaid, financingRequestId: body.financingRequestId },
    req,
  });

  // Response shape unchanged. NOTE: `loanAmount` and `outstandingBalance` now
  // measure against the disbursed/approved principal rather than the requested
  // `loan_amount` — see `loanPrincipal` in the credit-score service. Same keys,
  // corrected values; listed under BREAKING in AUDIT_BACKEND.md.
  return created(res, {
    ...data,
    outstandingBalance: position.outstanding,
    totalPaid: position.totalPaid,
    loanAmount: position.principal,
    financingStatus,
  });
}

async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('repayment_records')
    .select(`*, farmers(id, full_name), financing_requests(id, loan_amount, cooperative_id, cooperatives(name))`)
    .eq('id', req.params.repaymentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res, 'Repayment not found');
  if (req.user.role === 'field_agent' && data.recorded_by_agent_id !== req.user.userId) {
    return forbidden(res);
  }
  return ok(res, data);
}

/**
 * POST /api/admin/repayments/:repaymentId/void  (admin only)
 * Reverses a mistaken/incorrect repayment WITHOUT deleting it (audit-safe).
 * Excludes it from the balance + score, then recomputes both. If the loan was
 * auto-completed and now has an outstanding balance again, it reverts to
 * 'disbursed'.
 */
async function voidRepayment(req, res) {
  const sb = supabaseAdmin();
  const { reason } = req.body;

  const { data: rec, error: readErr } = await sb
    .from('repayment_records')
    .select('*')
    .eq('id', req.params.repaymentId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!rec) return notFound(res, 'Repayment not found');
  if (rec.voided) return conflict(res, 'This repayment is already voided', { repaymentId: rec.id });

  // FIXED — the void write discarded its error, so a failed update still
  // reported `{ voided: true }` and went on to "recompute" a balance from
  // records that had not actually changed. Claimed conditionally so two
  // concurrent voids cannot both subtract the same amount.
  const { data: claimed, error: voidErr } = await sb
    .from('repayment_records')
    .update({
      voided: true,
      voided_at: new Date().toISOString(),
      voided_by_admin_id: req.user.userId,
      void_reason: reason || null,
    })
    .eq('id', rec.id)
    .eq('voided', false)
    .select('id');
  if (voidErr) throw voidErr;
  if (!claimed || claimed.length === 0) {
    return conflict(res, 'This repayment was voided by someone else a moment ago', { repaymentId: rec.id });
  }

  // Recompute outstanding from the remaining (active) repayments.
  const { data: financing, error: finErr } = await sb
    .from('financing_requests')
    .select('id, loan_amount, approved_amount, disbursed_amount, status')
    .eq('id', rec.financing_request_id)
    .maybeSingle();
  if (finErr) throw finErr;

  if (financing) {
    const position = await recomputeLoanPosition(sb, financing);
    const patch = { total_repaid: position.totalPaid };
    // If it was completed but now owes again, revert status to disbursed.
    if (financing.status === 'completed' && position.outstanding > 0) {
      patch.status = 'disbursed';
    }
    const { error: updErr } = await sb.from('financing_requests').update(patch).eq('id', financing.id);
    if (updErr) {
      logger.error(
        { err: updErr.message, code: updErr.code, financingRequestId: financing.id },
        'financing position update after void failed'
      );
    }
  }

  // Rescore the farmer (excludes voided automatically).
  // FIXED — was fire-and-forget, so voiding a repayment left the inflated
  // score in place: the correction was recorded but never applied.
  if (rec.farmer_id) await safeRecalculateFarmer(rec.farmer_id, { triggerReason: 'repayment_voided' });

  await logActivity({
    actor: req.user,
    action: 'repayment_voided',
    entityType: 'repayment',
    entityId: rec.id,
    metadata: { amount: rec.amount_paid, reason: reason || null },
    req,
  });

  return ok(res, { voided: true });
}

module.exports = { list, create, getById, voidRepayment };
