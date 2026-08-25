'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated, badRequest, fail } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer } = require('../services/credit-score');
const email = require('../services/email');
const logger = require('../utils/logger');

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { startDate, endDate } = req.query;

  let q = sb.from('repayment_records').select(
    `*, farmers(id, full_name), financing_requests(id, loan_amount, cooperative_id, cooperatives(name))`,
    { count: 'exact' }
  );
  if (req.user.role === 'field_agent') q = q.eq('recorded_by_agent_id', req.user.userId);
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
  if (!['disbursed', 'approved'].includes(financing.status)) {
    return badRequest(res, `Cannot record repayment — financing request status is "${financing.status}". Repayments can only be recorded after the request is approved or disbursed.`, {
      financingRequestId: financing.id,
      currentStatus: financing.status,
      allowedStatuses: ['approved', 'disbursed'],
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

  // Outstanding balance + auto-complete if paid in full.
  // Voided (reversed) repayments are excluded from the sum.
  const { data: payments } = await sb
    .from('repayment_records')
    .select('amount_paid')
    .eq('financing_request_id', body.financingRequestId)
    .eq('voided', false);
  const totalPaid = (payments || []).reduce((s, r) => s + Number(r.amount_paid || 0), 0);
  const loanAmount = Number(financing.loan_amount || 0);
  const outstanding = Math.max(0, loanAmount - totalPaid);
  if (outstanding <= 0) {
    try {
      await sb.from('financing_requests').update({ status: 'completed' }).eq('id', body.financingRequestId);
    } catch (e) { logger.warn({ err: e.message }, 'mark financing complete failed'); }
  }

  safeRecalculateFarmer(body.farmerId, { triggerReason: 'repayment_recorded' });

  // Two-step lookup for the submitting agent's profile.
  try {
    if (financing.submitted_by_agent_id) {
      const { data: submitter } = await sb
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', financing.submitted_by_agent_id)
        .maybeSingle();

      await sb.from('notifications').insert({
        user_id: financing.submitted_by_agent_id,
        type: 'repayment_recorded',
        title: 'Repayment recorded',
        message: `₦${Number(body.amountPaid).toLocaleString()} from ${farmer.full_name}`,
        metadata: { repaymentId: data.id, financingRequestId: body.financingRequestId, outstandingBalance: outstanding },
      });

      if (submitter?.email) {
        email.safe(email.sendRepaymentRecorded)(submitter.email, {
          recipientName: submitter.full_name,
          farmerName: farmer.full_name,
          amount: body.amountPaid,
          outstandingBalance: outstanding,
        });
      }
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'repayment notification/email failed');
  }

  try {
    await logActivity({ actor: req.user, action: 'repayment_recorded', entityType: 'repayment', entityId: data.id, req });
  } catch (e) {
    logger.warn({ err: e.message }, 'repayment activity log failed');
  }

  return created(res, {
    ...data,
    outstandingBalance: outstanding,
    totalPaid,
    loanAmount,
    financingStatus: outstanding <= 0 ? 'completed' : financing.status,
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

  const { data: rec } = await sb
    .from('repayment_records')
    .select('*')
    .eq('id', req.params.repaymentId)
    .maybeSingle();
  if (!rec) return notFound(res, 'Repayment not found');
  if (rec.voided) return badRequest(res, 'This repayment is already voided');

  await sb.from('repayment_records').update({
    voided: true,
    voided_at: new Date().toISOString(),
    voided_by_admin_id: req.user.userId,
    void_reason: reason || null,
  }).eq('id', rec.id);

  // Recompute outstanding from the remaining (active) repayments.
  const { data: financing } = await sb
    .from('financing_requests')
    .select('id, loan_amount, status')
    .eq('id', rec.financing_request_id)
    .maybeSingle();

  if (financing) {
    const { data: active } = await sb
      .from('repayment_records')
      .select('amount_paid')
      .eq('financing_request_id', financing.id)
      .eq('voided', false);
    const totalPaid = (active || []).reduce((s, r) => s + Number(r.amount_paid || 0), 0);
    const outstanding = Math.max(0, Number(financing.loan_amount || 0) - totalPaid);

    // If it was completed but now owes again, revert status to disbursed.
    if (financing.status === 'completed' && outstanding > 0) {
      await sb.from('financing_requests').update({ status: 'disbursed' }).eq('id', financing.id);
    }
  }

  // Rescore the farmer (excludes voided automatically).
  if (rec.farmer_id) safeRecalculateFarmer(rec.farmer_id, { triggerReason: 'repayment_voided' });

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
