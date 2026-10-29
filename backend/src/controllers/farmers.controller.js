'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated, badRequest, conflict, serverError } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { ADMIN_ROLES } = require('../middleware/auth');
const ninService = require('../services/nin');
const { safeRecalculateFarmer, safeRecalculateCooperative } = require('../services/credit-score');
const { shapeFarmer, shapeFarmers } = require('../utils/shapeFarmer');
const { assertFarmerAccess, assertCooperativeAccess } = require('../utils/ownership');
const { chunk } = require('../utils/profiles');
const { containsPattern } = require('../utils/search');
const { loanPrincipal } = require('../services/credit-score');
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

/** camelCase farm input -> farm_profiles column. */
const FARM_COLUMNS = {
  farmSizeAcres: 'farm_size_acres',
  plotCount: 'plot_count',
  cropType: 'crop_type',
  secondaryCrops: 'secondary_crops',
  soilType: 'soil_type',
  irrigationAccess: 'irrigation_access',
  waterSource: 'water_source',
  landOwnership: 'land_ownership',
  yearsExperience: 'years_experience',
  gpsLat: 'gps_lat',
  gpsLng: 'gps_lng',
  gpsPolygon: 'gps_polygon',
  landDocumentUrl: 'land_document_url',
  landDocumentType: 'land_document_type',
  farmPhotoUrls: 'farm_photo_urls',
};

/**
 * Derive mapped area + centre from a boundary polygon, so the agent doesn't
 * have to type acreage and the farm shows as GPS-mapped. Only fills fields the
 * caller left blank.
 */
function applyPolygonDerivations(row, polygon) {
  if (!polygon) return row;
  const m = measureFarm(polygon);
  if (!m) return row;
  row.gps_mapped = true;
  row.computed_area_acres = m.acres;
  if (row.gps_lat == null) row.gps_lat = m.centroid.lat;
  if (row.gps_lng == null) row.gps_lng = m.centroid.lng;
  if (row.farm_size_acres == null) row.farm_size_acres = m.acres;
  return row;
}

/** Full farm row for an INSERT — creation defaults applied. */
function farmRow(farmerId, farm) {
  const row = { farmer_id: farmerId };
  for (const [key, column] of Object.entries(FARM_COLUMNS)) {
    row[column] = farm[key] ?? null;
  }
  row.plot_count = farm.plotCount || 1;
  row.irrigation_access = farm.irrigationAccess === undefined ? false : !!farm.irrigationAccess;
  row.years_experience = farm.yearsExperience || 0;
  return applyPolygonDerivations(row, farm.gpsPolygon);
}

/**
 * Farm patch for an UPDATE — ONLY the keys the client actually sent.
 *
 * FIXED — `update` reused the INSERT builder, which supplies a value for every
 * column. Any partial farm patch therefore wrote the creation defaults over
 * the agent's real data:
 *   secondary_crops  -> null   (crop list wiped)
 *   farm_photo_urls  -> null   (every farm photo URL dropped)
 *   gps_polygon      -> null   (the walked boundary erased)
 *   irrigation_access-> false
 *   years_experience -> 0
 *   plot_count       -> 1
 * So "change the soil type" quietly deleted the farm photos and reset the
 * farmer's experience to zero. (The Joi layer was injecting those same
 * defaults into the request body — fixed separately in validators/domain.js.)
 */
function farmPatch(farm) {
  const patch = {};
  for (const [key, column] of Object.entries(FARM_COLUMNS)) {
    if (farm[key] !== undefined) patch[column] = farm[key];
  }
  if (farm.irrigationAccess !== undefined) patch.irrigation_access = !!farm.irrigationAccess;
  return applyPolygonDerivations(patch, farm.gpsPolygon);
}

/**
 * Keep `cooperatives.total_members` in step with reality.
 * Uses a HEAD count so the row data is never transferred.
 */
async function refreshMemberCount(sb, cooperativeId) {
  if (!cooperativeId) return;
  const { count, error } = await sb
    .from('farmers')
    .select('id', { count: 'exact', head: true })
    .eq('cooperative_id', cooperativeId);
  if (error) {
    logger.warn({ err: error.message, code: error.code, cooperativeId }, 'member count query failed');
    return;
  }
  if (typeof count !== 'number') return;
  const { error: updErr } = await sb.from('cooperatives').update({ total_members: count }).eq('id', cooperativeId);
  if (updErr) {
    logger.warn({ err: updErr.message, code: updErr.code, cooperativeId }, 'cooperative total_members update failed');
  }
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
  // FIXED — the search term was interpolated straight into a PostgREST
  // `ilike` pattern. `%`, `_` and `,` are all meaningful there: a search for
  // "100%" matched everything, and a comma terminated the filter value and
  // produced a malformed query (a 400 the UI showed as an empty result).
  if (search) q = q.ilike('full_name', containsPattern(search));
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
  if (!data) return notFound(res, 'Farmer not found');
  if (req.user.role === 'field_agent' && data.created_by_agent_id !== req.user.userId) return forbidden(res);
  return ok(res, shapeFarmer(data));
}

