'use strict';

const { supabaseAdmin } = require('../config/supabase');
const consentRules = require('../services/consent/rules');
const { ok, created, notFound, forbidden, paginated, badRequest, conflict, serverError } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { cooperativeLandTotal } = require('../services/farms');
const { createOnce, findByClientRequestId } = require('../utils/idempotency');
const { logActivity } = require('../utils/activity');
const { ADMIN_ROLES } = require('../middleware/auth');
const { shapeFarmers } = require('../utils/shapeFarmer');
const { assertCooperativeAccess } = require('../utils/ownership');
const logger = require('../utils/logger');
const { containsPattern } = require('../utils/search');

function toRow(input, userId) {
  return {
    name: input.name,
    registration_number: input.registrationNumber,
    leader_name: input.leaderName,
    leader_phone: input.leaderPhone,
    // FIXED — `primary_crop` was never written by any endpoint, so every
    // cooperative had a NULL main crop while the column was read by the
    // credit report and listed as approvable on change requests.
    primary_crop: input.primaryCrop,
    crops_supported: input.cropsSupported,
    state: input.state,
    lga: input.lga,
    address: input.address,
    // `estimated_land_size` is deliberately NOT written. The v2 user flow
    // retired the question ("Do not show or ask for cooperative land size");
    // the land total is derived from member farms at read time. The column
    // still exists so historical estimates are not lost, but nothing writes
    // it any more.
    logo_url: input.logoUrl,
    gps_lat: input.gpsLat,
    gps_lng: input.gpsLng,
    gps_polygon: input.gpsPolygon || null,
    created_by_agent_id: userId,
  };
}

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { search, state, lga, crop, agentId } = req.query;

  let q = sb.from('cooperatives').select(
    `*, cooperative_credit_scores(average_score, cooperative_tier, total_farmers)`,
    { count: 'exact' }
  );

  if (req.user.role === 'field_agent') {
    q = q.eq('created_by_agent_id', req.user.userId);
  } else if (ADMIN_ROLES.includes(req.user.role) && agentId) {
    q = q.eq('created_by_agent_id', agentId);
  }
  if (search) q = q.ilike('name', containsPattern(search));
  if (state) q = q.eq('state', state);
  if (lga) q = q.eq('lga', lga);
  if (crop) q = q.contains('crops_supported', [crop]);

  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;

  // Defensive tier fill-in for any legacy rows that still have a NULL tier.
  // Migration 003 backfills the DB, but new clients still hitting older
  // environments shouldn't see "null" — render 'D' (no-data tier) instead.
  const shaped = (data || []).map((row) => ({
    ...row,
    cooperative_tier: row.cooperative_tier || 'D',
    average_credit_score: row.average_credit_score ?? 0,
  }));

  return paginated(res, shaped, { page, pageSize, total: count || 0 });
}

