'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, paginated, forbidden } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { shapeFarmers } = require('../utils/shapeFarmer');
const logger = require('../utils/logger');

function riskLevel(score) {
  if (score == null) return 'unknown';
  if (score >= 80) return 'low';
  if (score >= 65) return 'moderate';
  return 'high';
}

/**
 * Build the set of cooperative + farmer IDs that have been forwarded to
 * (or financed by) this partner. The partner can only see these.
 *
 * Returns: { coopIds: Set<string>, farmerIds: Set<string> }
 */
async function partnerScopedIds(sb, partnerId) {
  const { data: financings } = await sb
    .from('financing_requests')
    .select('cooperative_id, farmer_id')
    .eq('forwarded_to_partner_id', partnerId);
  const coopIds = new Set();
  const farmerIds = new Set();
  for (const r of financings || []) {
    if (r.cooperative_id) coopIds.add(r.cooperative_id);
    if (r.farmer_id) farmerIds.add(r.farmer_id);
  }
  return { coopIds, farmerIds };
}

/**
 * Partner-scoped search.
 *
 * The partner only sees cooperatives and farmers that have been **forwarded
 * to (or financed by) their organisation**. This is a deliberate security
 * boundary — the credit data in this system is sensitive, and partners
 * should not be able to browse the full farmer/cooperative population.
 *
 * Admin onboarding is the gating step: a partner sees nothing until an
 * admin has forwarded at least one financing request to them.
 */
async function search(req, res) {
  const sb = supabaseAdmin();
  const q = (req.query.q || '').trim();
  const type = req.query.type || 'all';
  const partnerId = req.user.partnerId;
  if (!partnerId) return forbidden(res, 'Partner ID missing on user');

  if (!q) return ok(res, { cooperatives: [], farmers: [] });

  const { coopIds, farmerIds } = await partnerScopedIds(sb, partnerId);
  if (coopIds.size === 0 && farmerIds.size === 0) {
    return ok(res, { cooperatives: [], farmers: [] });
  }

  const out = { cooperatives: [], farmers: [] };

  if ((type === 'all' || type === 'cooperative') && coopIds.size > 0) {
    const { data: coops } = await sb
      .from('cooperatives')
      .select(`id, name, state, lga, total_members, cooperative_credit_scores(average_score, cooperative_tier)`)
      .in('id', [...coopIds])
      .ilike('name', `%${q}%`)
      .limit(20);
    out.cooperatives = (coops || []).map((c) => {
      const s = Array.isArray(c.cooperative_credit_scores) ? c.cooperative_credit_scores[0] : c.cooperative_credit_scores;
      return {
        id: c.id,
        name: c.name,
        location: [c.lga, c.state].filter(Boolean).join(', '),
        members: c.total_members,
        score: s?.average_score ?? null,
        tier: s?.cooperative_tier ?? null,
        risk: riskLevel(s?.average_score),
      };
    });
  }

  if (type === 'all' || type === 'farmer') {
    // Farmers visible to this partner are: (a) explicitly named in a
    // forwarded financing request, or (b) members of a forwarded cooperative.
    const visibleFarmerIds = new Set(farmerIds);
    if (coopIds.size > 0) {
      const { data: members } = await sb
        .from('farmers')
        .select('id')
        .in('cooperative_id', [...coopIds]);
      for (const m of members || []) visibleFarmerIds.add(m.id);
    }
    if (visibleFarmerIds.size > 0) {
      const { data: farmers } = await sb
        .from('farmers')
        .select(`id, full_name, state, lga, credit_score, credit_tier, cooperatives(name)`)
        .in('id', [...visibleFarmerIds])
        .ilike('full_name', `%${q}%`)
        .limit(20);
      out.farmers = (farmers || []).map((f) => ({
        id: f.id,
        name: f.full_name,
        cooperative: f.cooperatives?.name,
        location: [f.lga, f.state].filter(Boolean).join(', '),
        score: f.credit_score,
        tier: f.credit_tier,
        risk: riskLevel(f.credit_score),
      }));
    }
  }

  return ok(res, out);
}

/**
 * Portfolio monitoring: every cooperative this partner has been forwarded.
 */
