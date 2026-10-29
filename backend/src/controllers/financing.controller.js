'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated, badRequest, conflict } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { ADMIN_ROLES, PARTNER_ROLES } = require('../middleware/auth');
const { getProfileFor, getUsersWithRoles, getPartnerUsers } = require('../utils/profiles');
const email = require('../services/email');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Financing request state machine.
 *
 * FIXED — there was NO state machine. `adminDecide` applied whichever branch
 * the body asked for, regardless of where the request already was, so all of
 * these were possible and silent:
 *
 *   • rejected  → approved   (a refused loan resurrected)
 *   • completed → approved   (a fully repaid loan reopened, wiping the
 *                             repayment position the score depends on)
 *   • disbursed → disbursed  (DOUBLE DISBURSEMENT — `disbursed_at` reset,
 *                             `disbursed_amount` overwritten, and a second
 *                             "funds disbursed" email sent to the agent)
 *
 * Transitions are now declared once and enforced before anything is written.
 */
const ADMIN_TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['disbursed', 'rejected'],
  rejected: [],
  disbursed: [],
  completed: [],
};

/** A partner may only decide on a request that is still awaiting a decision. */
const PARTNER_DECIDABLE_STATUSES = ['pending', 'approved'];

function shapeRequest(input, agentId) {
  return {
    cooperative_id: input.cooperativeId,
    farmer_id: input.farmerId || null,
    loan_amount: input.loanAmount,
    purpose: input.purpose,
    season: input.season,
    repayment_window_days: input.repaymentWindowDays || 180,
    submitted_by_agent_id: agentId,
    status: 'pending',
  };
}

/** Cooperative name for a message, without assuming the join resolved. */
const coopName = (row) => row?.cooperatives?.name || 'the cooperative';

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { status, cooperativeId, farmerId } = req.query;

  let q = sb.from('financing_requests').select(
    `*, cooperatives(id, name, cooperative_tier, average_credit_score), farmers(id, full_name, credit_tier)`,
    { count: 'exact' }
  );

  if (req.user.role === 'field_agent') q = q.eq('submitted_by_agent_id', req.user.userId);
  if (PARTNER_ROLES.includes(req.user.role)) q = q.eq('forwarded_to_partner_id', req.user.partnerId);
  if (status) q = q.eq('status', status);
  if (cooperativeId) q = q.eq('cooperative_id', cooperativeId);
  if (farmerId) q = q.eq('farmer_id', farmerId);

  q = q.order('created_at', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('financing_requests')
    .select(`*, cooperatives(*), farmers(*), repayment_records(*)`)
    .eq('id', req.params.requestId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res, 'Financing request not found');

  if (req.user.role === 'field_agent' && data.submitted_by_agent_id !== req.user.userId) return forbidden(res);
  if (PARTNER_ROLES.includes(req.user.role) && data.forwarded_to_partner_id !== req.user.partnerId) return forbidden(res);
  return ok(res, data);
}

