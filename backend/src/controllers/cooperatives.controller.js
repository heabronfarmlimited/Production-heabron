'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { ADMIN_ROLES } = require('../middleware/auth');
const { shapeFarmers } = require('../utils/shapeFarmer');
const logger = require('../utils/logger');

function toRow(input, userId) {
  return {
    name: input.name,
    registration_number: input.registrationNumber,
    leader_name: input.leaderName,
    leader_phone: input.leaderPhone,
    crops_supported: input.cropsSupported,
    state: input.state,
    lga: input.lga,
    address: input.address,
    estimated_land_size: input.estimatedLandSize,
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
  if (search) q = q.ilike('name', `%${search}%`);
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

  const [{ count: farmersCount }, { count: deliveriesCount }, { count: financingCount }] = await Promise.all([
    sb.from('farmers').select('id', { count: 'exact', head: true }).eq('cooperative_id', data.id),
    sb.from('produce_deliveries').select('id', { count: 'exact', head: true }).eq('cooperative_id', data.id),
    sb.from('financing_requests').select('id', { count: 'exact', head: true }).eq('cooperative_id', data.id),
  ]);

  // Defensive tier fill-in for legacy rows that pre-date the seed-on-create
  // patch — never render "null" to the mobile client.
  const effectiveTier = data.cooperative_tier || 'D';

  return ok(res, {
    ...data,
    cooperative_tier: effectiveTier,
    average_credit_score: data.average_credit_score ?? 0,
    stats: {
      farmers: farmersCount || 0,
      deliveries: deliveriesCount || 0,
      financingRequests: financingCount || 0,
    },
  });
}

async function create(req, res) {
  const sb = supabaseAdmin();
  const row = toRow(req.body, req.user.userId);

  const { data, error } = await sb
    .from('cooperatives')
    .insert({
      ...row,
      cooperative_tier: 'D',
      average_credit_score: 0,
      total_members: 0,
    })
    .select()
    .single();
  if (error) throw error;

  try {
    await sb.from('cooperative_credit_scores').upsert(
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
  } catch (e) {
    logger.warn({ err: e.message, cooperativeId: data.id }, 'cooperative_credit_scores seed failed');
  }

  try {
    await sb.from('notifications').insert({
      user_id: req.user.userId,
      type: 'cooperative_added',
      title: 'Cooperative created',
      message: `You added "${data.name}"`,
      metadata: { cooperativeId: data.id },
    });
  } catch (e) { logger.warn({ err: e.message }, 'cooperative notification failed'); }

  await logActivity({ actor: req.user, action: 'cooperative_created', entityType: 'cooperative', entityId: data.id, metadata: { name: data.name }, req });
  return created(res, data);
}

async function update(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from('cooperatives').select('id, created_by_agent_id').eq('id', req.params.cooperativeId).maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.created_by_agent_id !== req.user.userId) return forbidden(res);

  const patch = toRow(req.body, existing.created_by_agent_id);
  delete patch.created_by_agent_id;
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

  const { data, error } = await sb.from('cooperatives').update(patch).eq('id', req.params.cooperativeId).select().single();
  if (error) throw error;
  await logActivity({ actor: req.user, action: 'cooperative_updated', entityType: 'cooperative', entityId: data.id, req });
  return ok(res, data);
}

async function remove(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from('cooperatives').select('id, created_by_agent_id, name').eq('id', req.params.cooperativeId).maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.created_by_agent_id !== req.user.userId) return forbidden(res);

  await sb.from('cooperatives').delete().eq('id', req.params.cooperativeId);
  await logActivity({ actor: req.user, action: 'cooperative_deleted', entityType: 'cooperative', entityId: existing.id, metadata: { name: existing.name }, req });
  return ok(res, { deleted: true });
}

async function listFarmers(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
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
