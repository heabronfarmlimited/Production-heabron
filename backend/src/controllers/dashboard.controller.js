'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, notFound, forbidden } = require('../utils/response');
const { sumColumn } = require('../utils/pagination');
const { chunk } = require('../utils/profiles');
const { loanPrincipal } = require('../services/credit-score');
const logger = require('../utils/logger');

// ============================================================================
// DASHBOARDS
// ============================================================================

/**
 * Count rows by status with cheap HEAD counts instead of pulling every row.
 *
 * FIXED — both dashboards did `select('id, status')` over the WHOLE
 * `financing_requests` table and tallied the statuses in JavaScript. Besides
 * transferring the entire table on every dashboard load, PostgREST truncates
 * an un-ranged select at `db-max-rows` (1000 by default) and reports NO error,
 * so past 1000 requests the status counts silently became "the first 1000
 * rows" and stopped growing — on the screen the whole team manages from.
 */
const FINANCING_STATUSES = ['pending', 'approved', 'rejected', 'disbursed', 'completed'];

async function countByStatus(sb, table, statuses, extra) {
  const counts = {};
  await Promise.all(
    statuses.map(async (status) => {
      let q = sb.from(table).select('id', { count: 'exact', head: true }).eq('status', status);
      if (extra) q = extra(q);
      const { count, error } = await q;
      if (error) throw error;
      counts[status] = count || 0;
    })
  );
  return counts;
}