async function create(req, res) {
  const sb = supabaseAdmin();

  // FIXED — nothing verified the cooperative. An agent could attach a new
  // farmer to ANY cooperative id, including another agent's, which then
  // counted that farmer toward the other agent's member total and their
  // cooperative's average credit score.
  const coopAccess = await assertCooperativeAccess(sb, req.body.cooperativeId, req.user);
  if (coopAccess.error === 'not_found') return notFound(res, 'Cooperative not found');
  if (coopAccess.error === 'forbidden') return forbidden(res, 'That cooperative was not created by you');
  if (coopAccess.error) return serverError(res, 'Could not verify the cooperative');

  const row = farmerRow(req.body, req.user.userId);

  const { data: farmer, error } = await sb.from('farmers').insert(row).select().single();
  if (error) {
    logger.error({ err: error.message, code: error.code, hint: error.hint, details: error.details }, 'farmer insert failed');
    throw error;
  }

  // Insert farm profile (accept either nested `farm` object or flat fields).
  const farmInput = extractFarmInput(req.body);
  let farmProfileError = null;
  if (farmInput) {
    const { error: fpErr } = await sb.from('farm_profiles').insert(farmRow(farmer.id, farmInput));
    if (fpErr) {
      // Deliberately non-fatal: the farmer row is already committed and
      // losing it would be worse. But the failure is no longer invisible —
      // without a farm profile the farmer can never be scored (farm size is
      // the denominator of the yield component), so the agent is told.
      logger.error(
        { err: fpErr.message, code: fpErr.code, hint: fpErr.hint, details: fpErr.details, farmerId: farmer.id },
        'farm_profiles insert failed — farmer cannot be credit-scored until a farm is attached'
      );
      farmProfileError = fpErr.message;
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
      const { error: ninUpdErr } = await sb.from('farmers').update({
        nin_verification_status: result.status,
        nin_verification_payload: result.raw,
        verified_at: result.status === 'verified' ? new Date().toISOString() : null,
        verified_by_agent_id: result.status === 'verified' ? req.user.userId : null,
      }).eq('id', farmer.id);
      if (ninUpdErr) throw ninUpdErr;
    } catch (ninErr) {
      logger.warn({ err: ninErr.message, farmerId: farmer.id }, 'NIN verify failed (non-fatal)');
    }
  }

  // Refresh cooperative member count.
  // FIXED — wrapped in try/catch, but supabase-js RESOLVES with `{ error }`
  // instead of throwing, so the catch was unreachable and a failed count
  // refresh was silently dropped. `total_members` then drifted permanently
  // out of step with reality on every such failure.
  await refreshMemberCount(sb, row.cooperative_id);

  // FIXED — was fire-and-forget. On Vercel the lambda freezes when the
  // response is written, killing the recalculation, so a newly created farmer
  // often had no credit_scores row at all until something else happened to
  // trigger one.
  await safeRecalculateFarmer(farmer.id, { triggerReason: 'farmer_created' });

  const { error: notifyErr } = await sb.from('notifications').insert({
    user_id: req.user.userId,
    type: 'farmer_added',
    title: 'Farmer added',
    message: `${farmer.full_name} was added`,
    metadata: { farmerId: farmer.id, cooperativeId: row.cooperative_id },
  });
  if (notifyErr) logger.warn({ err: notifyErr.message, code: notifyErr.code }, 'farmer notification insert failed');

  await logActivity({ actor: req.user, action: 'farmer_created', entityType: 'farmer', entityId: farmer.id, metadata: { name: farmer.full_name }, req });

  const { data: hydrated, error: hydrateErr } = await sb
    .from('farmers')
    .select(`*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`)
    .eq('id', farmer.id)
    .maybeSingle();
  if (hydrateErr) logger.warn({ err: hydrateErr.message }, 'farmer hydrate after create failed');

  const body = shapeFarmer(hydrated || farmer);
  // Additive field only — present only when the farm profile failed to save.
  if (farmProfileError) body.farmProfileError = farmProfileError;
  return created(res, body);
}

