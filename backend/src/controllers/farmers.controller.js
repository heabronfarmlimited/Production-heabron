'use strict';

const { supabaseAdmin } = require('../config/supabase');
const consentRules = require('../services/consent/rules');
const { liveConsentFor } = require('./consent.controller');
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
const { summarizeFarms, shapeFarm, shapeFarms, farmAcres } = require('../services/farms');
const {
  extractFarmInput,
  farmRow,
  farmPatch,
} = require('../services/farms/mapping');
const { createOnce, findByClientRequestId } = require('../utils/idempotency');
const logger = require('../utils/logger');

/**
 * Ceiling on farms per farmer.
 *
 * Not a business rule from the specification — a guard. The set is read
 * whole on every farmer request, and an unbounded list behind one farmer id
 * is an easy way for a buggy client retrying "Add Another Farm" to make that
 * farmer's record unreadable. Twenty is far above any real smallholder's
 * plot count.
 */
const MAX_FARMS_PER_FARMER = 20;

// All farm-profile keys the API accepts at the top level OR nested under `farm`.
// We tolerate both shapes because the mobile client (Flutter) flattens nested
// objects in some forms.
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

  /**
   * Replay check, BEFORE the consent gate.
   *
   * Order matters here and it is easy to get wrong. The first request
   * back-links its consent record to the farmer it created, so by the time a
   * retry arrives that consent has an `entity_id` — and the gate below
   * rejects it with "That consent record is already attached to a farmer".
   * With the replay check after the gate, every retry got a 409 the agent
   * could do nothing about, and the idempotency key never came into play at
   * all. Checking the key first means a retry is answered with the farmer it
   * already created.
   */
  const replay = await findByClientRequestId(
    sb,
    'farmers',
    req.body.clientRequestId,
    'id, created_by_agent_id'
  );
  if (replay.error) throw replay.error;
  if (replay.row) {
    // Scoped to the caller: a client request id is client-chosen, so without
    // this an agent who guessed another agent's key would be handed their
    // farmer.
    if (
      replay.row.created_by_agent_id !== req.user.userId &&
      !ADMIN_ROLES.includes(req.user.role)
    ) {
      return forbidden(res);
    }
    logger.info(
      { farmerId: replay.row.id, clientRequestId: req.body.clientRequestId },
      'farmer create replayed — returning the existing record'
    );
    const { data: hydratedReplay } = await sb
      .from('farmers')
      .select(`*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`)
      .eq('id', replay.row.id)
      .maybeSingle();
    // 200, not 201: this request created nothing.
    return ok(res, shapeFarmer(hydratedReplay));
  }

  // FIXED — nothing verified the cooperative. An agent could attach a new
  // farmer to ANY cooperative id, including another agent's, which then
  // counted that farmer toward the other agent's member total and their
  // cooperative's average credit score.
  const coopAccess = await assertCooperativeAccess(sb, req.body.cooperativeId, req.user);
  if (coopAccess.error === 'not_found') return notFound(res, 'Cooperative not found');
  if (coopAccess.error === 'forbidden') return forbidden(res, 'That cooperative was not created by you');
  if (coopAccess.error) return serverError(res, 'Could not verify the cooperative');

  /**
   * Consent gate, Flow B (data consent specification, section 4).
   *
   * "A farmer profile cannot be submitted until Flow B is complete. The
   * cooperative must already have a completed Flow A."
   *
   * Enforced on the server, not just in the app: a farmer record created
   * without consent is one that cannot lawfully be scored or shared, and the
   * mobile client is not the place that decision can be trusted.
   *
   * `consentId` comes from POST /agent/consent, which the app calls before
   * submitting the profile.
   */
  const coopConsent = await liveConsentFor(sb, 'cooperative', req.body.cooperativeId);
  if (!consentRules.satisfiesGate(coopConsent)) {
    return conflict(
      res,
      'This cooperative has no consent on record. Complete the cooperative consent before adding farmers.',
      { cooperativeId: req.body.cooperativeId, gate: 'cooperative_consent' }
    );
  }

  if (!req.body.consentId) {
    return conflict(
      res,
      'Farmer consent is required before the profile can be submitted.',
      { gate: 'farmer_consent' }
    );
  }

  const { data: farmerConsent, error: fcErr } = await sb
    .from('consent_records')
    .select('id, entity_type, entity_id, status, third_party_sharing')
    .eq('id', req.body.consentId)
    .maybeSingle();
  if (fcErr) throw fcErr;

  if (!farmerConsent || farmerConsent.entity_type !== 'farmer') {
    return badRequest(res, 'That consent record was not found, or is not a farmer consent.');
  }
  if (!consentRules.satisfiesGate(farmerConsent)) {
    return conflict(res, `That consent record is ${farmerConsent.status}.`, { gate: 'farmer_consent' });
  }
  if (farmerConsent.entity_id) {
    // Already attached to a farmer: re-using it would record one person's
    // consent against another's profile.
    return conflict(res, 'That consent record is already attached to a farmer.', {
      gate: 'farmer_consent',
    });
  }

  const row = farmerRow(req.body, req.user.userId);
  row.consent_record_id = farmerConsent.id;
  row.consent_status = farmerConsent.status;
  row.third_party_sharing = farmerConsent.third_party_sharing;
  row.client_request_id = req.body.clientRequestId || null;

  /**
   * Duplicate-safe creation (v2 flow: "duplicate-safe client UUID").
   *
   * Onboarding runs on a field connection. The agent taps again when nothing
   * seems to be happening, and the offline queue retries a request whose
   * response was lost after the server had already committed. Both produced
   * two farmer records for one person — two credit scores, a wrong member
   * count, and a lender reading whichever one they found.
   *
   * With a key, a repeat returns the farmer that already exists. Everything
   * after this point is skipped on a replay: the NIN check, the member-count
   * refresh, the score recalculation, the notification and the activity log
   * all ran the first time, and running them again is how one farmer ends up
   * with three "onboarded" entries in the audit trail.
   */
  const creation = await createOnce(sb, 'farmers', row.client_request_id, () =>
    sb.from('farmers').insert(row).select().single()
  );
  if (creation.error) throw creation.error;

  const farmer = creation.row;

  if (creation.replayed) {
    // Only reachable when a concurrent retry committed between the replay
    // check above and this insert — the unique index caught it.
    logger.info(
      { farmerId: farmer.id, clientRequestId: row.client_request_id },
      'farmer create lost the race to a concurrent retry — returning that record'
    );
    const { data: hydratedReplay } = await sb
      .from('farmers')
      .select(`*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`)
      .eq('id', farmer.id)
      .maybeSingle();
    // 200, not 201: nothing was created by this request.
    return ok(res, shapeFarmer(hydratedReplay || farmer));
  }

  // Close the consent link in the other direction. The consent record is
  // created before the farmer exists, so entity_id is only knowable now; until
  // it is set, the record cannot be found by entity and would be offered again
  // as unattached.
  //
  // `createOnce` throws on a real insert failure above, so reaching here means
  // the farmer exists — the old `if (!error && farmer)` guard and the
  // `if (error) throw` that followed it are gone with it.
  {
    const { error: linkErr } = await sb
      .from('consent_records')
      .update({ entity_id: farmer.id })
      .eq('id', row.consent_record_id)
      .is('entity_id', null);
    if (linkErr) {
      logger.error(
        { err: linkErr.message, consentId: row.consent_record_id, farmerId: farmer.id },
        'consent back-link failed — the farmer exists but their consent is not attached'
      );
    }
  }

  // Insert farm profile (accept either nested `farm` object or flat fields).
  const farmInput = extractFarmInput(req.body);
  let farmProfileError = null;
  if (farmInput) {
    // The farm created alongside the farmer is their primary one.
    const { error: fpErr } = await sb
      .from('farm_profiles')
      .insert(farmRow(farmer.id, farmInput, { isPrimary: true }));
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
    // FIXED — this was `.maybeSingle()`, which PostgREST fails outright
    // (PGRST116) when more than one row matches. As soon as a farmer had a
    // second farm, every edit to that farmer returned a 500 — including edits
    // that touched no farm field at all, since `farmInput` is non-null
    // whenever any farm key is present in the body. The nested `farm` object
    // is documented as editing the farmer's PRIMARY farm, so that is what is
    // selected; a specific farm is edited through
    // PATCH /farmers/:farmerId/farms/:farmId.
    const { data: fpRows, error: fpReadErr } = await sb
      .from('farm_profiles')
      .select('id, is_primary, created_at')
      .eq('farmer_id', existing.id)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);
    if (fpReadErr) throw fpReadErr;
    const fp = fpRows?.[0] || null;

    if (fp) {
      const farm = farmPatch(farmInput);
      if (Object.keys(farm).length > 0) {
        farm.updated_at = new Date().toISOString();
        const { error: e2 } = await sb.from('farm_profiles').update(farm).eq('id', fp.id);
        if (e2) throw e2;
      }
    } else {
      // No profile yet — this is effectively a create, so defaults apply and
      // the farmer's only farm becomes their primary.
      const { error: e2 } = await sb
        .from('farm_profiles')
        .insert(farmRow(existing.id, farmInput, { isPrimary: true }));
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
  const { gpsPolygon, overrideSizeAcres, farmId } = req.body;

  const access = await assertFarmerAccess(
    sb,
    farmerId,
    req.user,
    'id, created_by_agent_id, cooperative_id, farm_profiles(id, is_primary, created_at)'
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

  // Which farm is being mapped. A farmer can hold several, so `farmId` names
  // one; without it the primary farm is mapped, which is what the single-farm
  // map screen means. Taking `[0]` off the embedded array (the old code)
  // mapped an arbitrary plot — the agent could walk farm 2's boundary and
  // have it saved onto farm 1.
  const ownFarms = summarizeFarms(farmer.farm_profiles).farms;
  let existingProfile = null;
  if (farmId) {
    existingProfile = ownFarms.find((f) => f.id === farmId) || null;
    if (!existingProfile) {
      return notFound(res, 'That farm does not belong to this farmer');
    }
  } else {
    existingProfile = ownFarms[0] || null;
  }

  // FIXED — both writes discarded their error, so a failed save still returned
  // the computed acreage to the app as though it had been stored: the agent
  // walked the boundary, saw the area, and nothing was persisted.
  if (existingProfile?.id) {
    const { error: upErr } = await sb.from('farm_profiles').update(patch).eq('id', existingProfile.id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await sb
      .from('farm_profiles')
      .insert({ farmer_id: farmerId, is_primary: true, ...patch });
    if (insErr) throw insErr;
  }

  // Farm size feeds yield-per-hectare; recalc the score.
  // FIXED — fire-and-forget, so the freshly measured farm size never reached
  // the score on Vercel.
  await safeRecalculateFarmer(farmerId, { triggerReason: 'farm_mapped' });

  await logActivity({ actor: req.user, action: 'farm_mapped', entityType: 'farm_profile', entityId: existingProfile?.id || farmerId, metadata: { acres: m.acres, farmerId }, req });
  return ok(res, {
    farmerId,
    farmId: existingProfile?.id ?? null,
    computedAreaAcres: m.acres,
    computedAreaHectares: m.hectares,
    areaSqMeters: m.areaSqM,
    centroid: m.centroid,
    farmSizeAcres: sizeAcres,
    gpsMapped: true,
  });
}

// ---------------------------------------------------------------------------
// Farms within a farmer ("Add Another Farm")
//
// A farmer may hold several plots. These five handlers manage the set; the
// nested `farm` object on POST/PATCH /farmers still creates and edits the
// farmer's PRIMARY farm, so nothing about the existing single-farm flow
// changes.
// ---------------------------------------------------------------------------

/** Load a farmer's farms after checking the caller may see that farmer. */
async function loadOwnFarms(req, res) {
  const sb = supabaseAdmin();
  const { farmerId } = req.params;
  const access = await assertFarmerAccess(
    sb,
    farmerId,
    req.user,
    'id, created_by_agent_id, cooperative_id, farm_profiles(*)'
  );
  if (access.error === 'not_found') {
    notFound(res, 'Farmer not found');
    return null;
  }
  if (access.error === 'forbidden') {
    forbidden(res);
    return null;
  }
  if (access.error) {
    serverError(res, 'Could not verify access to that farmer');
    return null;
  }
  return { sb, farmerId, farms: summarizeFarms(access.farmer.farm_profiles).farms };
}

async function listFarms(req, res) {
  const loaded = await loadOwnFarms(req, res);
  if (!loaded) return undefined;
  const summary = summarizeFarms(loaded.farms);
  return ok(res, {
    farmer_id: loaded.farmerId,
    farms: shapeFarms(loaded.farms),
    land: {
      farm_count: summary.farmCount,
      total_land_acres: summary.totalAcres,
      mapped_land_acres: summary.mappedAcres,
      mapped_farm_count: summary.mappedCount,
      fully_mapped: summary.fullyMapped,
      crops: summary.crops,
      primary_crop: summary.primaryCrop,
    },
  });
}

async function addFarm(req, res) {
  const loaded = await loadOwnFarms(req, res);
  if (!loaded) return undefined;
  const { sb, farmerId, farms } = loaded;

  if (farms.length >= MAX_FARMS_PER_FARMER) {
    return badRequest(
      res,
      `A farmer can hold at most ${MAX_FARMS_PER_FARMER} farms. Remove one before adding another.`,
      { farmCount: farms.length }
    );
  }

  // The first farm a farmer gets is their primary one, whichever endpoint
  // created it. After that, new farms are secondary until promoted.
  const isPrimary = farms.length === 0;

  const { data: inserted, error } = await sb
    .from('farm_profiles')
    .insert(farmRow(farmerId, req.body, { isPrimary }))
    .select('*')
    .single();
  if (error) throw error;

  // Land size is the denominator of the production score, so adding a farm
  // changes the score. Awaited, not fire-and-forget: Vercel freezes the
  // lambda when the response is sent.
  await safeRecalculateFarmer(farmerId, { triggerReason: 'farm_added' });
  await logActivity({
    actor: req.user,
    action: 'farm_added',
    entityType: 'farm_profile',
    entityId: inserted.id,
    metadata: { farmerId, acres: farmAcres(inserted) },
    req,
  });

  return created(res, shapeFarm(inserted, farms.length));
}

async function updateFarm(req, res) {
  const loaded = await loadOwnFarms(req, res);
  if (!loaded) return undefined;
  const { sb, farmerId, farms } = loaded;

  const index = farms.findIndex((f) => f.id === req.params.farmId);
  if (index === -1) return notFound(res, 'That farm does not belong to this farmer');

  // Partial update only. `farmPatch` writes just the keys that were sent, so
  // an edit that omits the crop list or the boundary leaves them as they are
  // rather than clearing them.
  const patch = farmPatch(req.body);
  if (Object.keys(patch).length === 0) return badRequest(res, 'No fields to update');
  patch.updated_at = new Date().toISOString();

  const { data: updated, error } = await sb
    .from('farm_profiles')
    .update(patch)
    .eq('id', req.params.farmId)
    // Scoped to the farmer as well as the row, so a farm id from another
    // farmer cannot be edited even if the ownership check were bypassed.
    .eq('farmer_id', farmerId)
    .select('*');
  if (error) throw error;
  if (!updated || updated.length === 0) {
    // An UPDATE that matches nothing reports no error through PostgREST, so
    // without this the agent would be told the edit saved when it did not.
    return serverError(res, 'The farm was not updated. Please try again.');
  }

  await safeRecalculateFarmer(farmerId, { triggerReason: 'farm_updated' });
  await logActivity({
    actor: req.user,
    action: 'farm_updated',
    entityType: 'farm_profile',
    entityId: req.params.farmId,
    metadata: { farmerId, fields: Object.keys(patch) },
    req,
  });

  return ok(res, shapeFarm(updated[0], index));
}

async function setPrimaryFarm(req, res) {
  const loaded = await loadOwnFarms(req, res);
  if (!loaded) return undefined;
  const { sb, farmerId, farms } = loaded;

  const target = farms.find((f) => f.id === req.params.farmId);
  if (!target) return notFound(res, 'That farm does not belong to this farmer');
  if (target.is_primary) return ok(res, shapeFarm(target, 0));

  // The unique index allows one primary per farmer, so the old one is cleared
  // first. These are two statements: if the second fails the farmer is left
  // with no primary, which the read path tolerates (it falls back to the
  // oldest farm) — unlike the reverse order, which would fail outright.
  const { error: clearErr } = await sb
    .from('farm_profiles')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('farmer_id', farmerId)
    .eq('is_primary', true);
  if (clearErr) throw clearErr;

  const { data: promoted, error: setErr } = await sb
    .from('farm_profiles')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('id', req.params.farmId)
    .eq('farmer_id', farmerId)
    .select('*');
  if (setErr) throw setErr;
  if (!promoted || promoted.length === 0) {
    return serverError(res, 'The main farm was not changed. Please try again.');
  }

  // The primary farm's crop is the farmer's main crop, which the score reads.
  await safeRecalculateFarmer(farmerId, { triggerReason: 'primary_farm_changed' });
  await logActivity({
    actor: req.user,
    action: 'farm_primary_changed',
    entityType: 'farm_profile',
    entityId: req.params.farmId,
    metadata: { farmerId },
    req,
  });

  return ok(res, shapeFarm(promoted[0], 0));
}

async function removeFarm(req, res) {
  const loaded = await loadOwnFarms(req, res);
  if (!loaded) return undefined;
  const { sb, farmerId, farms } = loaded;

  const target = farms.find((f) => f.id === req.params.farmId);
  if (!target) return notFound(res, 'That farm does not belong to this farmer');

  // A farmer with no farm cannot be credit-scored at all (land size is the
  // denominator of the production score), so the last farm is not deletable.
  // Removing the farmer is the operation that means "this record is wrong".
  if (farms.length <= 1) {
    return conflict(
      res,
      'This is the farmer\'s only farm and cannot be removed — a farmer without a farm cannot be credit-scored. Edit it instead, or remove the farmer.'
    );
  }

  // Production and delivery records are recorded against the FARMER, not the
  // farm, so deleting a farm does not orphan them — but it does change the
  // land the existing yields are measured against, which is why the score is
  // recalculated below.
  const { data: deleted, error } = await sb
    .from('farm_profiles')
    .delete()
    .eq('id', req.params.farmId)
    .eq('farmer_id', farmerId)
    .select('id, is_primary');
  if (error) throw error;
  if (!deleted || deleted.length === 0) {
    return serverError(res, 'The farm was not removed. Please try again.');
  }

  // If the primary farm went, promote the oldest survivor so the farmer is
  // never left without one.
  if (deleted[0].is_primary) {
    const next = farms.find((f) => f.id !== req.params.farmId);
    if (next) {
      const { error: promoteErr } = await sb
        .from('farm_profiles')
        .update({ is_primary: true, updated_at: new Date().toISOString() })
        .eq('id', next.id)
        .eq('farmer_id', farmerId);
      if (promoteErr) {
        logger.error(
          { err: promoteErr.message, farmerId, farmId: next.id },
          'primary farm promotion after delete failed — farmer has no primary farm'
        );
      }
    }
  }

  await safeRecalculateFarmer(farmerId, { triggerReason: 'farm_removed' });
  await logActivity({
    actor: req.user,
    action: 'farm_removed',
    entityType: 'farm_profile',
    entityId: req.params.farmId,
    metadata: { farmerId },
    req,
  });

  return ok(res, { id: req.params.farmId, deleted: true });
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
  listFarms,
  addFarm,
  updateFarm,
  setPrimaryFarm,
  removeFarm,
};
