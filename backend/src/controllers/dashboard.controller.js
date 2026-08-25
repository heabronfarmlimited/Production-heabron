'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, notFound, forbidden } = require('../utils/response');
const { ADMIN_ROLES } = require('../middleware/auth');

// ============================================================================
// DASHBOARDS
// ============================================================================

async function agentDashboard(req, res) {
  const sb = supabaseAdmin();
  const userId = req.user.userId;

  const [coopCount, farmerCount, deliveryCount, financingByStatus, recentActivity] = await Promise.all([
    sb.from('cooperatives').select('id', { count: 'exact', head: true }).eq('created_by_agent_id', userId),
    sb.from('farmers').select('id', { count: 'exact', head: true }).eq('created_by_agent_id', userId),
    sb.from('produce_deliveries').select('id', { count: 'exact', head: true }).eq('logged_by_agent_id', userId),
    sb.from('financing_requests').select('id, status').eq('submitted_by_agent_id', userId),
    sb.from('activity_logs').select('*').eq('actor_id', userId).order('created_at', { ascending: false }).limit(15),
  ]);

  const financingCounts = { pending: 0, approved: 0, rejected: 0, disbursed: 0, completed: 0 };
  for (const r of financingByStatus.data || []) financingCounts[r.status] = (financingCounts[r.status] || 0) + 1;

  return ok(res, {
    cooperatives: coopCount.count || 0,
    farmers: farmerCount.count || 0,
    deliveries: deliveryCount.count || 0,
    financing: financingCounts,
    recentActivity: recentActivity.data || [],
  });
}

