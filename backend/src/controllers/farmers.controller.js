'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated, badRequest } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { ADMIN_ROLES } = require('../middleware/auth');
const ninService = require('../services/nin');
const { safeRecalculateFarmer, safeRecalculateCooperative } = require('../services/credit-score');
const { shapeFarmer, shapeFarmers } = require('../utils/shapeFarmer');
const { measureFarm } = require('../utils/geo');
const logger = require('../utils/logger');

// All farm-profile keys the API accepts at the top level OR nested under `farm`.
// We tolerate both shapes because the mobile client (Flutter) flattens nested
// objects in some forms.
const FARM_FIELDS = [
  'farmSizeAcres',
  'cropType',
  'secondaryCrops',
  'soilType',
  'irrigationAccess',
  'waterSource',
  'landOwnership',
  'yearsExperience',
  'landDocumentUrl',
  'landDocumentType',
  'farmPhotoUrls',
];

function extractFarmInput(body) {
  if (body && body.farm && typeof body.farm === 'object') return body.farm;
  const flat = {};
  let any = false;
  for (const key of FARM_FIELDS) {
    if (body && body[key] !== undefined) {
      flat[key] = body[key];
      any = true;
    }
  }
  return any ? flat : null;
}

function farmerRow(input, userId) {
  return {
    cooperative_id: input.cooperativeId,
    full_name: input.fullName,
    date_of_birth: input.dateOfBirth,
    gender: input.gender,
    phone: input.phone,
    alt_phone: input.altPhone,
    address: input.address,
    state: input.state,
    lga: input.lga,
    household_size: input.householdSize,
    dependents: input.dependents,
    education_level: input.educationLevel,
    nin: input.nin,
    bvn: input.bvn,
    id_image_url: input.idImageUrl,
    farmer_photo_url: input.farmerPhotoUrl,
    created_by_agent_id: userId,
  };
}

function farmRow(farmerId, farm) {
  const row = {
    farmer_id: farmerId,
    farm_size_acres: farm.farmSizeAcres,
    plot_count: farm.plotCount || 1,
    crop_type: farm.cropType,
    secondary_crops: farm.secondaryCrops || null,
    soil_type: farm.soilType,
    irrigation_access: farm.irrigationAccess === undefined ? false : !!farm.irrigationAccess,
    water_source: farm.waterSource,
    land_ownership: farm.landOwnership,
    years_experience: farm.yearsExperience || 0,
    gps_lat: farm.gpsLat,
    gps_lng: farm.gpsLng,
    gps_polygon: farm.gpsPolygon || null,
    land_document_url: farm.landDocumentUrl,
    land_document_type: farm.landDocumentType,
    farm_photo_urls: farm.farmPhotoUrls || null,
  };
  // If a boundary polygon was supplied, derive the mapped area + centre so the
  // agent doesn't have to type acreage and the farm shows as GPS-mapped.
  if (farm.gpsPolygon) {
    const m = measureFarm(farm.gpsPolygon);
    if (m) {
      row.gps_mapped = true;
      row.computed_area_acres = m.acres;
      if (row.gps_lat == null) row.gps_lat = m.centroid.lat;
      if (row.gps_lng == null) row.gps_lng = m.centroid.lng;
      if (row.farm_size_acres == null) row.farm_size_acres = m.acres;
    }
  }
  return row;
}

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { search, cooperativeId, tier, state, lga, agentId } = req.query;

  let q = sb.from('farmers').select(
    `*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`,
    { count: 'exact' }
  );

  if (req.user.role === 'field_agent') {
    q = q.eq('created_by_agent_id', req.user.userId);
  } else if (ADMIN_ROLES.includes(req.user.role) && agentId) {
    q = q.eq('created_by_agent_id', agentId);
  }
  if (cooperativeId) q = q.eq('cooperative_id', cooperativeId);
  if (search) q = q.ilike('full_name', `%${search}%`);
  if (state) q = q.eq('state', state);
  if (lga) q = q.eq('lga', lga);
  if (tier) q = q.eq('credit_tier', tier);

  q = q.order('created_at', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, shapeFarmers(data || []), { page, pageSize, total: count || 0 });
}

async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('farmers')
    .select(`*, cooperatives(id, name, state, lga), farm_profiles(*), credit_scores(*)`)
    .eq('id', req.params.farmerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res);
  if (req.user.role === 'field_agent' && data.created_by_agent_id !== req.user.userId) return forbidden(res);
  return ok(res, shapeFarmer(data));
}