async function portfolio(req, res) {
  const sb = supabaseAdmin();
  const partnerId = req.user.partnerId;

  const { data: financings } = await sb
    .from('financing_requests')
    .select(`*, cooperatives(id, name, state, lga, cooperative_credit_scores(*))`)
    .eq('forwarded_to_partner_id', partnerId);

  const byCoop = new Map();
  for (const f of financings || []) {
    const c = f.cooperatives;
    if (!c) continue;
    if (!byCoop.has(c.id)) {
      byCoop.set(c.id, {
        cooperativeId: c.id,
        name: c.name,
        state: c.state,
        lga: c.lga,
        averageScore: Array.isArray(c.cooperative_credit_scores) ? c.cooperative_credit_scores[0]?.average_score : c.cooperative_credit_scores?.average_score,
        tier: Array.isArray(c.cooperative_credit_scores) ? c.cooperative_credit_scores[0]?.cooperative_tier : c.cooperative_credit_scores?.cooperative_tier,
        totalApproved: 0,
        totalDisbursed: 0,
        loanCount: 0,
      });
    }
    const row = byCoop.get(c.id);
    row.loanCount += 1;
    if (f.partner_decision === 'approved' || f.status === 'disbursed' || f.status === 'completed') {
      row.totalApproved += Number(f.approved_amount || f.loan_amount || 0);
    }
    row.totalDisbursed += Number(f.disbursed_amount || 0);
  }

  const tierDist = { A: 0, B: 0, C: 0, D: 0 };
  const stateDist = {};
  let totalAmount = 0;
  for (const v of byCoop.values()) {
    if (v.tier) tierDist[v.tier] += 1;
    if (v.state) stateDist[v.state] = (stateDist[v.state] || 0) + v.totalApproved;
    totalAmount += v.totalApproved;
  }

  return ok(res, {
    cooperatives: Array.from(byCoop.values()),
    summary: {
      totalCooperatives: byCoop.size,
      totalAmountFinanced: totalAmount,
      averageScore:
        byCoop.size > 0
          ? Array.from(byCoop.values()).reduce((s, v) => s + Number(v.averageScore || 0), 0) / byCoop.size
          : 0,
    },
    riskDistribution: tierDist,
    geographicDistribution: stateDist,
  });
}

async function watchlist(req, res) {
  const sb = supabaseAdmin();
  const partnerId = req.user.partnerId;
  const { coopIds } = await partnerScopedIds(sb, partnerId);
  if (coopIds.size === 0) return ok(res, []);

  const { data } = await sb
    .from('cooperative_credit_scores')
    .select(`*, cooperatives(id, name, state, lga)`)
    .in('cooperative_id', [...coopIds])
    .in('cooperative_tier', ['C', 'D'])
    .order('average_score', { ascending: true });
  return ok(res, data || []);
}

/**
 * GET /api/partner/organization
 * Returns the partner organisation linked to the logged-in partner user.
 */
async function getMyOrganization(req, res) {
  const sb = supabaseAdmin();
  const partnerId = req.user.partnerId;
  if (!partnerId) return forbidden(res, 'Partner ID missing on user');

  const { data: partner } = await sb.from('partners').select('*').eq('id', partnerId).maybeSingle();
  if (!partner) return ok(res, null);

  // Count linked seats + financing activity for the profile header
  const [{ count: userCount }, financing] = await Promise.all([
    sb.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('partner_id', partnerId),
    sb.from('financing_requests').select('id, partner_decision, loan_amount').eq('forwarded_to_partner_id', partnerId),
  ]);
  const totals = { pending: 0, approved: 0, rejected: 0, totalAmount: 0 };
  for (const r of financing.data || []) {
    if (r.partner_decision === 'approved') { totals.approved += 1; totals.totalAmount += Number(r.loan_amount || 0); }
    else if (r.partner_decision === 'rejected') totals.rejected += 1;
    else totals.pending += 1;
  }

  return ok(res, { ...partner, stats: { users: userCount || 0, financing: totals } });
}

/**
 * PATCH /api/partner/organization
 * A partner can correct their own organisation details (in case the admin
 * made a mistake at onboarding). Email is intentionally NOT editable here —
 * it is the login identity and must be changed by an admin.
 */
