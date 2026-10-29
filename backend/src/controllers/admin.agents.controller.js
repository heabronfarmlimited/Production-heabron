'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, paginated, notFound, badRequest, conflict } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const email = require('../services/email');
const { containsPattern } = require('../utils/search');
const logger = require('../utils/logger');

async function listApplications(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { status = 'pending', search } = req.query;
  let q = sb.from('agent_applications').select('*', { count: 'exact' });
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('full_name', containsPattern(search));
  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function getApplication(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('agent_applications')
    .select('*')
    .eq('id', req.params.applicationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res, 'Application not found');
  return ok(res, data);
}

async function decideApplication(req, res) {
  const sb = supabaseAdmin();
  const { decision, rejectionReason } = req.body;

  if (decision !== 'approve' && decision !== 'reject') {
    return badRequest(res, 'decision must be "approve" or "reject"');
  }

  const { data: app, error: readErr } = await sb
    .from('agent_applications')
    .select('*')
    .eq('id', req.params.applicationId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!app) return notFound(res, 'Application not found');

  // FIXED — no state guard. An application could be approved, then rejected,
  // then approved again, flipping the agent's `profiles.status` each time and
  // firing another "Application approved 🎉" email on every pass. An already
  // rejected applicant could also be approved with no record of the reversal.
  if (app.status !== 'pending') {
    return conflict(res, `This application has already been ${app.status}`, {
      applicationId: app.id,
      currentStatus: app.status,
    });
  }

  const approved = decision === 'approve';
  const reviewedAt = new Date().toISOString();
  // `agent_applications.status` uses 'active' for an approved application
  // (matching `user_status`), which is why this is not simply 'approved'.
  const appStatus = approved ? 'active' : 'rejected';

  // Claimed conditionally so two admins cannot both decide.
  const { data: claimed, error: claimErr } = await sb
    .from('agent_applications')
    .update({
      status: appStatus,
      rejection_reason: approved ? null : rejectionReason,
      reviewed_by: req.user.userId,
      reviewed_at: reviewedAt,
    })
    .eq('id', app.id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    return conflict(res, 'This application was decided by someone else a moment ago', { applicationId: app.id });
  }

  // FIXED — this write decided whether the agent can use the app at all, and
  // its error was discarded. A failure left the application marked approved
  // while the agent's profile stayed `pending`, so they were told they had
  // been approved and every request still answered
  // "Account is pending. Awaiting admin approval."
  const { error: profileErr } = await sb
    .from('profiles')
    .update({ status: approved ? 'active' : 'rejected' })
    .eq('user_id', app.user_id);
  if (profileErr) {
    await sb
      .from('agent_applications')
      .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
      .eq('id', app.id);
    logger.error(
      { err: profileErr.message, code: profileErr.code, userId: app.user_id },
      'agent profile status update failed — application returned to pending'
    );
    throw profileErr;
  }

  try {
    const { error: notifyErr } = await sb.from('notifications').insert({
      user_id: app.user_id,
      type: approved ? 'agent_approved' : 'agent_rejected',
      title: approved ? 'Application approved 🎉' : 'Application not approved',
      message: approved ? 'Your field agent account is now active.' : rejectionReason,
    });
    if (notifyErr) throw notifyErr;

    // FIXED — fire-and-forget: on Vercel the decision email was killed when
    // the response was written, so an approved agent was never told they
    // could sign in.
    const sender = approved ? email.sendAgentApproved : email.sendAgentRejected;
    const result = await email.safe(sender)(app.email, {
      fullName: app.full_name,
      reason: rejectionReason,
    });
    if (result?.error) logger.warn({ err: result.error, to: app.email }, 'agent decision email rejected');
  } catch (e) {
    logger.warn({ err: e.message, code: e.code }, 'agent decision notification failed');
  }

  await logActivity({ actor: req.user, action: `agent_${decision}d`, entityType: 'agent_application', entityId: app.id, req });
  return ok(res, { decision });
}

async function listAgents(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { status, search } = req.query;

  // Get every field_agent user_id. We do NOT embed profiles(*) here —
  // user_roles.user_id references auth.users, not profiles, so PostgREST
  // returns null profiles and the agent disappears from the page. Fetch the
  // ids, then load the profiles in a separate query.
  const { data: roleRows, error: roleErr } = await sb
    .from('user_roles')
    .select('user_id')
    .eq('role', 'field_agent');
  if (roleErr) throw roleErr;

  const ids = [...new Set((roleRows || []).map((r) => r.user_id).filter(Boolean))];
  if (ids.length === 0) return paginated(res, [], { page, pageSize, total: 0 });

  // NOTE (not fixed): past roughly 200 field agents this `.in()` list grows
  // long enough to risk the PostgREST URL limit. Paging agents properly needs
  // a join the current schema cannot express (user_roles -> auth.users, not
  // profiles). Flagged in AUDIT_BACKEND.md rather than papered over.
  let pq = sb.from('profiles').select('*', { count: 'exact' }).in('user_id', ids);
  if (status) pq = pq.eq('status', status);
  if (search) pq = pq.ilike('full_name', containsPattern(search));
  pq = pq.order('created_at', { ascending: false }).range(from, to);

  const { data: profiles, count, error } = await pq;
  if (error) throw error;

  return paginated(res, profiles || [], { page, pageSize, total: count || 0 });
}

async function getAgent(req, res) {
  const sb = supabaseAdmin();
  const { data: profile, error: profileErr } = await sb
    .from('profiles')
    .select('*')
    .eq('user_id', req.params.agentId)
    .maybeSingle();
  if (profileErr) throw profileErr;
  if (!profile) return notFound(res, 'Agent not found');

  const [coopCount, farmerCount, deliveryCount, financingCount] = await Promise.all([
    sb.from('cooperatives').select('id', { count: 'exact', head: true }).eq('created_by_agent_id', req.params.agentId),
    sb.from('farmers').select('id', { count: 'exact', head: true }).eq('created_by_agent_id', req.params.agentId),
    sb.from('produce_deliveries').select('id', { count: 'exact', head: true }).eq('logged_by_agent_id', req.params.agentId),
    sb.from('financing_requests').select('id', { count: 'exact', head: true }).eq('submitted_by_agent_id', req.params.agentId),
  ]);
  for (const r of [coopCount, farmerCount, deliveryCount, financingCount]) {
    if (r.error) throw r.error;
  }

  return ok(res, {
    profile,
    stats: {
      cooperatives: coopCount.count || 0,
      farmers: farmerCount.count || 0,
      deliveries: deliveryCount.count || 0,
      financingRequests: financingCount.count || 0,
    },
  });
}

async function suspendAgent(req, res) {
  const sb = supabaseAdmin();
  const { reason } = req.body;
  const { data: profile, error: readErr } = await sb
    .from('profiles')
    .select('email, full_name, status')
    .eq('user_id', req.params.agentId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!profile) return notFound(res, 'Agent not found');
  if (profile.status === 'suspended') {
    return conflict(res, 'This agent is already suspended', { agentId: req.params.agentId });
  }

  // FIXED — the suspension write discarded its error, so the endpoint
  // answered `{ suspended: true }` and emailed the agent that they had been
  // suspended while they in fact still had full access.
  const { error: updErr } = await sb
    .from('profiles')
    .update({ status: 'suspended' })
    .eq('user_id', req.params.agentId);
  if (updErr) throw updErr;

  // FIXED — fire-and-forget; the agent was never told why they lost access.
  if (profile.email) {
    const result = await email.safe(email.sendAgentSuspended)(profile.email, {
      fullName: profile.full_name,
      reason,
    });
    if (result?.error) logger.warn({ err: result.error, to: profile.email }, 'suspension email rejected');
  }

  await logActivity({ actor: req.user, action: 'agent_suspended', entityType: 'agent', entityId: req.params.agentId, metadata: { reason }, req });
  return ok(res, { suspended: true });
}

async function reactivateAgent(req, res) {
  const sb = supabaseAdmin();
  // FIXED — this did not check the user exists and discarded the update's
  // error, so `POST /agents/<any uuid>/reactivate` answered
  // `{ reactivated: true }` for a user id that had never existed. It also
  // reactivated a REJECTED applicant straight to 'active', bypassing the
  // application review the rejection represented.
  const { data: profile, error: readErr } = await sb
    .from('profiles')
    .select('status')
    .eq('user_id', req.params.agentId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!profile) return notFound(res, 'Agent not found');
  if (profile.status === 'active') {
    return conflict(res, 'This agent is already active', { agentId: req.params.agentId });
  }
  if (profile.status === 'rejected') {
    return conflict(
      res,
      'This agent was rejected at application review and cannot be reactivated. Decide their application instead.',
      { agentId: req.params.agentId, currentStatus: profile.status }
    );
  }

  const { error: updErr } = await sb
    .from('profiles')
    .update({ status: 'active' })
    .eq('user_id', req.params.agentId);
  if (updErr) throw updErr;

  await logActivity({ actor: req.user, action: 'agent_reactivated', entityType: 'agent', entityId: req.params.agentId, req });
  return ok(res, { reactivated: true });
}

module.exports = {
  listApplications,
  getApplication,
  decideApplication,
  listAgents,
  getAgent,
  suspendAgent,
  reactivateAgent,
};