async function update(req, res) {
  const sb = supabaseAdmin();
  const access = await assertFarmerAccess(
    sb,
    req.params.farmerId,
    req.user,
    'id, created_by_agent_id, cooperative_id'
  );
  if (access.error === 'not_found') return notFound(res, 'Farmer not found');
  if (access.error === 'forbidden') return forbidden(res);
  if (access.error) return serverError(res, 'Could not verify access to that farmer');
  const existing = access.farmer;

  const patch = farmerRow(req.body, existing.created_by_agent_id);
  delete patch.created_by_agent_id;
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

  // FIXED — a farmer could be moved into any cooperative, including one
  // belonging to a different agent, which silently transferred them (and
  // their score) into that cooperative's rollup.
  if (patch.cooperative_id && patch.cooperative_id !== existing.cooperative_id) {
    const coopAccess = await assertCooperativeAccess(sb, patch.cooperative_id, req.user);
    if (coopAccess.error === 'not_found') return notFound(res, 'Cooperative not found');
    if (coopAccess.error === 'forbidden') return forbidden(res, 'That cooperative was not created by you');
    if (coopAccess.error) return serverError(res, 'Could not verify the cooperative');
  }

  const farmInput = extractFarmInput(req.body);
  if (Object.keys(patch).length === 0 && !farmInput) {
    return badRequest(res, 'No fields to update');
  }

  let data = null;
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { data: updated, error } = await sb
      .from('farmers')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    data = updated;
  }

  if (farmInput) {
    // FIXED — this used `farmRow()`, the INSERT builder, which supplies every
    // column. See `farmPatch` above: a partial farm edit was wiping the crop
    // list, the farm photos and the GPS boundary.
    const { data: fp, error: fpReadErr } = await sb
      .from('farm_profiles')
      .select('id')
      .eq('farmer_id', existing.id)
      .maybeSingle();
    if (fpReadErr) throw fpReadErr;

    if (fp) {
      const farm = farmPatch(farmInput);
      if (Object.keys(farm).length > 0) {
        farm.updated_at = new Date().toISOString();
        const { error: e2 } = await sb.from('farm_profiles').update(farm).eq('id', fp.id);
        if (e2) throw e2;
      }
    } else {
      // No profile yet — this is effectively a create, so defaults apply.
      const { error: e2 } = await sb.from('farm_profiles').insert(farmRow(existing.id, farmInput));
      if (e2) throw e2;
    }
  }

  // If the farmer changed cooperative, both rollups are now stale.
  if (patch.cooperative_id && patch.cooperative_id !== existing.cooperative_id) {
    await refreshMemberCount(sb, existing.cooperative_id);
    await refreshMemberCount(sb, patch.cooperative_id);
    if (existing.cooperative_id) await safeRecalculateCooperative(existing.cooperative_id);
  }

  // FIXED — was fire-and-forget; the edited farm size (the denominator of the
  // yield score) never reached the score on Vercel.
  await safeRecalculateFarmer(existing.id, { triggerReason: 'farmer_updated' });
  await logActivity({ actor: req.user, action: 'farmer_updated', entityType: 'farmer', entityId: existing.id, req });

  const { data: hydrated, error: hydrateErr } = await sb
    .from('farmers')
    .select(`*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`)
    .eq('id', existing.id)
    .maybeSingle();
  if (hydrateErr) logger.warn({ err: hydrateErr.message }, 'farmer hydrate after update failed');
  return ok(res, shapeFarmer(hydrated || data));
}

async function remove(req, res) {
  const sb = supabaseAdmin();
  const access = await assertFarmerAccess(
    sb,
    req.params.farmerId,
    req.user,
    'id, full_name, created_by_agent_id, cooperative_id'
  );
  if (access.error === 'not_found') return notFound(res, 'Farmer not found');
  if (access.error === 'forbidden') return forbidden(res);
  if (access.error) return serverError(res, 'Could not verify access to that farmer');
  const existing = access.farmer;

  // FIXED — a farmer was deleted outright with the delete's error discarded.
  // `repayment_records.farmer_id` and `financing_requests.farmer_id` both
  // reference this row, so deleting a farmer who has borrowed money either
  // failed silently (the API still answered `{ deleted: true }` and the farmer
  // reappeared on refresh) or, via ON DELETE CASCADE on repayment_records,
  // destroyed the repayment history behind a live loan. A farmer with money
  // attached must not be removable through this endpoint.
  const [{ count: loanCount, error: loanErr }, { count: repayCount, error: repayErr }] = await Promise.all([
    sb.from('financing_requests').select('id', { count: 'exact', head: true }).eq('farmer_id', existing.id),
    sb.from('repayment_records').select('id', { count: 'exact', head: true }).eq('farmer_id', existing.id),
  ]);
  if (loanErr) throw loanErr;
  if (repayErr) throw repayErr;
  if ((loanCount || 0) > 0 || (repayCount || 0) > 0) {
    return conflict(
      res,
      'This farmer has financing or repayment records and cannot be deleted. Submit a change request instead so the history is preserved.',
      { farmerId: existing.id, financingRequests: loanCount || 0, repaymentRecords: repayCount || 0 }
    );
  }

  const { error: delErr } = await sb.from('farmers').delete().eq('id', existing.id);
  if (delErr) throw delErr;

  if (existing.cooperative_id) {
    await refreshMemberCount(sb, existing.cooperative_id);
    // FIXED — was fire-and-forget, so the cooperative average still counted
    // the deleted member until some later event recalculated it.
    await safeRecalculateCooperative(existing.cooperative_id);
  }

  await logActivity({ actor: req.user, action: 'farmer_deleted', entityType: 'farmer', entityId: existing.id, metadata: { name: existing.full_name }, req });
  return ok(res, { deleted: true });
}

