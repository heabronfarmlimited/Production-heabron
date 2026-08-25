'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, paginated, notFound, badRequest } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const email = require('../services/email');

async function listApplications(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const status = req.query.status || 'pending';
  const { data, count, error } = await sb
    .from('agent_applications')
    .select('*', { count: 'exact' })
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function getApplication(req, res) {
  const sb = supabaseAdmin();
  const { data } = await sb.from('agent_applications').select('*').eq('id', req.params.applicationId).maybeSingle();
  if (!data) return notFound(res);
  return ok(res, data);
}

async function decideApplication(req, res) {
  const sb = supabaseAdmin();
  const { decision, rejectionReason } = req.body;
  const { data: app } = await sb.from('agent_applications').select('*').eq('id', req.params.applicationId).maybeSingle();
  if (!app) return notFound(res);

  if (decision === 'approve') {
    await sb.from('agent_applications').update({
      status: 'active',
      reviewed_by: req.user.userId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', app.id);
    await sb.from('profiles').update({ status: 'active' }).eq('user_id', app.user_id);
    await sb.from('notifications').insert({
      user_id: app.user_id,
      type: 'agent_approved',
      title: 'Application approved 🎉',
      message: 'Your field agent account is now active.',
    });
    email.safe(email.sendAgentApproved)(app.email, { fullName: app.full_name });
  } else if (decision === 'reject') {
    await sb.from('agent_applications').update({
      status: 'rejected',
      rejection_reason: rejectionReason,
      reviewed_by: req.user.userId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', app.id);
    await sb.from('profiles').update({ status: 'rejected' }).eq('user_id', app.user_id);
    await sb.from('notifications').insert({
      user_id: app.user_id,
      type: 'agent_rejected',
      title: 'Application not approved',
      message: rejectionReason,
    });
    email.safe(email.sendAgentRejected)(app.email, { fullName: app.full_name, reason: rejectionReason });
  } else {
    return badRequest(res, 'decision must be "approve" or "reject"');
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

  let pq = sb.from('profiles').select('*', { count: 'exact' }).in('user_id', ids);
  if (status) pq = pq.eq('status', status);
  if (search) pq = pq.ilike('full_name', `%${search}%`);
  pq = pq.order('created_at', { ascending: false }).range(from, to);

  const { data: profiles, count, error } = await pq;
  if (error) throw error;

  return paginated(res, profiles || [], { page, pageSize, total: count || 0 });
}

async function getAgent(req, res) {
  const sb = supabaseAdmin();
  const { data: profile } = await sb.from('profiles').select('*').eq('user_id', req.params.agentId).maybeSingle();
  if (!profile) return notFound(res);

  const [coopCount, farmerCount, deliveryCount, financingCount] = await Promise.all([
    sb.from('cooperatives').select('id', { count: 'exact', head: true }).eq('created_by_agent_id', req.params.agentId),
    sb.from('farmers').select('id', { count: 'exact', head: true }).eq('created_by_agent_id', req.params.agentId),
    sb.from('produce_deliveries').select('id', { count: 'exact', head: true }).eq('logged_by_agent_id', req.params.agentId),
    sb.from('financing_requests').select('id', { count: 'exact', head: true }).eq('submitted_by_agent_id', req.params.agentId),
  ]);

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
  const { data: profile } = await sb.from('profiles').select('email, full_name').eq('user_id', req.params.agentId).maybeSingle();
  if (!profile) return notFound(res);

  await sb.from('profiles').update({ status: 'suspended' }).eq('user_id', req.params.agentId);
  email.safe(email.sendAgentSuspended)(profile.email, { fullName: profile.full_name, reason });
  await logActivity({ actor: req.user, action: 'agent_suspended', entityType: 'agent', entityId: req.params.agentId, metadata: { reason }, req });
  return ok(res, { suspended: true });
}

async function reactivateAgent(req, res) {
  const sb = supabaseAdmin();
  await sb.from('profiles').update({ status: 'active' }).eq('user_id', req.params.agentId);
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
