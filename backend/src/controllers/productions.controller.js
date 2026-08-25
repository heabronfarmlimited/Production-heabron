'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, badRequest, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer } = require('../services/credit-score');
const email = require('../services/email');
const logger = require('../utils/logger');

function shapeProduction(b) {
  let yieldRatio = null;
  if (b.actualYieldTonnes && b.benchmarkYieldTonnes) {
    yieldRatio = Math.min(Number(b.actualYieldTonnes) / Number(b.benchmarkYieldTonnes), 1.0);
  }
  return {
    cycle_number: b.cycleNumber || 1,
    season: b.season,
    crop: b.crop,
    farm_size_acres: b.farmSizeAcres ?? null,
    expected_planting_date: b.expectedPlantingDate ?? null,
    expected_harvest_date: b.expectedHarvestDate ?? null,
    expected_yield_tonnes: b.expectedYieldTonnes ?? null,
    actual_yield_tonnes: b.actualYieldTonnes ?? null,
    benchmark_yield_tonnes: b.benchmarkYieldTonnes ?? null,
    yield_ratio: yieldRatio,
    harvest_date: b.harvestDate ?? null,
    harvest_photo_urls: b.harvestPhotoUrls ?? null,
    warehouse_receipt_url: b.warehouseReceiptUrl ?? null,
    buyer_receipt_url: b.buyerReceiptUrl ?? null,
    agent_signature_url: b.agentSignatureUrl ?? null,
    verification_notes: b.verificationNotes ?? null,
    seed_type: b.seedType ?? null,
    fertilizer_used: b.fertilizerUsed ?? null,
    herbicide_used: b.herbicideUsed ?? null,
    post_harvest_storage: b.postHarvestStorage ?? null,
    estimated_farm_income: b.estimatedFarmIncome ?? null,
    notes: b.notes ?? null,
  };
}

async function assertFarmerAccess(sb, farmerId, user) {
  const { data: farmer } = await sb
    .from('farmers')
    .select('id, created_by_agent_id, full_name')
    .eq('id', farmerId)
    .maybeSingle();
  if (!farmer) return { error: 'not_found' };
  if (user.role === 'field_agent' && farmer.created_by_agent_id !== user.userId) return { error: 'forbidden' };
  return { farmer };
}

// GET /productions?farmerId&crop&season
async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { farmerId, crop, season } = req.query;
  let q = sb.from('seasonal_productions').select('*, farmers(id, full_name)', { count: 'exact' });
  if (farmerId) q = q.eq('farmer_id', farmerId);
  if (crop) q = q.eq('crop', crop);
  if (season) q = q.eq('season', season);
  if (req.user.role === 'field_agent') q = q.eq('created_by_agent_id', req.user.userId);
  q = q.order('expected_harvest_date', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

// GET /productions/:productionId
async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('seasonal_productions')
    .select('*, farmers(id, full_name, created_by_agent_id, cooperative_id)')
    .eq('id', req.params.productionId)
    .maybeSingle();
  if (!data) return notFound(res);
  if (req.user.role === 'field_agent' && data.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);
  return ok(res, data);
}

// POST /productions
async function create(req, res) {
  const sb = supabaseAdmin();
  const body = req.body;
  const { farmer, error: accessErr } = await assertFarmerAccess(sb, body.farmerId, req.user);
  if (accessErr === 'not_found') return notFound(res, 'Farmer not found');
  if (accessErr === 'forbidden') return forbidden(res);

  const row = {
    farmer_id: body.farmerId,
    ...shapeProduction(body),
    // an actual yield entered by an agent starts as 'pending' verification;
    // a record with no actual yield yet is just a planned season.
    verification_status: 'pending',
    yield_verified_by_agent: false,
    created_by_agent_id: req.user.userId,
  };
  const { data, error } = await sb.from('seasonal_productions').insert(row).select().single();
  if (error) throw error;

  await logActivity({ actor: req.user, action: 'production_recorded', entityType: 'production', entityId: data.id, req });
  return created(res, data);
}

// PATCH /productions/:productionId
async function update(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from('seasonal_productions')
    .select('*, farmers(created_by_agent_id)')
    .eq('id', req.params.productionId)
    .maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);

  const shaped = shapeProduction({ ...existing, ...req.body });
  // Editing the actual yield resets verification to pending (re-evidence needed)
  const patch = { ...shaped, updated_at: new Date().toISOString() };
  if (req.body.actualYieldTonnes !== undefined && Number(req.body.actualYieldTonnes) !== Number(existing.actual_yield_tonnes)) {
    patch.verification_status = 'pending';
    patch.verification_date = null;
    patch.verified_by_agent_id = null;
  }
  const { data, error } = await sb.from('seasonal_productions').update(patch).eq('id', existing.id).select().single();
  if (error) throw error;

  await logActivity({ actor: req.user, action: 'production_updated', entityType: 'production', entityId: existing.id, req });
  return ok(res, data);
}