async function create(req, res) {
  const sb = supabaseAdmin();
  const row = farmerRow(req.body, req.user.userId);

  const { data: farmer, error } = await sb.from('farmers').insert(row).select().single();
  if (error) {
    logger.error({ err: error.message, code: error.code, hint: error.hint, details: error.details }, 'farmer insert failed');
    throw error;
  }

  // Insert farm profile (accept either nested `farm` object or flat fields).
  const farmInput = extractFarmInput(req.body);
  if (farmInput) {
    const { error: fpErr } = await sb.from('farm_profiles').insert(farmRow(farmer.id, farmInput));
    if (fpErr) {
      logger.error(
        { err: fpErr.message, code: fpErr.code, hint: fpErr.hint, details: fpErr.details, farmerId: farmer.id },
        'farm_profiles insert failed'
      );
    }
  }

  if (req.body.nin) {
    try {
      const nameParts = req.body.fullName.split(/\s+/);
      const result = await ninService.verifyNin({
        nin: req.body.nin,
        firstName: nameParts[0],
        lastName: nameParts.slice(-1)[0],
        dateOfBirth: req.body.dateOfBirth,
      });
      await sb.from('farmers').update({
        nin_verification_status: result.status,
        nin_verification_payload: result.raw,
        verified_at: result.status === 'verified' ? new Date().toISOString() : null,
        verified_by_agent_id: result.status === 'verified' ? req.user.userId : null,
      }).eq('id', farmer.id);
    } catch (ninErr) {
      logger.warn({ err: ninErr.message, farmerId: farmer.id }, 'NIN verify failed (non-fatal)');
    }
  }

  // Refresh cooperative member count
  if (row.cooperative_id) {
    try {
      const { count } = await sb.from('farmers').select('id', { count: 'exact', head: true }).eq('cooperative_id', row.cooperative_id);
      if (typeof count === 'number') {
        await sb.from('cooperatives').update({ total_members: count }).eq('id', row.cooperative_id);
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'cooperative total_members update failed');
    }
  }

  safeRecalculateFarmer(farmer.id, { triggerReason: 'farmer_created' });

  try {
    await sb.from('notifications').insert({
      user_id: req.user.userId,
      type: 'farmer_added',
      title: 'Farmer added',
      message: `${farmer.full_name} was added`,
      metadata: { farmerId: farmer.id, cooperativeId: row.cooperative_id },
    });
  } catch (e) { logger.warn({ err: e.message }, 'farmer notification insert failed'); }
  try {
    await logActivity({ actor: req.user, action: 'farmer_created', entityType: 'farmer', entityId: farmer.id, metadata: { name: farmer.full_name }, req });
  } catch (e) { logger.warn({ err: e.message }, 'farmer activity log failed'); }

  const { data: hydrated } = await sb
    .from('farmers')
    .select(`*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`)
    .eq('id', farmer.id)
    .maybeSingle();
  return created(res, shapeFarmer(hydrated || farmer));
}

async function update(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from('farmers').select('id, created_by_agent_id').eq('id', req.params.farmerId).maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.created_by_agent_id !== req.user.userId) return forbidden(res);

  const patch = farmerRow(req.body, existing.created_by_agent_id);
  delete patch.created_by_agent_id;
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

  const { data, error } = await sb.from('farmers').update(patch).eq('id', existing.id).select().single();
  if (error) throw error;

  const farmInput = extractFarmInput(req.body);
  if (farmInput) {
    const farm = farmRow(existing.id, farmInput);
    const { data: fp } = await sb.from('farm_profiles').select('id').eq('farmer_id', existing.id).maybeSingle();
    if (fp) {
      const { error: e2 } = await sb.from('farm_profiles').update(farm).eq('id', fp.id);
      if (e2) logger.error({ err: e2.message, code: e2.code, hint: e2.hint, details: e2.details }, 'farm_profiles update failed');
    } else {
      const { error: e2 } = await sb.from('farm_profiles').insert(farm);
      if (e2) logger.error({ err: e2.message, code: e2.code, hint: e2.hint, details: e2.details }, 'farm_profiles insert failed');
    }
  }

  safeRecalculateFarmer(existing.id, { triggerReason: 'farmer_updated' });
  await logActivity({ actor: req.user, action: 'farmer_updated', entityType: 'farmer', entityId: existing.id, req });

  const { data: hydrated } = await sb
    .from('farmers')
    .select(`*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`)
    .eq('id', existing.id)
    .maybeSingle();
  return ok(res, shapeFarmer(hydrated || data));
}