async function adminDashboard(req, res) {
  const sb = supabaseAdmin();

  const [
    farmers, cooperatives, agents, pendingApps, activeLoans, financing, coopTiers, recentActivity,
    pendingSettlements, pendingPurchases, disbursements, repayments,
  ] = await Promise.all([
    sb.from('farmers').select('id', { count: 'exact', head: true }),
    sb.from('cooperatives').select('id', { count: 'exact', head: true }),
    sb.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'field_agent'),
    sb.from('agent_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('financing_requests').select('loan_amount, status').in('status', ['disbursed', 'approved']),
    sb.from('financing_requests').select('id, status'),
    sb.from('cooperative_credit_scores').select('cooperative_tier'),
    sb.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(20),
    // action-required queues
    sb.from('settlement_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('wallet_transactions').select('id', { count: 'exact', head: true }).eq('source', 'cash_purchase').eq('status', 'pending'),
    // real money figures
    sb.from('wallet_transactions').select('amount').eq('source', 'admin_disbursement').eq('status', 'completed'),
    sb.from('repayment_records').select('amount_paid').eq('voided', false),
  ]);

  const financingCounts = { pending: 0, approved: 0, rejected: 0, disbursed: 0, completed: 0 };
  for (const r of financing.data || []) financingCounts[r.status] = (financingCounts[r.status] || 0) + 1;

  const tierCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of coopTiers.data || []) if (r.cooperative_tier) tierCounts[r.cooperative_tier] += 1;

  // "totalDisbursed" historically meant loan value approved/disbursed — kept
  // for backward-compat. "actualDisbursedToAgents" is real cash moved.
  const totalDisbursed = (activeLoans.data || []).reduce((s, r) => s + Number(r.loan_amount || 0), 0);
  const actualDisbursedToAgents = (disbursements.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalRepaid = (repayments.data || []).reduce((s, r) => s + Number(r.amount_paid || 0), 0);

  return ok(res, {
    totals: {
      farmers: farmers.count || 0,
      cooperatives: cooperatives.count || 0,
      fieldAgents: agents.count || 0,
      pendingApplications: pendingApps.count || 0,
    },
    financing: financingCounts,
    totalDisbursed,
    cooperativeTierDistribution: tierCounts,
    recentActivity: recentActivity.data || [],
    // NEW — admin work queue (things waiting on an admin decision)
    actionRequired: {
      financingRequests: financingCounts.pending || 0,
      agentApplications: pendingApps.count || 0,
      settlements: pendingSettlements.count || 0,
      purchaseProofs: pendingPurchases.count || 0,
    },
    // NEW — real money-flow snapshot
    money: {
      loanValueInFlight: totalDisbursed,
      actualDisbursedToAgents,
      totalRepaid,
    },
  });
}

async function partnerDashboard(req, res) {
  const sb = supabaseAdmin();
  const partnerId = req.user.partnerId;

  const [forwarded, approved, totalCoops, totalFarmers] = await Promise.all([
    sb.from('financing_requests').select('id, loan_amount, approved_amount, status, partner_decision, cooperative_id').eq('forwarded_to_partner_id', partnerId),
    sb.from('financing_requests').select('loan_amount, approved_amount').eq('forwarded_to_partner_id', partnerId).eq('partner_decision', 'approved'),
    sb.from('cooperatives').select('id', { count: 'exact', head: true }),
    sb.from('farmers').select('id', { count: 'exact', head: true }),
  ]);

  const totals = { requestsPending: 0, requestsApproved: 0, requestsRejected: 0, totalApprovedAmount: 0 };
  for (const r of forwarded.data || []) {
    if (r.partner_decision === 'approved') totals.requestsApproved += 1;
    else if (r.partner_decision === 'rejected') totals.requestsRejected += 1;
    else totals.requestsPending += 1;
  }
  totals.totalApprovedAmount = (approved.data || []).reduce((s, r) => s + Number(r.approved_amount || r.loan_amount || 0), 0);

  // Total repaid + repayment rate across this partner's funded loans.
  const fundedLoanIds = (forwarded.data || [])
    .filter((r) => r.partner_decision === 'approved' || ['disbursed', 'completed'].includes(r.status))
    .map((r) => r.id);
  let totalRepaid = 0;
  if (fundedLoanIds.length) {
    const { data: reps } = await sb
      .from('repayment_records')
      .select('amount_paid')
      .in('financing_request_id', fundedLoanIds)
      .eq('voided', false);
    totalRepaid = (reps || []).reduce((s, r) => s + Number(r.amount_paid || 0), 0);
  }
  const totalOutstanding = Math.max(0, totals.totalApprovedAmount - totalRepaid);
  const repaymentRate = totals.totalApprovedAmount > 0
    ? Math.round((totalRepaid / totals.totalApprovedAmount) * 1000) / 10
    : 0;

  const financedCoopIds = [...new Set((forwarded.data || []).map((r) => r.cooperative_id))];
  let riskDistribution = { A: 0, B: 0, C: 0, D: 0 };
  if (financedCoopIds.length) {
    const { data: tiers } = await sb
      .from('cooperative_credit_scores')
      .select('cooperative_tier')
      .in('cooperative_id', financedCoopIds);
    for (const r of tiers || []) if (r.cooperative_tier) riskDistribution[r.cooperative_tier] += 1;
  }

  return ok(res, {
    totals: {
      ...totals,
      cooperativesInSystem: totalCoops.count || 0,
      farmersInSystem: totalFarmers.count || 0,
    },
    money: {
      totalLoaned: totals.totalApprovedAmount,
      totalRepaid,
      totalOutstanding,
      repaymentRate, // percentage, 1 decimal
    },
    riskDistribution,
  });
}

// ============================================================================
// PDF EXPORT DATA ENDPOINTS
// ----------------------------------------------------------------------------
// The frontend renders these to PDF (see the 3 screenshots: Agent / Farmer /
// Coop). The backend just returns the structured data. All exports include
// the same shape: { generatedAt, subject, counts, crops?, tables: {...} }.
//
// Authorization:
//   - Agent export: field_agent sees own data; admin can pass ?agentId=...
//   - Farmer export: field_agent only for farmers they created; admin any
//   - Cooperative export: field_agent only for coops they created; admin any
// ============================================================================

async function agentExport(req, res) {
  const sb = supabaseAdmin();
  const agentId = req.user.role === 'field_agent' ? req.user.userId : (req.query.agentId || req.user.userId);
  if (req.user.role === 'field_agent' && agentId !== req.user.userId) return forbidden(res);

  const [profileRes, coopsRes, farmersRes, repaymentsRes, financingRes] = await Promise.all([
    sb.from('profiles').select('full_name, email, phone').eq('user_id', agentId).maybeSingle(),
    sb.from('cooperatives').select('id, name, lga, state, total_members, estimated_land_size, crops_supported, cooperative_tier').eq('created_by_agent_id', agentId).order('created_at', { ascending: false }),
    sb.from('farmers').select('id, full_name, cooperative_id, credit_score, cooperatives(name), farm_profiles(farm_size_acres, crop_type)').eq('created_by_agent_id', agentId),
    sb.from('repayment_records').select('id, financing_request_id, amount_paid, payment_date, payment_method, financing_requests(id)').eq('recorded_by_agent_id', agentId).order('payment_date', { ascending: false }).limit(50),
    sb.from('financing_requests').select('id, loan_amount, status, cooperative_id, created_at').eq('submitted_by_agent_id', agentId),
  ]);

  const farmers = (farmersRes.data || []).map((f) => ({
    id: f.id,
    name: f.full_name,
    cooperative: f.cooperatives?.name || null,
    cropsCount: f.farm_profiles?.length || 0,
    farmSize: f.farm_profiles?.[0]?.farm_size_acres || 0,
    coopScore: f.credit_score || 0,
  }));

  const cooperatives = (coopsRes.data || []).map((c) => ({
    id: c.id,
    name: c.name,
    farmers: c.total_members || 0,
    location: [c.lga, c.state].filter(Boolean).join(', '),
    landSizeAcres: c.estimated_land_size || 0,
    cropsCount: c.crops_supported?.length || 0,
    tier: c.cooperative_tier || 'D',
  }));

  const repayments = (repaymentsRes.data || []).map((r) => ({
    loanRef: r.financing_request_id?.slice(0, 8) || '—',
    amountPaid: Number(r.amount_paid || 0),
    date: r.payment_date,
    method: r.payment_method || '—',
  }));

  return ok(res, {
    generatedAt: new Date().toISOString(),
    agent: profileRes.data || { full_name: 'Unknown agent' },
    counts: {
      cooperatives: cooperatives.length,
      farmers: farmers.length,
      repayments: repayments.length,
      financingRequests: (financingRes.data || []).length,
    },
    tables: {
      cooperatives,
      farmers,
      repayments,
    },
  });
}

async function farmerExport(req, res) {
  const sb = supabaseAdmin();
  const farmerId = req.params.farmerId;

  const { data: farmer } = await sb
    .from('farmers')
    .select('*, cooperatives(id, name), farm_profiles(*), credit_scores(*)')
    .eq('id', farmerId)
    .maybeSingle();
  if (!farmer) return notFound(res);
  if (req.user.role === 'field_agent' && farmer.created_by_agent_id !== req.user.userId) return forbidden(res);

  const [financingRes, repaymentsRes] = await Promise.all([
    sb.from('financing_requests').select('id, loan_amount, approved_amount, status, created_at').eq('farmer_id', farmerId).order('created_at', { ascending: false }),
    sb.from('repayment_records').select('id, financing_request_id, amount_paid, payment_date, payment_method').eq('farmer_id', farmerId).order('payment_date', { ascending: false }),
  ]);

  const fp = farmer.farm_profiles?.[0] || null;
  const crops = [fp?.crop_type, ...(fp?.secondary_crops || [])].filter(Boolean);

  const financingRequests = (financingRes.data || []).map((f) => ({
    loanRef: f.id.slice(0, 8),
    amount: Number(f.approved_amount || f.loan_amount || 0),
    date: (f.created_at || '').slice(0, 10),
    status: f.status,
  }));

  const repayments = (repaymentsRes.data || []).map((r) => ({
    loanRef: r.financing_request_id?.slice(0, 8) || '—',
    amountPaid: Number(r.amount_paid || 0),
    date: r.payment_date,
    method: r.payment_method || '—',
  }));

  return ok(res, {
    generatedAt: new Date().toISOString(),
    farmer: {
      id: farmer.id,
      fullName: farmer.full_name,
      cooperative: farmer.cooperatives?.name || null,
      coopScore: farmer.credit_score || 0,
      coopTier: farmer.credit_tier || 'D',
    },
    counts: {
      cooperative: 1,
      crops: crops.length,
      landSizeAcres: Number(fp?.farm_size_acres || 0),
    },
    crops,
    tables: {
      financingRequests,
      repayments,
    },
  });
}

async function cooperativeExport(req, res) {
  const sb = supabaseAdmin();
  const cooperativeId = req.params.cooperativeId;

  const { data: coop } = await sb
    .from('cooperatives')
    .select('*, cooperative_credit_scores(*)')
    .eq('id', cooperativeId)
    .maybeSingle();
  if (!coop) return notFound(res);
  if (req.user.role === 'field_agent' && coop.created_by_agent_id !== req.user.userId) return forbidden(res);

  const [farmersRes, financingRes, repaymentsRes] = await Promise.all([
    sb.from('farmers').select('id, full_name, credit_score, farm_profiles(farm_size_acres, crop_type)').eq('cooperative_id', cooperativeId),
    sb.from('financing_requests').select('id, loan_amount, approved_amount, status, created_at').eq('cooperative_id', cooperativeId).order('created_at', { ascending: false }),
    sb.from('repayment_records').select('id, financing_request_id, amount_paid, payment_date, payment_method, financing_requests!inner(cooperative_id)').eq('financing_requests.cooperative_id', cooperativeId).order('payment_date', { ascending: false }).limit(100),
  ]);

  const farmers = (farmersRes.data || []).map((f) => ({
    id: f.id,
    name: f.full_name,
    cropsCount: f.farm_profiles?.length || 0,
    farmSizeAcres: f.farm_profiles?.[0]?.farm_size_acres || 0,
    coopScore: f.credit_score || 0,
  }));

  const crops = [...new Set((farmersRes.data || []).flatMap((f) => (f.farm_profiles || []).map((p) => p.crop_type).filter(Boolean)))];

  const financingRequests = (financingRes.data || []).map((f) => ({
    loanRef: f.id.slice(0, 8),
    amount: Number(f.approved_amount || f.loan_amount || 0),
    date: (f.created_at || '').slice(0, 10),
    status: f.status,
  }));

  const repayments = (repaymentsRes.data || []).map((r) => ({
    loanRef: r.financing_request_id?.slice(0, 8) || '—',
    amountPaid: Number(r.amount_paid || 0),
    date: r.payment_date,
    method: r.payment_method || '—',
  }));

  return ok(res, {
    generatedAt: new Date().toISOString(),
    cooperative: {
      id: coop.id,
      name: coop.name,
      coopTier: coop.cooperative_tier || 'D',
      averageScore: coop.average_credit_score || 0,
    },
    counts: {
      farmers: farmers.length,
      crops: crops.length,
      repayments: repayments.length,
      financingRequests: financingRequests.length,
    },
    crops,
    tables: {
      farmers,
      financingRequests,
      repayments,
    },
  });
}

module.exports = {
  agentDashboard,
  adminDashboard,
  partnerDashboard,
  agentExport,
  farmerExport,
  cooperativeExport,
};