async function verifyNin(req, res) {
  const sb = supabaseAdmin();
  // FIXED — `select('*')` pulled the whole farmer row, including the stored
  // `nin_verification_payload` (the full provider response, which carries the
  // resident's photo and address), just to read three fields.
  const access = await assertFarmerAccess(
    sb,
    req.params.farmerId,
    req.user,
    'id, full_name, nin, date_of_birth, created_by_agent_id'
  );
  if (access.error === 'not_found') return notFound(res, 'Farmer not found');
  if (access.error === 'forbidden') return forbidden(res);
  if (access.error) return serverError(res, 'Could not verify access to that farmer');
  const farmer = access.farmer;
  if (!farmer.nin) return badRequest(res, 'No NIN on file for this farmer');

  const nameParts = (farmer.full_name || '').trim().split(/\s+/).filter(Boolean);
  const result = await ninService.verifyNin({
    nin: farmer.nin,
    firstName: nameParts[0],
    lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined,
    dateOfBirth: farmer.date_of_birth,
  });

  // FIXED — the update discarded its error, so the endpoint reported a
  // verification result that had not been persisted. The agent saw "verified"
  // and the farmer stayed `pending` forever.
  const { error: updErr } = await sb.from('farmers').update({
    nin_verification_status: result.status,
    nin_verification_payload: result.raw,
    verified_at: result.status === 'verified' ? new Date().toISOString() : null,
    verified_by_agent_id: result.status === 'verified' ? req.user.userId : null,
  }).eq('id', farmer.id);
  if (updErr) throw updErr;

  return ok(res, { status: result.status, details: result.details });
}

async function getCreditScore(req, res) {
  const sb = supabaseAdmin();

  // FIXED — AUTHORISATION HOLE. This endpoint is mounted at
  // GET /api/agent/farmers/:farmerId/credit-score behind `requireFieldAgent`,
  // but it never checked who owns the farmer. Any active field agent could
  // read ANY farmer's credit score and full score history by id — every other
  // farmer endpoint in this controller checks `created_by_agent_id` and this
  // one simply did not.
  const access = await assertFarmerAccess(sb, req.params.farmerId, req.user, 'id, created_by_agent_id');
  if (access.error === 'not_found') return notFound(res, 'Farmer not found');
  if (access.error === 'forbidden') return forbidden(res);
  if (access.error) return serverError(res, 'Could not verify access to that farmer');

  const [{ data: score, error: scoreErr }, { data: history, error: histErr }] = await Promise.all([
    sb.from('credit_scores').select('*').eq('farmer_id', req.params.farmerId).maybeSingle(),
    sb
      .from('credit_score_history')
      .select('*')
      .eq('farmer_id', req.params.farmerId)
      .order('calculated_at', { ascending: false })
      .limit(20),
  ]);
  if (scoreErr) throw scoreErr;
  if (histErr) throw histErr;

  return ok(res, { current: score || null, history: history || [] });
}