async function remove(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from('farmers').select('id, full_name, created_by_agent_id, cooperative_id').eq('id', req.params.farmerId).maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.created_by_agent_id !== req.user.userId) return forbidden(res);
  await sb.from('farmers').delete().eq('id', existing.id);

  if (existing.cooperative_id) {
    try {
      const { count } = await sb.from('farmers').select('id', { count: 'exact', head: true }).eq('cooperative_id', existing.cooperative_id);
      if (typeof count === 'number') {
        await sb.from('cooperatives').update({ total_members: count }).eq('id', existing.cooperative_id);
      }
    } catch (e) { logger.warn({ err: e.message }, 'cooperative count refresh failed after farmer delete'); }
    safeRecalculateCooperative(existing.cooperative_id);
  }

  await logActivity({ actor: req.user, action: 'farmer_deleted', entityType: 'farmer', entityId: existing.id, metadata: { name: existing.full_name }, req });
  return ok(res, { deleted: true });
}

async function verifyNin(req, res) {
  const sb = supabaseAdmin();
  const { data: farmer } = await sb.from('farmers').select('*').eq('id', req.params.farmerId).maybeSingle();
  if (!farmer) return notFound(res);
  if (req.user.role === 'field_agent' && farmer.created_by_agent_id !== req.user.userId) return forbidden(res);
  if (!farmer.nin) return badRequest(res, 'No NIN on file for this farmer');

  const nameParts = (farmer.full_name || '').split(/\s+/);
  const result = await ninService.verifyNin({
    nin: farmer.nin,
    firstName: nameParts[0],
    lastName: nameParts.slice(-1)[0],
    dateOfBirth: farmer.date_of_birth,
  });
  await sb.from('farmers').update({
    nin_verification_status: result.status,
    nin_verification_payload: result.raw,
    verified_at: result.status === 'verified' ? new Date().toISOString() : null,
    verified_by_agent_id: result.status === 'verified' ? req.user.userId : null,
  }).eq('id', farmer.id);
  return ok(res, { status: result.status, details: result.details });
}

async function getCreditScore(req, res) {
  const sb = supabaseAdmin();
  const { data: score } = await sb
    .from('credit_scores')
    .select('*')
    .eq('farmer_id', req.params.farmerId)
    .maybeSingle();
  const { data: history } = await sb
    .from('credit_score_history')
    .select('*')
    .eq('farmer_id', req.params.farmerId)
    .order('calculated_at', { ascending: false })
    .limit(20);
  return ok(res, { current: score || null, history: history || [] });
}

async function recalculateScore(req, res) {
  const result = await safeRecalculateFarmer(req.params.farmerId, { triggerReason: 'manual_recalc' });
  return ok(res, result);
}

/**
 * GET /api/agent/farmers/:farmerId/financing-history
 * Returns every financing request linked to this farmer (including those
 * routed via the cooperative if no farmer_id was set on the request),
 * along with each request's repayment trail and computed outstanding
 * balance. Sorted newest-first.
 */