async function create(req, res) {
  const sb = supabaseAdmin();

  // verify cooperative ownership
  const { data: coop, error: coopErr } = await sb
    .from('cooperatives')
    .select('id, created_by_agent_id, name')
    .eq('id', req.body.cooperativeId)
    .maybeSingle();
  if (coopErr) throw coopErr;
  if (!coop) return notFound(res, 'Cooperative not found');
  if (req.user.role === 'field_agent' && coop.created_by_agent_id !== req.user.userId) return forbidden(res);

  // FIXED — `farmerId` was written straight through with no checks at all. An
  // agent who owned any cooperative could raise a loan naming ANY farmer in
  // the system, including another agent's. The loan then appeared in that
  // farmer's financing history and fed their credit score.
  let farmerName = null;
  if (req.body.farmerId) {
    const { data: farmer, error: farmerErr } = await sb
      .from('farmers')
      .select('id, full_name, cooperative_id, created_by_agent_id')
      .eq('id', req.body.farmerId)
      .maybeSingle();
    if (farmerErr) throw farmerErr;
    if (!farmer) return notFound(res, 'Farmer not found');
    if (req.user.role === 'field_agent' && farmer.created_by_agent_id !== req.user.userId) {
      return forbidden(res, 'That farmer was not onboarded by you');
    }
    if (farmer.cooperative_id !== coop.id) {
      return badRequest(res, 'That farmer is not a member of the selected cooperative', {
        farmerId: farmer.id,
        farmerCooperativeId: farmer.cooperative_id,
        requestedCooperativeId: coop.id,
      });
    }
    farmerName = farmer.full_name;
  }

  const row = shapeRequest(req.body, req.user.userId);
  const { data, error } = await sb.from('financing_requests').insert(row).select().single();
  if (error) throw error;

  // Notify admins.
  // FIXED — two bugs. (1) The query was
  // `user_roles.select('user_id, profiles(email, full_name)')`, but
  // `user_roles.user_id` references `auth.users`, not `profiles` — this very
  // repo documents that in two other controllers. PostgREST cannot infer the
  // relationship, so `a.profiles` was always null and NO admin was ever
  // emailed about a new financing request. (2) It filtered
  // `.eq('role','super_admin')`, so ops_admin and finance_admin were excluded
  // even once the join worked, unlike every other admin broadcast.
  try {
    const admins = await getUsersWithRoles(sb, ADMIN_ROLES);
    if (admins.length) {
      const { error: notifyErr } = await sb.from('notifications').insert(admins.map((a) => ({
        user_id: a.userId,
        type: 'financing_request_submitted',
        title: 'New financing request',
        message: `${coop.name} requested ₦${Number(row.loan_amount).toLocaleString()}`,
        metadata: { financingRequestId: data.id },
      })));
      if (notifyErr) throw notifyErr;

      await Promise.all(
        admins.map(async (a) => {
          if (!a.profile?.email) return;
          const result = await email.safe(email.sendFinancingSubmittedToAdmin)(a.profile.email, {
            adminName: a.profile.full_name,
            cooperativeName: coop.name,
            farmerName,
            amount: row.loan_amount,
            agentName: req.user.fullName,
          });
          if (result?.error) logger.warn({ err: result.error, to: a.profile.email }, 'financing submitted email rejected');
        })
      );
    }
  } catch (e) {
    logger.warn({ err: e.message, code: e.code }, 'financing submitted admin notification failed');
  }

  await logActivity({ actor: req.user, action: 'financing_request_submitted', entityType: 'financing_request', entityId: data.id, req });
  return created(res, data);
}