async function updateMyOrganization(req, res) {
  const sb = supabaseAdmin();
  const partnerId = req.user.partnerId;
  if (!partnerId) return forbidden(res, 'Partner ID missing on user');

  const patch = {};
  if (req.body.organizationName !== undefined) patch.organization_name = req.body.organizationName;
  if (req.body.contactPhone !== undefined) patch.contact_phone = req.body.contactPhone;
  if (req.body.address !== undefined) patch.address = req.body.address;
  if (req.body.state !== undefined) patch.state = req.body.state;
  if (req.body.logoUrl !== undefined) patch.logo_url = req.body.logoUrl;
  if (req.body.website !== undefined) patch.website = req.body.website;
  if (req.body.taxId !== undefined) patch.tax_id = req.body.taxId;
  if (req.body.contactName !== undefined) patch.contact_name = req.body.contactName;

  if (Object.keys(patch).length === 0) {
    const { data: current } = await sb.from('partners').select('*').eq('id', partnerId).maybeSingle();
    return ok(res, current);
  }

  const { data, error } = await sb.from('partners').update(patch).eq('id', partnerId).select().single();
  if (error) {
    logger.error({ err: error.message, code: error.code, hint: error.hint, details: error.details }, 'partner self-update failed');
    throw error;
  }
  return ok(res, data);
}

/**
 * ===========================================================================
 * FULL-DIRECTORY BROWSE (partners can see ALL cooperatives & farmers)
 * ---------------------------------------------------------------------------
 * Unlike search/portfolio/watchlist (which are scoped to requests forwarded to
 * the partner), these endpoints expose the whole population so a lender can get
 * the full picture of available borrowers — including filtering by the field
 * agent who manages them. Read-only; no mutation. Identity columns (NIN/BVN/
 * phone) are returned the same masked way the report screens already handle.
 * ===========================================================================
 */

// GET /partner/cooperatives?search&state&lga&crop&agentId
async function browseCooperatives(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { search: term, state, lga, crop, agentId } = req.query;

  let q = sb.from('cooperatives').select(
    `*, cooperative_credit_scores(average_score, cooperative_tier, total_farmers, scored_farmers)`,
    { count: 'exact' }
  );
  if (agentId) q = q.eq('created_by_agent_id', agentId);
  if (term) q = q.ilike('name', `%${term}%`);
  if (state) q = q.eq('state', state);
  if (lga) q = q.eq('lga', lga);
  if (crop) q = q.contains('crops_supported', [crop]);
  q = q.order('name', { ascending: true }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;
  const shaped = (data || []).map((row) => {
    const cs = Array.isArray(row.cooperative_credit_scores)
      ? row.cooperative_credit_scores[0]
      : row.cooperative_credit_scores;
    return {
      ...row,
      average_score: cs?.average_score ?? 0,
      cooperative_tier: cs?.cooperative_tier || 'D',
      total_farmers: cs?.total_farmers ?? 0,
      scored_farmers: cs?.scored_farmers ?? 0,
    };
  });
  return paginated(res, shaped, { page, pageSize, total: count || 0 });
}

// GET /partner/farmers?search&cooperativeId&tier&state&lga&agentId
async function browseFarmers(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { search: term, cooperativeId, tier, state, lga, agentId } = req.query;

  let q = sb.from('farmers').select(
    `*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`,
    { count: 'exact' }
  );
  if (agentId) q = q.eq('created_by_agent_id', agentId);
  if (cooperativeId) q = q.eq('cooperative_id', cooperativeId);
  if (term) q = q.ilike('full_name', `%${term}%`);
  if (state) q = q.eq('state', state);
  if (lga) q = q.eq('lga', lga);
  if (tier) q = q.eq('credit_tier', tier);
  q = q.order('full_name', { ascending: true }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, shapeFarmers(data || []), { page, pageSize, total: count || 0 });
}

// GET /partner/cooperatives/:cooperativeId/farmers
async function browseCooperativeFarmers(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { count, data, error } = await sb
    .from('farmers')
    .select(
      `*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`,
      { count: 'exact' }
    )
    .eq('cooperative_id', req.params.cooperativeId)
    .order('full_name', { ascending: true })
    .range(from, to);
  if (error) throw error;
  return paginated(res, shapeFarmers(data || []), { page, pageSize, total: count || 0 });
}

// GET /partner/field-agents  — list of agents (to filter the directory by who manages farmers)
async function fieldAgents(req, res) {
  const sb = supabaseAdmin();
  const { data: roles } = await sb.from('user_roles').select('user_id').eq('role', 'field_agent');
  const ids = (roles || []).map((r) => r.user_id);
  if (ids.length === 0) return ok(res, []);
  const { data: profiles } = await sb
    .from('profiles')
    .select('user_id, full_name, state')
    .in('user_id', ids)
    .eq('status', 'active')
    .order('full_name', { ascending: true });
  return ok(res, profiles || []);
}

module.exports = { search, portfolio, watchlist, partnerScopedIds, getMyOrganization, updateMyOrganization, browseCooperatives, browseFarmers, browseCooperativeFarmers, fieldAgents };
