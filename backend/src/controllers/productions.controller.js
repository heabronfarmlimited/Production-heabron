'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, badRequest, conflict, paginated, serverError } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer } = require('../services/credit-score');
const { assertFarmerAccess } = require('../utils/ownership');
const { getProfileFor } = require('../utils/profiles');
const email = require('../services/email');
const logger = require('../utils/logger');

/**
 * camelCase request field -> snake_case column, for seasonal_productions.
 *
 * Declared as a map (rather than an object literal built field by field) so
 * that a PATCH can write ONLY the fields the client actually sent. See the
 * note on `productionPatch` below for why that matters.
 *
 * `yield_variance_tonnes` and `yield_achievement_rate` are GENERATED columns —
 * never write them.
 */
const PRODUCTION_FIELDS = {
  cycleNumber: 'cycle_number',
  season: 'season',
  crop: 'crop',
  farmSizeAcres: 'farm_size_acres',
  expectedPlantingDate: 'expected_planting_date',
  expectedHarvestDate: 'expected_harvest_date',
  expectedYieldTonnes: 'expected_yield_tonnes',
  actualYieldTonnes: 'actual_yield_tonnes',
  benchmarkYieldTonnes: 'benchmark_yield_tonnes',
  harvestDate: 'harvest_date',
  harvestPhotoUrls: 'harvest_photo_urls',
  warehouseReceiptUrl: 'warehouse_receipt_url',
  buyerReceiptUrl: 'buyer_receipt_url',
  agentSignatureUrl: 'agent_signature_url',
  verificationNotes: 'verification_notes',
  seedType: 'seed_type',
  fertilizerUsed: 'fertilizer_used',
  herbicideUsed: 'herbicide_used',
  postHarvestStorage: 'post_harvest_storage',
  estimatedFarmIncome: 'estimated_farm_income',
  notes: 'notes',
};

/** actual / benchmark, capped at 1.0 — null when either side is unusable. */
function computeYieldRatio(actual, benchmark) {
  const a = Number(actual);
  const b = Number(benchmark);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0 || a < 0) return null;
  return Number(Math.min(a / b, 1.0).toFixed(4));
}

/** Full row for an INSERT: defaults applied, every column present. */
function productionRow(body) {
  const row = {};
  for (const [key, column] of Object.entries(PRODUCTION_FIELDS)) {
    row[column] = body[key] ?? null;
  }
  row.cycle_number = body.cycleNumber || 1;
  row.yield_ratio = computeYieldRatio(body.actualYieldTonnes, body.benchmarkYieldTonnes);
  return row;
}

/**
 * Patch for an UPDATE: ONLY the keys present in the request body.
 *
 * FIXED — this is the most destructive bug found in the audit. The old code
 * built the patch with:
 *
 *     const shaped = shapeProduction({ ...existing, ...req.body });
 *
 * `existing` is a snake_case database row; `shapeProduction` read camelCase
 * input. For every multi-word field the spread contributed nothing, so the
 * mapper fell through to its `?? null` and the UPDATE wrote NULL over:
 *
 *   actual_yield_tonnes     ← the verified harvest the credit score is built on
 *   expected_yield_tonnes, benchmark_yield_tonnes, farm_size_acres
 *   harvest_date, harvest_photo_urls, warehouse_receipt_url,
 *   buyer_receipt_url, agent_signature_url   ← the entire evidence trail
 *   seed_type, fertilizer_used, herbicide_used, post_harvest_storage,
 *   estimated_farm_income
 *
 * Only `season`, `crop` and `notes` survived, because those three happen to
 * spell identically in both cases. So a field agent correcting a typo in the
 * notes silently destroyed the season's yield data, and the farmer's score
 * dropped to yield-zero at the next recalculation.
 */
function productionPatch(body) {
  const patch = {};
  for (const [key, column] of Object.entries(PRODUCTION_FIELDS)) {
    if (body[key] !== undefined) patch[column] = body[key];
  }
  return patch;
}

/** Map an ownership-check failure onto a response. */
function denyFor(res, code) {
  if (code === 'not_found') return notFound(res, 'Farmer not found');
  if (code === 'forbidden') return forbidden(res);
  return serverError(res, 'Could not verify access to that farmer');
}