// ============================================================================
// ADMIN — decide on a financing request
// Body: { decision: 'approved'|'rejected'|'disbursed', approvedAmount?, dueDate?, rejectionReason?, forwardToPartnerId?, adminComments? }
// ============================================================================
async function adminDecide(req, res) {
  const sb = supabaseAdmin();
  const { decision, approvedAmount, dueDate, rejectionReason, forwardToPartnerId, adminComments,
    disbursementAccountDetails, disbursementReference, disbursementProofUrls } = req.body;

  // NOTE: do NOT embed profiles:submitted_by_agent_id here.
  // financing_requests.submitted_by_agent_id references auth.users(id), not
  // profiles(user_id). PostgREST can't resolve that join — it returns null
  // for the row (or a relationship error), and the request silently 404s.
  // Fetch the row first, then resolve the agent's profile in a second query.
  const { data: existing, error: fetchErr } = await sb
    .from('financing_requests')
    .select('*, cooperatives(id, name, cooperative_tier), farmers(id, full_name, phone)')
    .eq('id', req.params.requestId)
    .maybeSingle();
  if (fetchErr) {
    logger.error({ err: fetchErr.message, code: fetchErr.code, hint: fetchErr.hint, details: fetchErr.details, requestId: req.params.requestId }, 'admin financing decide fetch failed');
    throw fetchErr;
  }
  if (!existing) return notFound(res, 'Financing request not found', { attemptedId: req.params.requestId });

  // Enforce the state machine BEFORE any write or notification.
  const allowed = ADMIN_TRANSITIONS[existing.status] || [];
  if (!allowed.includes(decision)) {
    return conflict(
      res,
      `A request that is "${existing.status}" cannot be moved to "${decision}"`,
      { financingRequestId: existing.id, currentStatus: existing.status, allowedTransitions: allowed }
    );
  }

  // Resolve the submitting agent's profile (email + name) for notifications.
  const agentProfile = await getProfileFor(sb, existing.submitted_by_agent_id);
  // `existing` is a row this request just fetched into a local, so nothing else
  // can observe it between the await and this assignment.
  // eslint-disable-next-line require-atomic-updates
  existing.profiles = agentProfile || null;

  const name = coopName(existing);
  let patch;

  if (decision === 'rejected') {
    patch = {
      status: 'rejected',
      rejection_reason: rejectionReason,
      admin_comments: adminComments,
      reviewed_by_admin_id: req.user.userId,
    };
  } else if (decision === 'approved') {
    patch = {
      status: 'approved',
      approved_amount: approvedAmount || existing.loan_amount,
      due_date: dueDate || null,
      admin_comments: adminComments,
      reviewed_by_admin_id: req.user.userId,
    };
    // Admin attaches the recipient bank account to the request (provided by
    // the field agent/farmer) before matching it to a partner.
    if (disbursementAccountDetails !== undefined) patch.disbursement_account_details = disbursementAccountDetails;
    if (forwardToPartnerId) {
      // FIXED — the partner id was written with no check that the partner
      // exists or is active, so a typo forwarded the request into a void: it
      // left the admin queue, no partner could see it, and nobody was told.
      const { data: partner, error: partnerErr } = await sb
        .from('partners')
        .select('id, organization_name, status')
        .eq('id', forwardToPartnerId)
        .maybeSingle();
      if (partnerErr) throw partnerErr;
      if (!partner) return notFound(res, 'Partner organization not found', { attemptedPartnerId: forwardToPartnerId });
      if (partner.status === 'suspended') {
        return badRequest(res, `Partner "${partner.organization_name}" is suspended and cannot receive requests`);
      }
      patch.forwarded_to_partner_id = partner.id;
      patch.forwarded_at = new Date().toISOString();
    }
  } else {
    // decision === 'disbursed'
    patch = {
      status: 'disbursed',
      disbursed_amount: approvedAmount || existing.approved_amount || existing.loan_amount,
      disbursed_at: new Date().toISOString(),
      due_date: dueDate || existing.due_date,
      reviewed_by_admin_id: req.user.userId,
      // Manual transfer evidence
      disbursement_account_details: disbursementAccountDetails ?? existing.disbursement_account_details,
      disbursement_reference: disbursementReference ?? existing.disbursement_reference,
      disbursement_proof_urls: disbursementProofUrls ?? existing.disbursement_proof_urls,
    };
    if (adminComments !== undefined) patch.admin_comments = adminComments;
  }

  // FIXED — every one of these updates discarded its `error`. A failed write
  // still emailed the agent "your financing was approved/disbursed" and the
  // endpoint returned 200 with the unchanged row. The update is also guarded
  // on the status we validated against, so two admins deciding at the same
  // moment cannot both apply a transition.
  const { data: claimed, error: updErr } = await sb
    .from('financing_requests')
    .update(patch)
    .eq('id', existing.id)
    .eq('status', existing.status)
    .select('id');
  if (updErr) {
    logger.error(
      { err: updErr.message, code: updErr.code, details: updErr.details, requestId: existing.id, decision },
      'financing decision update failed'
    );
    throw updErr;
  }
  if (!claimed || claimed.length === 0) {
    return conflict(res, 'This request was decided by someone else a moment ago', {
      financingRequestId: existing.id,
    });
  }

  // ─── notifications (never block the decision that is already committed) ───
  try {
    if (decision === 'rejected') {
      if (existing.profiles?.email) {
        const r = await email.safe(email.sendFinancingRejected)(existing.profiles.email, {
          recipientName: existing.profiles.full_name,
          cooperativeName: name,
          amount: existing.loan_amount,
          reason: rejectionReason,
        });
        if (r?.error) logger.warn({ err: r.error }, 'financing rejected email rejected');
      }
      await sb.from('notifications').insert({
        user_id: existing.submitted_by_agent_id,
        type: 'financing_rejected',
        title: 'Financing rejected',
        message: `Request for ${name} was rejected${rejectionReason ? `: ${rejectionReason}` : ''}`,
        metadata: { financingRequestId: existing.id },
      });
    } else if (decision === 'approved') {
      if (existing.profiles?.email) {
        const r = await email.safe(email.sendFinancingApproved)(existing.profiles.email, {
          recipientName: existing.profiles.full_name,
          cooperativeName: name,
          amount: patch.approved_amount,
          dueDate: patch.due_date,
        });
        if (r?.error) logger.warn({ err: r.error }, 'financing approved email rejected');
      }
      await sb.from('notifications').insert({
        user_id: existing.submitted_by_agent_id,
        type: 'financing_approved',
        title: 'Financing approved',
        message: `Request for ${name} was approved`,
        metadata: { financingRequestId: existing.id },
      });

      // Notify partner seats if forwarded.
      // FIXED — same broken `profiles(...)` embed as `create`, so a forwarded
      // request never reached the partner by email either; and the in-app
      // notification was nested INSIDE `if (pu.profiles?.email)`, so a partner
      // seat with no email address got no notification at all.
      if (patch.forwarded_to_partner_id) {
        const partnerUsers = await getPartnerUsers(sb, patch.forwarded_to_partner_id);
        const { data: partner, error: partnerErr } = await sb
          .from('partners')
          .select('organization_name')
          .eq('id', patch.forwarded_to_partner_id)
          .maybeSingle();
        if (partnerErr) throw partnerErr;

        if (partnerUsers.length) {
          await sb.from('notifications').insert(partnerUsers.map((pu) => ({
            user_id: pu.userId,
            type: 'financing_approved',
            title: 'New financing request from CoopScore',
            message: `${name} — ₦${Number(patch.approved_amount).toLocaleString()}`,
            metadata: { financingRequestId: existing.id },
          })));
        }
        await Promise.all(
          partnerUsers.map(async (pu) => {
            if (!pu.profile?.email) return;
            const r = await email.safe(email.sendFinancingForwardedToPartner)(pu.profile.email, {
              partnerName: partner?.organization_name,
              cooperativeName: name,
              amount: patch.approved_amount,
              cooperativeTier: existing.cooperatives?.cooperative_tier,
              dashboardUrl: `${config.publicAppUrl}/partner/financing/${existing.id}`,
            });
            if (r?.error) logger.warn({ err: r.error, to: pu.profile.email }, 'financing forwarded email rejected');
          })
        );
      }
    } else {
      if (existing.profiles?.email) {
        const r = await email.safe(email.sendFinancingDisbursed)(existing.profiles.email, {
          recipientName: existing.profiles.full_name,
          cooperativeName: name,
          amount: patch.disbursed_amount,
          dueDate: patch.due_date,
          reference: patch.disbursement_reference,
        });
        if (r?.error) logger.warn({ err: r.error }, 'financing disbursed email rejected');
      }
      await sb.from('notifications').insert({
        user_id: existing.submitted_by_agent_id,
        type: 'financing_disbursed',
        title: 'Financing disbursed',
        message: `Disbursement recorded for ${name}`,
        metadata: { financingRequestId: existing.id },
      });
    }
  } catch (e) {
    logger.warn({ err: e.message, code: e.code, decision }, 'financing decision notification failed');
  }

  await logActivity({ actor: req.user, action: `financing_${decision}`, entityType: 'financing_request', entityId: existing.id, req });
  const { data: updated, error: reReadErr } = await sb
    .from('financing_requests')
    .select('*')
    .eq('id', existing.id)
    .maybeSingle();
  if (reReadErr) throw reReadErr;
  return ok(res, updated);
}