async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('cooperatives')
    .select(`*, cooperative_credit_scores(*)`)
    .eq('id', req.params.cooperativeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res, 'Cooperative not found');
  if (req.user.role === 'field_agent' && data.created_by_agent_id !== req.user.userId) {
    return forbidden(res, 'You did not create this cooperative');
  }

  // FIXED — all three count queries discarded their error, so a failure read
  // as `count: null` and rendered as a confident "0 farmers, 0 deliveries,
  // 0 financing requests" on the cooperative detail screen.
  const [farmersRes, deliveriesRes, financingRes, landRes] = await Promise.all([
    sb.from('farmers').select('id', { count: 'exact', head: true }).eq('cooperative_id', data.id),
    sb.from('produce_deliveries').select('id', { count: 'exact', head: true }).eq('cooperative_id', data.id),
    sb.from('financing_requests').select('id', { count: 'exact', head: true }).eq('cooperative_id', data.id),
    // v2: the cooperative's land is summed from its members' farms rather
    // than read off a figure an agent typed. Only the columns the sum needs,
    // so this stays cheap on a large cooperative.
    sb
      .from('farmers')
      .select('id, farm_profiles(id, farm_size_acres, computed_area_acres, is_primary, created_at)')
      .eq('cooperative_id', data.id)
      .limit(5000),
  ]);
  for (const r of [farmersRes, deliveriesRes, financingRes, landRes]) {
    if (r.error) throw r.error;
  }

  const land = cooperativeLandTotal(landRes.data || []);

  // Defensive tier fill-in for legacy rows that pre-date the seed-on-create
  // patch — never render "null" to the mobile client.
  const effectiveTier = data.cooperative_tier || 'D';

  return ok(res, {
    ...data,
    cooperative_tier: effectiveTier,
    average_credit_score: data.average_credit_score ?? 0,
    // Retired field, blanked in the response so no client renders a stale
    // agent-entered estimate next to the derived total.
    estimated_land_size: null,
    // The derived land total, and the member coverage behind it — "40
    // members, 31 with farms" is what tells an agent there is work left.
    land,
    stats: {
      farmers: farmersRes.count || 0,
      deliveries: deliveriesRes.count || 0,
      financingRequests: financingRes.count || 0,
      landSizeAcres: land.total_land_acres,
      farms: land.farm_count,
      membersWithFarms: land.members_with_farms,
      membersWithoutFarms: land.members_without_farms,
    },
  });
}