// POST /productions/:productionId/verify  (ADMIN)  body: { decision:'verify'|'reject', verificationNotes? }
async function verify(req, res) {
  const sb = supabaseAdmin();
  const { decision, verificationNotes } = req.body;
  const { data: prod } = await sb
    .from('seasonal_productions')
    .select('*, farmers(id, full_name, created_by_agent_id)')
    .eq('id', req.params.productionId)
    .maybeSingle();
  if (!prod) return notFound(res);
  if (!prod.actual_yield_tonnes) return badRequest(res, 'No actual yield recorded to verify');

  const verified = decision === 'verify';
  await sb.from('seasonal_productions').update({
    verification_status: verified ? 'verified' : 'rejected',
    verification_notes: verificationNotes || prod.verification_notes,
    verified_by_agent_id: req.user.userId,
    verification_date: new Date().toISOString(),
    yield_verified_by_agent: verified,
  }).eq('id', prod.id);

  // A verified yield feeds the credit score; recalc.
  if (verified) safeRecalculateFarmer(prod.farmer_id, { triggerReason: 'yield_verified' });

  // Notify + email the submitting agent
  const agentId = prod.created_by_agent_id || prod.farmers?.created_by_agent_id;
  if (agentId) {
    try {
      await sb.from('notifications').insert({
        user_id: agentId,
        type: verified ? 'yield_verified' : 'yield_rejected',
        title: verified ? 'Yield verified' : 'Yield rejected',
        message: `Yield for ${prod.farmers?.full_name || 'farmer'} (${prod.season || ''}) was ${verified ? 'verified' : 'rejected'}`,
        metadata: { productionId: prod.id },
      });
      const { data: ap } = await sb.from('profiles').select('email, full_name').eq('user_id', agentId).maybeSingle();
      if (ap?.email) {
        email.safe(email.sendYieldVerificationDecision)(ap.email, {
          recipientName: ap.full_name,
          farmerName: prod.farmers?.full_name,
          season: prod.season,
          decision: verified ? 'verified' : 'rejected',
          notes: verificationNotes,
        });
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'yield verification notify failed');
    }
  }

  await logActivity({ actor: req.user, action: `yield_${verified ? 'verified' : 'rejected'}`, entityType: 'production', entityId: prod.id, req });
  const { data: updated } = await sb.from('seasonal_productions').select('*').eq('id', prod.id).maybeSingle();
  return ok(res, updated);
}

// GET /farmers/:farmerId/seasonal-yield
// Full seasonal-yield history for one farmer (variance + achievement rate are
// generated columns), newest first, with a small summary block.
async function farmerSeasonalYield(req, res) {
  const sb = supabaseAdmin();
  const farmerId = req.params.farmerId;
  const acc = await assertFarmerAccess(sb, farmerId, req.user);
  if (acc.error === 'not_found') return notFound(res, 'Farmer not found');
  if (acc.error === 'forbidden') return forbidden(res);

  const { data, error } = await sb
    .from('seasonal_productions')
    .select('*')
    .eq('farmer_id', farmerId)
    .order('expected_harvest_date', { ascending: false, nullsFirst: false });
  if (error) throw error;

  const rows = data || [];
  const withYield = rows.filter((r) => r.actual_yield_tonnes != null);
  const avgAchievement =
    withYield.length > 0
      ? Number(
          (
            withYield.reduce((s, r) => s + (Number(r.yield_achievement_rate) || 0), 0) / withYield.length
          ).toFixed(4)
        )
      : null;
  const verifiedCount = rows.filter((r) => r.verification_status === 'verified').length;

  return ok(res, {
    seasons: rows,
    summary: {
      totalSeasons: rows.length,
      seasonsWithYield: withYield.length,
      verifiedSeasons: verifiedCount,
      avgAchievementRate: avgAchievement,
      latestSeason: rows[0] || null,
    },
  });
}

// GET /cooperatives/:cooperativeId/yield-volume?season=
// Seasonal Yield Volume card: expected vs actual vs previous, farmers reporting.
async function cooperativeYieldVolume(req, res) {
  const sb = supabaseAdmin();
  const cooperativeId = req.params.cooperativeId;
  const season = req.query.season || null;

  const { data: farmers } = await sb.from('farmers').select('id').eq('cooperative_id', cooperativeId);
  const ids = (farmers || []).map((f) => f.id);
  if (ids.length === 0) {
    return ok(res, { season, expectedYieldKg: 0, actualYieldKg: 0, previousYieldKg: 0, farmersReporting: 0, achievementRate: null, seasons: [] });
  }

  let q = sb.from('seasonal_productions').select('farmer_id, season, expected_yield_tonnes, actual_yield_tonnes, benchmark_yield_tonnes').in('farmer_id', ids);
  if (season) q = q.eq('season', season);
  const { data: prods, error } = await q;
  if (error) throw error;

  const T = 1000; // tonnes -> kg
  let expected = 0;
  let actual = 0;
  let previous = 0;
  const reporting = new Set();
  for (const p of prods || []) {
    expected += Number(p.expected_yield_tonnes || 0) * T;
    actual += Number(p.actual_yield_tonnes || 0) * T;
    previous += Number(p.benchmark_yield_tonnes || 0) * T;
    if (p.actual_yield_tonnes != null) reporting.add(p.farmer_id);
  }
  const seasonsList = [...new Set((prods || []).map((p) => p.season).filter(Boolean))];
  const achievementRate = expected > 0 ? Number((actual / expected).toFixed(4)) : null;

  return ok(res, {
    season,
    expectedYieldKg: Math.round(expected),
    actualYieldKg: Math.round(actual),
    previousYieldKg: Math.round(previous),
    farmersReporting: reporting.size,
    achievementRate,
    seasons: seasonsList,
  });
}

async function remove(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from('seasonal_productions')
    .select('id, farmers(created_by_agent_id)')
    .eq('id', req.params.productionId)
    .maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);
  await sb.from('seasonal_productions').delete().eq('id', req.params.productionId);
  await logActivity({ actor: req.user, action: 'production_deleted', entityType: 'production', entityId: req.params.productionId, req });
  return ok(res, { deleted: true });
}

module.exports = { list, getById, create, update, remove, verify, farmerSeasonalYield, cooperativeYieldVolume };