// ============================================================================
// PARTNER — decide on a forwarded financing request
// ============================================================================
async function partnerDecide(req, res) {
  const sb = supabaseAdmin();
  const { decision, approvedAmount, partnerComments, rejectionReason } = req.body;

  const { data: existing, error: readErr } = await sb
    .from('financing_requests')
    .select(`*, cooperatives(name)`)
    .eq('id', req.params.requestId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) return notFound(res, 'Financing request not found');
  if (existing.forwarded_to_partner_id !== req.user.partnerId) return forbidden(res, 'Not forwarded to your organization');

  // FIXED — there was no guard on `partner_decision`, so a partner could flip
  // their decision from approved to rejected and back indefinitely, each pass
  // re-notifying and re-emailing every admin and the agent. A partner could
  // also "approve" a request an admin had already REJECTED, or one already
  // disbursed/completed, because only the `status` write was conditional — the
  // `partner_decision` column was overwritten regardless.
  if (existing.partner_decision) {
    return conflict(res, `Your organization has already ${existing.partner_decision} this request`, {
      financingRequestId: existing.id,
      partnerDecision: existing.partner_decision,
      decidedAt: existing.partner_decision_at,
    });
  }
  if (!PARTNER_DECIDABLE_STATUSES.includes(existing.status)) {
    return conflict(res, `This request is "${existing.status}" and is no longer open for a partner decision`, {
      financingRequestId: existing.id,
      currentStatus: existing.status,
    });
  }

  const name = coopName(existing);
  const patch = {
    partner_decision: decision,
    partner_decision_at: new Date().toISOString(),
    partner_comments: partnerComments,
  };
  if (decision === 'approved') {
    patch.approved_amount = approvedAmount || existing.approved_amount || existing.loan_amount;
    // Promote the request status from 'pending' to 'approved' so the agent's
    // app and the admin's queue both reflect the partner's decision. The admin
    // then moves it to 'disbursed' (with manual receipt).
    patch.status = 'approved';
  } else {
    patch.rejection_reason = rejectionReason;
    patch.status = 'rejected';
  }

  const { data: claimed, error: updErr } = await sb
    .from('financing_requests')
    .update(patch)
    .eq('id', existing.id)
    .is('partner_decision', null)
    .select('id');
  if (updErr) throw updErr;
  if (!claimed || claimed.length === 0) {
    return conflict(res, 'This request was decided by a colleague a moment ago', {
      financingRequestId: existing.id,
    });
  }

  try {
    // Notify ALL admins of the partner's decision (same broken embed as above).
    const admins = await getUsersWithRoles(sb, ADMIN_ROLES);
    const { data: partnerOrg, error: orgErr } = await sb
      .from('partners')
      .select('organization_name')
      .eq('id', existing.forwarded_to_partner_id)
      .maybeSingle();
    if (orgErr) throw orgErr;
    const partnerName = partnerOrg?.organization_name || 'Partner';

    if (admins.length) {
      await sb.from('notifications').insert(admins.map((a) => ({
        user_id: a.userId,
        type: decision === 'approved' ? 'financing_approved' : 'financing_rejected',
        title: `Partner ${decision}`,
        message: `${partnerName} ${decision} request for ${name}`,
        metadata: { financingRequestId: existing.id },
      })));

      await Promise.all(
        admins.map(async (a) => {
          if (!a.profile?.email) return;
          const r = await email.safe(email.sendPartnerDecisionToAdmin)(a.profile.email, {
            adminName: a.profile.full_name,
            partnerName,
            cooperativeName: name,
            amount: existing.loan_amount,
            decision,
            approvedAmount: patch.approved_amount,
            comments: partnerComments,
          });
          if (r?.error) logger.warn({ err: r.error, to: a.profile.email }, 'partner decision email rejected');
        })
      );
    }

    // Also notify the submitting field agent so they see the decision instantly
    if (existing.submitted_by_agent_id) {
      await sb.from('notifications').insert({
        user_id: existing.submitted_by_agent_id,
        type: decision === 'approved' ? 'financing_approved' : 'financing_rejected',
        title: decision === 'approved' ? 'Loan approved by partner' : 'Loan rejected by partner',
        message:
          decision === 'approved'
            ? `Your request for ${name} was approved — awaiting disbursement`
            : `Your request for ${name} was rejected${rejectionReason ? `: ${rejectionReason}` : ''}`,
        metadata: { financingRequestId: existing.id },
      });
    }
  } catch (e) {
    logger.warn({ err: e.message, code: e.code }, 'partner decision notification failed');
  }

  await logActivity({ actor: req.user, action: `partner_financing_${decision}`, entityType: 'financing_request', entityId: existing.id, req });
  const { data: updated, error: reReadErr } = await sb
    .from('financing_requests')
    .select('*')
    .eq('id', existing.id)
    .maybeSingle();
  if (reReadErr) throw reReadErr;
  return ok(res, updated);
}

module.exports = { list, getById, create, adminDecide, partnerDecide };