async function create(req, res) {
  const sb = supabaseAdmin();
  const row = toRow(req.body, req.user.userId);

  /**
   * Replay check, BEFORE the consent gate.
   *
   * The first request back-links its consent record to the cooperative it
   * created, so by the time a retry arrives that consent has an `entity_id`
   * and the gate below rejects it with "That consent record is already
   * attached to a cooperative". With the check after the gate, every retry
   * got a 409 the agent could do nothing about and the idempotency key was
   * never reached.
   */
  const replay = await findByClientRequestId(
    sb,
    'cooperatives',
    req.body.clientRequestId,
    'id, created_by_agent_id'
  );
  if (replay.error) throw replay.error;
  if (replay.row) {
    // A client request id is client-chosen, so the row is only handed back
    // to the agent who created it.
    if (
      replay.row.created_by_agent_id !== req.user.userId &&
      !ADMIN_ROLES.includes(req.user.role)
    ) {
      return forbidden(res);
    }
    logger.info(
      { cooperativeId: replay.row.id, clientRequestId: req.body.clientRequestId },
      'cooperative create replayed — returning the existing record'
    );
    const { data: existing } = await sb
      .from('cooperatives')
      .select('*, cooperative_credit_scores(*)')
      .eq('id', replay.row.id)
      .maybeSingle();
    // 200, not 201: this request created nothing.
    return ok(res, existing);
  }

  /**
   * Consent gate, Flow A (data consent specification, section 3).
   *
   * "A cooperative cannot be saved as active, and no farmer can be added to
   * it, until Flow A is complete."
   *
   * The consent record is captured first (POST /agent/consent) and its id
   * passed here. Enforced server-side: a cooperative registered without
   * consent is one whose members' data cannot lawfully be scored or shared.
   */
  if (!req.body.consentId) {
    return conflict(res, 'Cooperative consent is required before the cooperative can be registered.', {
      gate: 'cooperative_consent',
    });
  }

  const { data: consent, error: consentErr } = await sb
    .from('consent_records')
    .select('id, entity_type, entity_id, status, third_party_sharing')
    .eq('id', req.body.consentId)
    .maybeSingle();
  if (consentErr) throw consentErr;

  if (!consent || consent.entity_type !== 'cooperative') {
    return badRequest(res, 'That consent record was not found, or is not a cooperative consent.');
  }
  if (!consentRules.satisfiesGate(consent)) {
    return conflict(res, `That consent record is ${consent.status}.`, { gate: 'cooperative_consent' });
  }
  if (consent.entity_id) {
    return conflict(res, 'That consent record is already attached to a cooperative.', {
      gate: 'cooperative_consent',
    });
  }

  /**
   * Duplicate-safe creation (v2 flow: "duplicate-safe client UUID").
   *
   * This matters more for cooperatives than for farmers: a duplicate splits
   * the members across two records, so NEITHER one's average credit score is
   * right. `registration_number` is already unique but it is OPTIONAL, so a
   * cooperative registered without one had no protection at all against a
   * double tap or a retried request whose response was lost.
   */
  const clientRequestId = req.body.clientRequestId || null;
  const creation = await createOnce(sb, 'cooperatives', clientRequestId, () =>
    sb
      .from('cooperatives')
      .insert({
        ...row,
        client_request_id: clientRequestId,
        cooperative_tier: 'D',
        average_credit_score: 0,
        total_members: 0,
        consent_record_id: consent.id,
        consent_status: consent.status,
        third_party_sharing: consent.third_party_sharing,
      })
      .select()
      .single()
  );
  if (creation.error) throw creation.error;

  const data = creation.row;

  if (creation.replayed) {
    // Only reachable when a concurrent retry committed between the replay
    // check at the top and this insert — the unique index caught it. The
    // consent back-link, credit-score seed, notification and activity log
    // all ran on the request that won.
    logger.info(
      { cooperativeId: data.id, clientRequestId },
      'cooperative create lost the race to a concurrent retry — returning that record'
    );
    return ok(res, data);
  }

  // Close the link the other way: the consent was captured before the
  // cooperative existed, so entity_id is only knowable now.
  {
    const { error: linkErr } = await sb
      .from('consent_records')
      .update({ entity_id: data.id })
      .eq('id', consent.id)
      .is('entity_id', null);
    if (linkErr) {
      logger.error(
        { err: linkErr.message, consentId: consent.id, cooperativeId: data.id },
        'consent back-link failed — the cooperative exists but its consent is not attached'
      );
    }
  }

  // FIXED — wrapped in try/catch, but supabase-js resolves with `{ error }`
  // rather than throwing, so the catch was unreachable and a failed seed was
  // invisible. Without this row the cooperative has no credit-score record at
  // all, which the partner directory renders as a blank tier.
  {
    const { error: seedErr } = await sb.from('cooperative_credit_scores').upsert(
      {
        cooperative_id: data.id,
        average_score: 0,
        cooperative_tier: 'D',
        total_farmers: 0,
        scored_farmers: 0,
        tier_a_count: 0,
        tier_b_count: 0,
        tier_c_count: 0,
        tier_d_count: 0,
        last_calculated_at: new Date().toISOString(),
      },
      { onConflict: 'cooperative_id' }
    );
    if (seedErr) {
      logger.warn(
        { err: seedErr.message, code: seedErr.code, cooperativeId: data.id },
        'cooperative_credit_scores seed failed'
      );
    }
  }

  const { error: notifyErr } = await sb.from('notifications').insert({
    user_id: req.user.userId,
    type: 'cooperative_added',
    title: 'Cooperative created',
    message: `You added "${data.name}"`,
    metadata: { cooperativeId: data.id },
  });
  if (notifyErr) logger.warn({ err: notifyErr.message, code: notifyErr.code }, 'cooperative notification failed');

  await logActivity({ actor: req.user, action: 'cooperative_created', entityType: 'cooperative', entityId: data.id, metadata: { name: data.name }, req });
  return created(res, data);
}