// FIXED — `recalculateScore` was exported here but mounted on no route (the
// admin recalculate endpoint uses `credit.recalcFarmer`). Removed as dead code.

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
  const access = await assertFarmerAccess(
    sb,
    farmerId,
    req.user,
    'id, cooperative_id, created_by_agent_id, full_name'
  );
  if (access.error === 'not_found') return notFound(res, 'Farmer not found');
  if (access.error === 'forbidden') return forbidden(res);
  if (access.error) return serverError(res, 'Could not verify access to that farmer');
  const farmer = access.farmer;

  // Pull every financing request where farmer_id = this farmer
  // OR (farmer_id IS NULL AND cooperative_id = this farmer's coop) — those
  // are cooperative-level loans that benefit every member.
  // FIXED — every query in this handler discarded its error, so a failure
  // rendered as an empty, authoritative-looking "no financing history".
  const { data: byFarmer, error: byFarmerErr } = await sb
    .from('financing_requests')
    .select('*, cooperatives(id, name)')
    .eq('farmer_id', farmerId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (byFarmerErr) throw byFarmerErr;

  let coopLoans = [];
  if (farmer.cooperative_id) {
    const { data, error: coopLoanErr } = await sb
      .from('financing_requests')
      .select('*, cooperatives(id, name)')
      .is('farmer_id', null)
      .eq('cooperative_id', farmer.cooperative_id)
      .order('created_at', { ascending: false })
      .limit(500);
    if (coopLoanErr) throw coopLoanErr;
    coopLoans = data || [];
  }

  const all = [...(byFarmer || []), ...coopLoans];

  // For each request, pull the repayment trail and compute outstanding.
  const ids = all.map((r) => r.id);
  const repaymentsByRequest = new Map();
  if (ids.length) {
    // Chunked: a farmer in a large cooperative can accumulate enough loan ids
    // to overflow the PostgREST request URL, which previously returned an
    // error that was discarded — showing every loan as having no repayments.
    for (const group of chunk(ids)) {
      const { data: payments, error: payErr } = await sb
        .from('repayment_records')
        .select('*')
        .in('financing_request_id', group)
        .order('payment_date', { ascending: false })
        .limit(5000);
      if (payErr) throw payErr;
      for (const p of payments || []) {
        const arr = repaymentsByRequest.get(p.financing_request_id) || [];
        arr.push(p);
        repaymentsByRequest.set(p.financing_request_id, arr);
      }
    }
  }

  const enriched = all.map((r) => {
    const payments = repaymentsByRequest.get(r.id) || [];
    const active = payments.filter((p) => !p.voided);
    const paid = active.reduce((acc, p) => {
      const amt = Number(p.amount_paid);
      return Number.isFinite(amt) && amt > 0 ? acc + amt : acc;
    }, 0);
    // FIXED — this read `approved_amount || disbursed_amount || loan_amount`
    // while the credit-score engine used `loan_amount` alone and
    // `repayments.create` used a third variant. The same loan showed three
    // different outstanding balances depending on the screen.
    // `loanPrincipal` is now the one shared definition.
    const principal = loanPrincipal(r);
    const outstanding = Math.max(0, Math.round((principal - paid) * 100) / 100);
    const fullyRepaid = principal > 0 && paid >= principal;
    return {
      ...r,
      summary: {
        principal,
        totalPaid: Math.round(paid * 100) / 100,
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

  const access = await assertFarmerAccess(
    sb,
    farmerId,
    req.user,
    'id, created_by_agent_id, cooperative_id, farm_profiles(id)'
  );
  if (access.error === 'not_found') return notFound(res, 'Farmer not found');
  if (access.error === 'forbidden') return forbidden(res);
  if (access.error) return serverError(res, 'Could not verify access to that farmer');
  const farmer = access.farmer;

  const m = measureFarm(gpsPolygon);
  if (!m) return badRequest(res, 'Invalid polygon — need at least 3 valid {lat,lng} points');

  const sizeAcres = overrideSizeAcres != null ? Number(overrideSizeAcres) : m.acres;
  // FIXED — `overrideSizeAcres` went straight through as the farm size, which
  // is the denominator of the yield-per-hectare calculation. The validator
  // allows `min(0)`, so a 0 produced a division by zero; the engine's guard
  // then scored the farmer 0 on yield with no indication why.
  if (!Number.isFinite(sizeAcres) || sizeAcres <= 0) {
    return badRequest(res, 'Farm size must be greater than zero acres', { overrideSizeAcres });
  }
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
  // FIXED — both writes discarded their error, so a failed save still returned
  // the computed acreage to the app as though it had been stored: the agent
  // walked the boundary, saw the area, and nothing was persisted.
  if (existingProfile?.id) {
    const { error: upErr } = await sb.from('farm_profiles').update(patch).eq('id', existingProfile.id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await sb.from('farm_profiles').insert({ farmer_id: farmerId, ...patch });
    if (insErr) throw insErr;
  }

  // Farm size feeds yield-per-hectare; recalc the score.
  // FIXED — fire-and-forget, so the freshly measured farm size never reached
  // the score on Vercel.
  await safeRecalculateFarmer(farmerId, { triggerReason: 'farm_mapped' });

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
  getFinancingHistory,
};