// GET /productions?farmerId&crop&season
async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { farmerId, crop, season, status } = req.query;
  let q = sb.from('seasonal_productions').select('*, farmers(id, full_name)', { count: 'exact' });
  if (farmerId) q = q.eq('farmer_id', farmerId);
  if (crop) q = q.eq('crop', crop);
  if (season) q = q.eq('season', season);
  if (status) q = q.eq('verification_status', status);
  if (req.user.role === 'field_agent') q = q.eq('created_by_agent_id', req.user.userId);
  q = q.order('expected_harvest_date', { ascending: false, nullsFirst: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

// GET /productions/:productionId
async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('seasonal_productions')
    .select('*, farmers(id, full_name, created_by_agent_id, cooperative_id)')
    .eq('id', req.params.productionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res, 'Production record not found');
  if (req.user.role === 'field_agent' && data.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);
  return ok(res, data);
}

// POST /productions
async function create(req, res) {
  const sb = supabaseAdmin();
  const body = req.body;
  const access = await assertFarmerAccess(sb, body.farmerId, req.user);
  if (access.error) return denyFor(res, access.error);

  const row = {
    farmer_id: body.farmerId,
    ...productionRow(body),
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
  const { data: existing, error: readErr } = await sb
    .from('seasonal_productions')
    .select('*, farmers(created_by_agent_id)')
    .eq('id', req.params.productionId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) return notFound(res, 'Production record not found');
  if (req.user.role === 'field_agent' && existing.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);

  const patch = productionPatch(req.body);
  if (Object.keys(patch).length === 0) return badRequest(res, 'No editable fields supplied');

  // Recompute the cached ratio only when one of its inputs is actually being
  // changed, using the new value where given and the stored one otherwise.
  if (patch.actual_yield_tonnes !== undefined || patch.benchmark_yield_tonnes !== undefined) {
    const actual = patch.actual_yield_tonnes ?? existing.actual_yield_tonnes;
    const benchmark = patch.benchmark_yield_tonnes ?? existing.benchmark_yield_tonnes;
    patch.yield_ratio = computeYieldRatio(actual, benchmark);
  }

  patch.updated_at = new Date().toISOString();

  // Editing the actual yield resets verification to pending (re-evidence needed)
  const yieldChanged =
    patch.actual_yield_tonnes !== undefined &&
    Number(patch.actual_yield_tonnes) !== Number(existing.actual_yield_tonnes);
  if (yieldChanged) {
    patch.verification_status = 'pending';
    patch.verification_date = null;
    patch.verified_by_agent_id = null;
    patch.yield_verified_by_agent = false;
  }

  const { data, error } = await sb
    .from('seasonal_productions')
    .update(patch)
    .eq('id', existing.id)
    .select()
    .single();
  if (error) throw error;

  // FIXED — a yield edit that invalidated a previously VERIFIED record left
  // the credit score standing on evidence that had just been withdrawn. The
  // score is recalculated (awaited) whenever the yield actually changes.
  if (yieldChanged && existing.verification_status === 'verified') {
    await safeRecalculateFarmer(existing.farmer_id, { triggerReason: 'yield_edited' });
  }

  await logActivity({ actor: req.user, action: 'production_updated', entityType: 'production', entityId: existing.id, req });
  return ok(res, data);
}

// POST /productions/:productionId/verify  (ADMIN)  body: { decision:'verify'|'reject', verificationNotes? }
async function verify(req, res) {
  const sb = supabaseAdmin();
  const { decision, verificationNotes } = req.body;
  const { data: prod, error: readErr } = await sb
    .from('seasonal_productions')
    .select('*, farmers(id, full_name, created_by_agent_id)')
    .eq('id', req.params.productionId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!prod) return notFound(res, 'Production record not found');
  if (prod.actual_yield_tonnes == null) return badRequest(res, 'No actual yield recorded to verify');

  // FIXED — no state guard. The same record could be verified, then rejected,
  // then verified again, each pass rewriting `verification_date` and firing
  // another email, and each verify/reject pair moving the farmer's score up
  // and down. Only a pending record is decidable; re-deciding requires the
  // agent to resubmit (which `update` already forces by resetting to pending).
  if (prod.verification_status !== 'pending') {
    return conflict(res, `This yield record has already been ${prod.verification_status}`, {
      productionId: prod.id,
      currentStatus: prod.verification_status,
    });
  }

  const verified = decision === 'verify';
  const { data: claimed, error: updErr } = await sb
    .from('seasonal_productions')
    .update({
      verification_status: verified ? 'verified' : 'rejected',
      verification_notes: verificationNotes || prod.verification_notes,
      verified_by_agent_id: req.user.userId,
      verification_date: new Date().toISOString(),
      yield_verified_by_agent: verified,
    })
    .eq('id', prod.id)
    .eq('verification_status', 'pending')
    .select('id');
  if (updErr) throw updErr;
  if (!claimed || claimed.length === 0) {
    return conflict(res, 'This yield record was decided by someone else a moment ago', { productionId: prod.id });
  }

  // A verified yield feeds the credit score; recalc.
  // FIXED — was fire-and-forget, so on Vercel the score was never actually
  // updated when an admin verified a harvest. That is the single most
  // important recalculation in the product: verified yield is 60% of the score.
  if (verified) await safeRecalculateFarmer(prod.farmer_id, { triggerReason: 'yield_verified' });

  // Notify + email the submitting agent
  const agentId = prod.created_by_agent_id || prod.farmers?.created_by_agent_id;
  if (agentId) {
    try {
      const { error: notifyErr } = await sb.from('notifications').insert({
        user_id: agentId,
        type: verified ? 'yield_verified' : 'yield_rejected',
        title: verified ? 'Yield verified' : 'Yield rejected',
        message: `Yield for ${prod.farmers?.full_name || 'farmer'} (${prod.season || ''}) was ${verified ? 'verified' : 'rejected'}`,
        metadata: { productionId: prod.id },
      });
      if (notifyErr) throw notifyErr;

      const ap = await getProfileFor(sb, agentId);
      if (ap?.email) {
        const result = await email.safe(email.sendYieldVerificationDecision)(ap.email, {
          recipientName: ap.full_name,
          farmerName: prod.farmers?.full_name,
          season: prod.season,
          decision: verified ? 'verified' : 'rejected',
          notes: verificationNotes,
        });
        if (result?.error) logger.warn({ err: result.error, to: ap.email }, 'yield decision email rejected');
      }
    } catch (e) {
      logger.warn({ err: e.message, code: e.code }, 'yield verification notify failed');
    }
  }

  await logActivity({ actor: req.user, action: `yield_${verified ? 'verified' : 'rejected'}`, entityType: 'production', entityId: prod.id, req });
  const { data: updated, error: reReadErr } = await sb
    .from('seasonal_productions')
    .select('*')
    .eq('id', prod.id)
    .maybeSingle();
  if (reReadErr) throw reReadErr;
  return ok(res, updated);
}

// GET /farmers/:farmerId/seasonal-yield
// Full seasonal-yield history for one farmer (variance + achievement rate are
// generated columns), newest first, with a small summary block.
async function farmerSeasonalYield(req, res) {
  const sb = supabaseAdmin();
  const farmerId = req.params.farmerId;
  const access = await assertFarmerAccess(sb, farmerId, req.user);
  if (access.error) return denyFor(res, access.error);

  const { data, error } = await sb
    .from('seasonal_productions')
    .select('*')
    .eq('farmer_id', farmerId)
    .order('expected_harvest_date', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw error;

  const rows = data || [];
  const withYield = rows.filter((r) => r.actual_yield_tonnes != null);
  // FIXED — `Number(r.yield_achievement_rate) || 0` counted a NULL rate as a
  // zero achievement, so one season with no expectation recorded (the
  // generated column is NULL when `expected_yield_tonnes` is absent) dragged
  // the farmer's average achievement down. Only rows that actually have a rate
  // are averaged.
  const rated = withYield
    .map((r) => Number(r.yield_achievement_rate))
    .filter((n) => Number.isFinite(n));
  const avgAchievement =
    rated.length > 0 ? Number((rated.reduce((s, n) => s + n, 0) / rated.length).toFixed(4)) : null;
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

  const empty = {
    season,
    expectedYieldKg: 0,
    actualYieldKg: 0,
    previousYieldKg: 0,
    farmersReporting: 0,
    achievementRate: null,
    seasons: [],
  };

  const { data: farmers, error: farmersErr } = await sb
    .from('farmers')
    .select('id')
    .eq('cooperative_id', cooperativeId)
    .limit(5000);
  if (farmersErr) throw farmersErr;

  const ids = (farmers || []).map((f) => f.id);
  if (ids.length === 0) return ok(res, empty);

  let q = sb
    .from('seasonal_productions')
    .select('farmer_id, season, expected_yield_tonnes, actual_yield_tonnes, benchmark_yield_tonnes')
    .in('farmer_id', ids)
    .limit(5000);
  if (season) q = q.eq('season', season);
  const { data: prods, error } = await q;
  if (error) throw error;

  const T = 1000; // tonnes -> kg
  let expected = 0;
  let actual = 0;
  let previous = 0;
  const reporting = new Set();
  for (const p of prods || []) {
    expected += (Number(p.expected_yield_tonnes) || 0) * T;
    actual += (Number(p.actual_yield_tonnes) || 0) * T;
    previous += (Number(p.benchmark_yield_tonnes) || 0) * T;
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
  const { data: existing, error: readErr } = await sb
    .from('seasonal_productions')
    .select('id, farmer_id, verification_status, actual_yield_tonnes, farmers(created_by_agent_id)')
    .eq('id', req.params.productionId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) return notFound(res, 'Production record not found');
  if (req.user.role === 'field_agent' && existing.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);

  // FIXED — the delete discarded its error and reported `{ deleted: true }`
  // regardless, so a row blocked by a constraint looked deleted and came back
  // on the next refresh.
  const { error: delErr } = await sb.from('seasonal_productions').delete().eq('id', req.params.productionId);
  if (delErr) throw delErr;

  // FIXED — deleting a verified yield left the score it had produced in place.
  if (existing.verification_status === 'verified' && existing.actual_yield_tonnes != null) {
    await safeRecalculateFarmer(existing.farmer_id, { triggerReason: 'yield_deleted' });
  }

  await logActivity({ actor: req.user, action: 'production_deleted', entityType: 'production', entityId: req.params.productionId, req });
  return ok(res, { deleted: true });
}

module.exports = { list, getById, create, update, remove, verify, farmerSeasonalYield, cooperativeYieldVolume };