async function getFinancingHistory(req, res) {
  const sb = supabaseAdmin();
  const farmerId = req.params.farmerId;

  // Permission gate
  const { data: farmer } = await sb
    .from('farmers')
    .select('id, cooperative_id, created_by_agent_id, full_name')
    .eq('id', farmerId)
    .maybeSingle();
  if (!farmer) return notFound(res, 'Farmer not found');
  if (req.user.role === 'field_agent' && farmer.created_by_agent_id !== req.user.userId) return forbidden(res);

  // Pull every financing request where farmer_id = this farmer
  // OR (farmer_id IS NULL AND cooperative_id = this farmer's coop) — those
  // are cooperative-level loans that benefit every member.
  const { data: byFarmer } = await sb
    .from('financing_requests')
    .select('*, cooperatives(id, name)')
    .eq('farmer_id', farmerId)
    .order('created_at', { ascending: false });

  let coopLoans = [];
  if (farmer.cooperative_id) {
    const { data } = await sb
      .from('financing_requests')
      .select('*, cooperatives(id, name)')
      .is('farmer_id', null)
      .eq('cooperative_id', farmer.cooperative_id)
      .order('created_at', { ascending: false });
    coopLoans = data || [];
  }

  const all = [...(byFarmer || []), ...coopLoans];

  // For each request, pull the repayment trail and compute outstanding.
  const ids = all.map((r) => r.id);
  let repaymentsByRequest = new Map();
  if (ids.length) {
    const { data: payments } = await sb
      .from('repayment_records')
      .select('*')
      .in('financing_request_id', ids)
      .order('payment_date', { ascending: false });
    for (const p of payments || []) {
      const arr = repaymentsByRequest.get(p.financing_request_id) || [];
      arr.push(p);
      repaymentsByRequest.set(p.financing_request_id, arr);
    }
  }

  const enriched = all.map((r) => {
    const payments = repaymentsByRequest.get(r.id) || [];
    const active = payments.filter((p) => !p.voided);
    const paid = active.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
    const principal = Number(r.approved_amount || r.disbursed_amount || r.loan_amount || 0);
    const outstanding = Math.max(0, principal - paid);
    const fullyRepaid = principal > 0 && paid >= principal;
    return {
      ...r,
      summary: {
        principal,
        totalPaid: paid,
        outstanding,
        fullyRepaid,
        repaymentCount: active.length,
        lastPaymentDate: active[0]?.payment_date || null,
      },
      repayments: payments,
    };
  });

  // Totals
  const totals = enriched.reduce(
    (acc, r) => ({
      requests: acc.requests + 1,
      principal: acc.principal + r.summary.principal,
      paid: acc.paid + r.summary.totalPaid,
      outstanding: acc.outstanding + r.summary.outstanding,
    }),
    { requests: 0, principal: 0, paid: 0, outstanding: 0 }
  );

  return ok(res, {
    farmer: { id: farmer.id, fullName: farmer.full_name, cooperativeId: farmer.cooperative_id },
    totals,
    history: enriched,
  });
}

// POST /farmers/:farmerId/map-farm
// Compute farm size + centre from a boundary polygon and persist it.
// Body: { gpsPolygon: [{lat,lng}...], overrideSizeAcres? }
async function mapFarm(req, res) {
  const sb = supabaseAdmin();
  const { farmerId } = req.params;
  const { gpsPolygon, overrideSizeAcres } = req.body;

  const { data: farmer } = await sb
    .from('farmers')
    .select('id, created_by_agent_id, cooperative_id, farm_profiles(id)')
    .eq('id', farmerId)
    .maybeSingle();
  if (!farmer) return notFound(res, 'Farmer not found');
  if (req.user.role === 'field_agent' && farmer.created_by_agent_id !== req.user.userId) return forbidden(res);

  const m = measureFarm(gpsPolygon);
  if (!m) return badRequest(res, 'Invalid polygon — need at least 3 valid {lat,lng} points');

  const sizeAcres = overrideSizeAcres != null ? Number(overrideSizeAcres) : m.acres;
  const patch = {
    gps_polygon: gpsPolygon,
    gps_lat: m.centroid.lat,
    gps_lng: m.centroid.lng,
    gps_mapped: true,
    computed_area_acres: m.acres,
    farm_size_acres: sizeAcres,
    updated_at: new Date().toISOString(),
  };

  const existingProfile = farmer.farm_profiles?.[0] || farmer.farm_profiles;
  if (existingProfile?.id) {
    await sb.from('farm_profiles').update(patch).eq('id', existingProfile.id);
  } else {
    await sb.from('farm_profiles').insert({ farmer_id: farmerId, ...patch });
  }

  // Farm size feeds yield-per-hectare; recalc the score.
  safeRecalculateFarmer(farmerId, { triggerReason: 'farm_mapped' });

  await logActivity({ actor: req.user, action: 'farm_mapped', entityType: 'farm_profile', entityId: farmerId, metadata: { acres: m.acres }, req });
  return ok(res, {
    farmerId,
    computedAreaAcres: m.acres,
    computedAreaHectares: m.hectares,
    areaSqMeters: m.areaSqM,
    centroid: m.centroid,
    farmSizeAcres: sizeAcres,
    gpsMapped: true,
  });
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  verifyNin,
  mapFarm,
  getCreditScore,
  recalculateScore,
  getFinancingHistory,
};