async function update(req, res) {
  const sb = supabaseAdmin();
  const access = await assertCooperativeAccess(sb, req.params.cooperativeId, req.user);
  if (access.error === 'not_found') return notFound(res, 'Cooperative not found');
  if (access.error === 'forbidden') return forbidden(res);
  if (access.error) return serverError(res, 'Could not verify access to that cooperative');
  const existing = access.cooperative;

  const patch = toRow(req.body, existing.created_by_agent_id);
  delete patch.created_by_agent_id;
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

  // FIXED — an empty patch reached PostgREST as `update({})`, which errors,
  // and `.single()` turned that into a generic 500. (The Joi layer was also
  // injecting creation defaults here, so "empty" PATCHes were in fact wiping
  // `crops_supported` — see validators/domain.js.)
  if (Object.keys(patch).length === 0) return badRequest(res, 'No fields to update');
  patch.updated_at = new Date().toISOString();

  const { data, error } = await sb.from('cooperatives').update(patch).eq('id', existing.id).select().single();
  if (error) throw error;
  await logActivity({ actor: req.user, action: 'cooperative_updated', entityType: 'cooperative', entityId: data.id, req });
  return ok(res, data);
}

async function remove(req, res) {
  const sb = supabaseAdmin();
  const access = await assertCooperativeAccess(sb, req.params.cooperativeId, req.user);
  if (access.error === 'not_found') return notFound(res, 'Cooperative not found');
  if (access.error === 'forbidden') return forbidden(res);
  if (access.error) return serverError(res, 'Could not verify access to that cooperative');
  const existing = access.cooperative;

  // FIXED — the delete discarded its error AND the schema cascades:
  // `financing_requests.cooperative_id` is ON DELETE CASCADE, so deleting a
  // cooperative destroyed every loan raised against it (and, through
  // `repayment_records`' own cascade, the entire repayment history behind
  // them). `farmers.cooperative_id` is ON DELETE SET NULL, so the members
  // were silently orphaned out of every cooperative rollup. The endpoint
  // answered `{ deleted: true }` either way.
  const [{ count: memberCount, error: memberErr }, { count: loanCount, error: loanErr }] = await Promise.all([
    sb.from('farmers').select('id', { count: 'exact', head: true }).eq('cooperative_id', existing.id),
    sb.from('financing_requests').select('id', { count: 'exact', head: true }).eq('cooperative_id', existing.id),
  ]);
  if (memberErr) throw memberErr;
  if (loanErr) throw loanErr;

  if ((memberCount || 0) > 0 || (loanCount || 0) > 0) {
    return conflict(
      res,
      'This cooperative still has members or financing records and cannot be deleted. Move or remove the farmers first.',
      { cooperativeId: existing.id, members: memberCount || 0, financingRequests: loanCount || 0 }
    );
  }

  const { error: delErr } = await sb.from('cooperatives').delete().eq('id', existing.id);
  if (delErr) throw delErr;

  await logActivity({ actor: req.user, action: 'cooperative_deleted', entityType: 'cooperative', entityId: existing.id, metadata: { name: existing.name }, req });
  return ok(res, { deleted: true });
}

async function listFarmers(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);

  // FIXED — AUTHORISATION HOLE. Mounted at
  // GET /api/agent/cooperatives/:cooperativeId/farmers behind
  // `requireFieldAgent`, this handler never checked who owns the cooperative.
  // Any active field agent could enumerate ANY other agent's entire farmer
  // roster by cooperative id, and because the select is `*` the response
  // carried each farmer's NIN, BVN, phone, address, date of birth and the
  // stored `nin_verification_payload` from the identity provider.
  // `cooperatives.getById` two functions above does check — this one was the
  // unguarded way to the same data.
  const access = await assertCooperativeAccess(sb, req.params.cooperativeId, req.user);
  if (access.error === 'not_found') return notFound(res, 'Cooperative not found');
  if (access.error === 'forbidden') return forbidden(res, 'You did not create this cooperative');
  if (access.error) return serverError(res, 'Could not verify access to that cooperative');

  const { count, data, error } = await sb
    .from('farmers')
    .select(
      `*, cooperatives(id, name), farm_profiles(*), credit_scores(final_credit_score, credit_tier)`,
      { count: 'exact' }
    )
    .eq('cooperative_id', req.params.cooperativeId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;
  return paginated(res, shapeFarmers(data || []), { page, pageSize, total: count || 0 });
}

module.exports = { list, getById, create, update, remove, listFarmers };