async function agentDashboard(req, res) {
  const sb = supabaseAdmin();
  const userId = req.user.userId;

  const [coopCount, farmerCount, deliveryCount, financingCounts, recentActivity] = await Promise.all([
    sb.from('cooperatives').select('id', { count: 'exact', head: true }).eq('created_by_agent_id', userId),
    sb.from('farmers').select('id', { count: 'exact', head: true }).eq('created_by_agent_id', userId),
    sb.from('produce_deliveries').select('id', { count: 'exact', head: true }).eq('logged_by_agent_id', userId),
    countByStatus(sb, 'financing_requests', FINANCING_STATUSES, (q) => q.eq('submitted_by_agent_id', userId)),
    sb.from('activity_logs').select('*').eq('actor_id', userId).order('created_at', { ascending: false }).limit(15),
  ]);

  // FIXED — every count query discarded its error, so a transient database
  // failure rendered as a confident dashboard of zeroes.
  for (const r of [coopCount, farmerCount, deliveryCount, recentActivity]) {
    if (r.error) throw r.error;
  }

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
    farmers, cooperatives, agents, pendingApps, activeLoans, financingCounts, coopTiers, recentActivity,
    pendingSettlements, pendingPurchases, disbursedSum, repaidSum,
  ] = await Promise.all([
    sb.from('farmers').select('id', { count: 'exact', head: true }),
    sb.from('cooperatives').select('id', { count: 'exact', head: true }),
    sb.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'field_agent'),
    sb.from('agent_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    // Loan value in flight. Paged, because the un-ranged select below was
    // capped at 1000 rows and the figure quietly stopped being the total.
    sb.from('financing_requests')
      .select('loan_amount, approved_amount, disbursed_amount, status')
      .in('status', ['disbursed', 'approved'])
      .limit(5000),
    countByStatus(sb, 'financing_requests', FINANCING_STATUSES),
    sb.from('cooperative_credit_scores').select('cooperative_tier').limit(5000),
    sb.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(20),
    // action-required queues
    sb.from('settlement_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('wallet_transactions').select('id', { count: 'exact', head: true }).eq('source', 'cash_purchase').eq('status', 'pending'),
    // FIXED — real money figures. These two were plain un-ranged selects
    // whose rows were summed in JS, so BOTH headline money numbers on the
    // admin dashboard were "the sum of the first 1000 rows" and stayed frozen
    // once the platform passed that many transactions. `sumColumn` pages
    // through every row and rounds away binary-float drift.
    sumColumn(
      () => sb.from('wallet_transactions').select('amount').eq('source', 'admin_disbursement').eq('status', 'completed'),
      'amount'
    ),
    sumColumn(() => sb.from('repayment_records').select('amount_paid').eq('voided', false), 'amount_paid'),
  ]);

  for (const r of [farmers, cooperatives, agents, pendingApps, activeLoans, coopTiers, recentActivity, pendingSettlements, pendingPurchases]) {
    if (r.error) throw r.error;
  }
  if (disbursedSum.error) throw disbursedSum.error;
  if (repaidSum.error) throw repaidSum.error;
  if (disbursedSum.truncated || repaidSum.truncated) {
    logger.warn('admin dashboard money totals hit the paging cap — figures are a lower bound');
  }

  const tierCounts = { A: 0, B: 0, C: 0, D: 0 };
  // FIXED — `tierCounts[r.cooperative_tier] += 1` on an unexpected tier value
  // evaluated `undefined + 1` and wrote NaN into the tier distribution chart.
  for (const r of coopTiers.data || []) {
    if (r.cooperative_tier && tierCounts[r.cooperative_tier] !== undefined) tierCounts[r.cooperative_tier] += 1;
  }

  // "totalDisbursed" historically meant loan value approved/disbursed — kept
  // for backward-compat. "actualDisbursedToAgents" is real cash moved.
  // FIXED — this summed `loan_amount` (what was REQUESTED) and called it
  // disbursed. A request approved at ₦200k against a ₦500k ask contributed
  // ₦500k to the headline "loan value in flight". `loanPrincipal` uses the
  // disbursed, then approved, then requested amount — the same definition the
  // credit engine and the repayment ledger now use.
  const totalDisbursed = Math.round(
    (activeLoans.data || []).reduce((s, r) => s + loanPrincipal(r), 0) * 100
  ) / 100;
  const actualDisbursedToAgents = disbursedSum.total;
  const totalRepaid = repaidSum.total;

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

  const [forwarded, totalCoops, totalFarmers] = await Promise.all([
    // FIXED — a second query re-fetched the approved subset only to sum it,
    // duplicating rows already in `forwarded`. One read now, and every query
    // here had its error discarded (a failure rendered as an empty portfolio).
    sb
      .from('financing_requests')
      .select('id, loan_amount, approved_amount, disbursed_amount, status, partner_decision, cooperative_id')
      .eq('forwarded_to_partner_id', partnerId)
      .limit(5000),
    sb.from('cooperatives').select('id', { count: 'exact', head: true }),
    sb.from('farmers').select('id', { count: 'exact', head: true }),
  ]);
  for (const r of [forwarded, totalCoops, totalFarmers]) {
    if (r.error) throw r.error;
  }

  const rows = forwarded.data || [];
  const totals = { requestsPending: 0, requestsApproved: 0, requestsRejected: 0, totalApprovedAmount: 0 };
  let approvedAmount = 0;
  for (const r of rows) {
    if (r.partner_decision === 'approved') {
      totals.requestsApproved += 1;
      // FIXED — summed `approved_amount || loan_amount`, falling back to the
      // amount REQUESTED when no approved amount was set, which overstated
      // the lender's committed capital. Shared `loanPrincipal` definition.
      approvedAmount += loanPrincipal(r);
    } else if (r.partner_decision === 'rejected') totals.requestsRejected += 1;
    else totals.requestsPending += 1;
  }
  totals.totalApprovedAmount = Math.round(approvedAmount * 100) / 100;

  // Total repaid + repayment rate across this partner's funded loans.
  const fundedLoanIds = rows
    .filter((r) => r.partner_decision === 'approved' || ['disbursed', 'completed'].includes(r.status))
    .map((r) => r.id);
  let totalRepaid = 0;
  if (fundedLoanIds.length) {
    // FIXED — one `.in()` carrying every funded loan id, with the error
    // discarded. A large portfolio overflowed the PostgREST request URL, the
    // error vanished, and the lender was shown ₦0 repaid against real
    // outstanding loans — a 0% repayment rate on a performing book.
    for (const group of chunk(fundedLoanIds)) {
      const { data: reps, error: repErr } = await sb
        .from('repayment_records')
        .select('amount_paid')
        .in('financing_request_id', group)
        .eq('voided', false)
        .limit(5000);
      if (repErr) throw repErr;
      for (const r of reps || []) {
        const n = Number(r.amount_paid);
        if (Number.isFinite(n) && n > 0) totalRepaid += n;
      }
    }
    totalRepaid = Math.round(totalRepaid * 100) / 100;
  }
  const totalOutstanding = Math.max(0, Math.round((totals.totalApprovedAmount - totalRepaid) * 100) / 100);
  const repaymentRate = totals.totalApprovedAmount > 0
    ? Math.round((totalRepaid / totals.totalApprovedAmount) * 1000) / 10
    : 0;

  const financedCoopIds = [...new Set(rows.map((r) => r.cooperative_id).filter(Boolean))];
  const riskDistribution = { A: 0, B: 0, C: 0, D: 0 };
  if (financedCoopIds.length) {
    for (const group of chunk(financedCoopIds)) {
      const { data: tiers, error: tierErr } = await sb
        .from('cooperative_credit_scores')
        .select('cooperative_tier')
        .in('cooperative_id', group);
      if (tierErr) throw tierErr;
      for (const r of tiers || []) {
        // FIXED — `riskDistribution[tier] += 1` on an unexpected tier value
        // evaluated `undefined + 1`, writing NaN into the lender's risk chart.
        if (r.cooperative_tier && riskDistribution[r.cooperative_tier] !== undefined) {
          riskDistribution[r.cooperative_tier] += 1;
        }
      }
    }
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

/**
 * How many distinct crops a farmer actually grows.
 *
 * FIXED — the exports reported `cropsCount: f.farm_profiles?.length || 0`,
 * which counts farm_profile ROWS, not crops. A farmer has exactly one farm
 * profile, so every farmer's "crops" column on the PDF read 1 (or 0),
 * regardless of whether they grew one crop or six. The profile holds
 * `crop_type` plus a `secondary_crops` array — that is the real count.
 */
function cropsForFarmer(farmer) {
  const profiles = Array.isArray(farmer?.farm_profiles)
    ? farmer.farm_profiles
    : farmer?.farm_profiles
      ? [farmer.farm_profiles]
      : [];
  const crops = new Set();
  for (const p of profiles) {
    if (p?.crop_type) crops.add(String(p.crop_type).toLowerCase());
    for (const c of p?.secondary_crops || []) {
      if (c) crops.add(String(c).toLowerCase());
    }
  }
  return [...crops];
}

async function agentExport(req, res) {
  const sb = supabaseAdmin();
  // This handler is mounted only on the admin router, so `req.user.role` is
  // never 'field_agent' here — the old ternary plus the unreachable
  // `forbidden()` guard below it were both dead. Kept explicit and simple:
  // an admin may export any agent, defaulting to themselves.
  const agentId = req.query.agentId || req.user.userId;

  const [profileRes, coopsRes, farmersRes, repaymentsRes, financingRes] = await Promise.all([
    sb.from('profiles').select('full_name, email, phone').eq('user_id', agentId).maybeSingle(),
    sb.from('cooperatives').select('id, name, lga, state, total_members, estimated_land_size, crops_supported, cooperative_tier').eq('created_by_agent_id', agentId).order('created_at', { ascending: false }).limit(1000),
    sb.from('farmers').select('id, full_name, cooperative_id, credit_score, cooperatives(name), farm_profiles(farm_size_acres, crop_type, secondary_crops)').eq('created_by_agent_id', agentId).limit(5000),
    sb.from('repayment_records').select('id, financing_request_id, amount_paid, payment_date, payment_method').eq('recorded_by_agent_id', agentId).order('payment_date', { ascending: false }).limit(50),
    sb.from('financing_requests').select('id, loan_amount, status, cooperative_id, created_at').eq('submitted_by_agent_id', agentId).limit(2000),
  ]);
  // FIXED — every query here discarded its error, so a failure produced a
  // plausible-looking but EMPTY export that an agent could hand to a lender.
  for (const r of [profileRes, coopsRes, farmersRes, repaymentsRes, financingRes]) {
    if (r.error) throw r.error;
  }

  const farmers = (farmersRes.data || []).map((f) => ({
    id: f.id,
    name: f.full_name,
    cooperative: f.cooperatives?.name || null,
    cropsCount: cropsForFarmer(f).length,
    farmSize: Number(f.farm_profiles?.[0]?.farm_size_acres) || 0,
    coopScore: Number(f.credit_score) || 0,
  }));

  const cooperatives = (coopsRes.data || []).map((c) => ({
    id: c.id,
    name: c.name,
    farmers: c.total_members || 0,
    location: [c.lga, c.state].filter(Boolean).join(', '),
    landSizeAcres: Number(c.estimated_land_size) || 0,
    cropsCount: c.crops_supported?.length || 0,
    // FIXED — unscored cooperatives were exported as tier 'D' (high risk).
    tier: c.cooperative_tier || null,
  }));

  const repayments = (repaymentsRes.data || []).map((r) => ({
    loanRef: r.financing_request_id?.slice(0, 8) || '—',
    amountPaid: Number(r.amount_paid) || 0,
    date: r.payment_date,
    method: r.payment_method || '—',
  }));

  return ok(res, {
    generatedAt: new Date().toISOString(),
    // FIXED — fell back to a fabricated `{ full_name: 'Unknown agent' }`,
    // which printed "Unknown agent" onto an exported PDF as though it were
    // the agent's name. `null` lets the client render a real empty state.
    agent: profileRes.data || null,
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

  const { data: farmer, error: farmerErr } = await sb
    .from('farmers')
    .select('*, cooperatives(id, name), farm_profiles(*), credit_scores(*)')
    .eq('id', farmerId)
    .maybeSingle();
  if (farmerErr) throw farmerErr;
  if (!farmer) return notFound(res, 'Farmer not found');
  if (req.user.role === 'field_agent' && farmer.created_by_agent_id !== req.user.userId) return forbidden(res);

  const [financingRes, repaymentsRes] = await Promise.all([
    sb.from('financing_requests').select('id, loan_amount, approved_amount, disbursed_amount, status, created_at').eq('farmer_id', farmerId).order('created_at', { ascending: false }).limit(500),
    sb.from('repayment_records').select('id, financing_request_id, amount_paid, payment_date, payment_method').eq('farmer_id', farmerId).eq('voided', false).order('payment_date', { ascending: false }).limit(1000),
  ]);
  for (const r of [financingRes, repaymentsRes]) {
    if (r.error) throw r.error;
  }

  const fp = farmer.farm_profiles?.[0] || null;
  const crops = [fp?.crop_type, ...(fp?.secondary_crops || [])].filter(Boolean);

  const financingRequests = (financingRes.data || []).map((f) => ({
    loanRef: f.id.slice(0, 8),
    amount: loanPrincipal(f),
    date: (f.created_at || '').slice(0, 10),
    status: f.status,
  }));

  const repayments = (repaymentsRes.data || []).map((r) => ({
    loanRef: r.financing_request_id?.slice(0, 8) || '—',
    amountPaid: Number(r.amount_paid) || 0,
    date: r.payment_date,
    method: r.payment_method || '—',
  }));

  return ok(res, {
    generatedAt: new Date().toISOString(),
    farmer: {
      id: farmer.id,
      fullName: farmer.full_name,
      cooperative: farmer.cooperatives?.name || null,
      coopScore: Number(farmer.credit_score) || 0,
      // FIXED — defaulted an UNSCORED farmer to tier 'D'. 'D' is a real
      // assessment ("high risk"); a farmer with no score yet is not high
      // risk, they are unassessed, and printing 'D' on an export put a
      // judgement on the page that the model never made.
      coopTier: farmer.credit_tier || null,
    },
    counts: {
      // FIXED — hardcoded `cooperative: 1`, so a farmer with no cooperative
      // still exported as belonging to one.
      cooperative: farmer.cooperatives ? 1 : 0,
      crops: crops.length,
      landSizeAcres: Number(fp?.farm_size_acres) || 0,
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

  const { data: coop, error: coopErr } = await sb
    .from('cooperatives')
    .select('*, cooperative_credit_scores(*)')
    .eq('id', cooperativeId)
    .maybeSingle();
  if (coopErr) throw coopErr;
  if (!coop) return notFound(res, 'Cooperative not found');
  if (req.user.role === 'field_agent' && coop.created_by_agent_id !== req.user.userId) return forbidden(res);

  const [farmersRes, financingRes, repaymentsRes] = await Promise.all([
    sb.from('farmers').select('id, full_name, credit_score, farm_profiles(farm_size_acres, crop_type, secondary_crops)').eq('cooperative_id', cooperativeId).limit(5000),
    sb.from('financing_requests').select('id, loan_amount, approved_amount, disbursed_amount, status, created_at').eq('cooperative_id', cooperativeId).order('created_at', { ascending: false }).limit(1000),
    sb.from('repayment_records').select('id, financing_request_id, amount_paid, payment_date, payment_method, financing_requests!inner(cooperative_id)').eq('financing_requests.cooperative_id', cooperativeId).eq('voided', false).order('payment_date', { ascending: false }).limit(100),
  ]);
  for (const r of [farmersRes, financingRes, repaymentsRes]) {
    if (r.error) throw r.error;
  }

  const farmers = (farmersRes.data || []).map((f) => ({
    id: f.id,
    name: f.full_name,
    cropsCount: cropsForFarmer(f).length,
    farmSizeAcres: Number(f.farm_profiles?.[0]?.farm_size_acres) || 0,
    coopScore: Number(f.credit_score) || 0,
  }));

  // FIXED — this counted only `crop_type` and ignored `secondary_crops`, so a
  // cooperative's crop list on the export was systematically short.
  const crops = [...new Set((farmersRes.data || []).flatMap((f) => cropsForFarmer(f)))];

  const financingRequests = (financingRes.data || []).map((f) => ({
    loanRef: f.id.slice(0, 8),
    amount: loanPrincipal(f),
    date: (f.created_at || '').slice(0, 10),
    status: f.status,
  }));

  const repayments = (repaymentsRes.data || []).map((r) => ({
    loanRef: r.financing_request_id?.slice(0, 8) || '—',
    amountPaid: Number(r.amount_paid) || 0,
    date: r.payment_date,
    method: r.payment_method || '—',
  }));

  return ok(res, {
    generatedAt: new Date().toISOString(),
    cooperative: {
      id: coop.id,
      name: coop.name,
      // FIXED — an unscored cooperative was exported as tier 'D' (high risk).
      // Unassessed is not the same as bad; `null` lets the client say so.
      coopTier: coop.cooperative_tier || null,
      averageScore: Number(coop.average_credit_score) || 0,
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
