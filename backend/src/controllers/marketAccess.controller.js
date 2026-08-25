'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, noContent } = require('../utils/response');
const { logActivity } = require('../utils/activity');

async function assertFarmer(sb, farmerId, user) {
  const { data: farmer } = await sb.from('farmers').select('id, created_by_agent_id').eq('id', farmerId).maybeSingle();
  if (!farmer) return { error: 'not_found' };
  if (user.role === 'field_agent' && farmer.created_by_agent_id !== user.userId) return { error: 'forbidden' };
  return { farmer };
}

// GET /farmers/:farmerId/market-access  (offtake history)
async function listByFarmer(req, res) {
  const sb = supabaseAdmin();
  const acc = await assertFarmer(sb, req.params.farmerId, req.user);
  if (acc.error === 'not_found') return notFound(res, 'Farmer not found');
  if (acc.error === 'forbidden') return forbidden(res);
  const { data, error } = await sb
    .from('market_access_records')
    .select('*')
    .eq('farmer_id', req.params.farmerId)
    .order('season_year', { ascending: true, nullsFirst: true });
  if (error) throw error;
  return ok(res, data || []);
}

// POST /market-access
async function create(req, res) {
  const sb = supabaseAdmin();
  const b = req.body;
  const acc = await assertFarmer(sb, b.farmerId, req.user);
  if (acc.error === 'not_found') return notFound(res, 'Farmer not found');
  if (acc.error === 'forbidden') return forbidden(res);
  const { data, error } = await sb.from('market_access_records').insert({
    farmer_id: b.farmerId,
    season_year: b.seasonYear ?? null,
    buyer_name: b.buyerName,
    price_per_ton: b.pricePerTon ?? null,
    price_context: b.priceContext ?? null,
    is_confirmed: b.isConfirmed ?? false,
    harvest_window: b.harvestWindow ?? null,
    notes: b.notes ?? null,
    created_by_agent_id: req.user.userId,
  }).select().single();
  if (error) throw error;
  await logActivity({ actor: req.user, action: 'market_access_recorded', entityType: 'market_access', entityId: data.id, req });
  return created(res, data);
}

// PATCH /market-access/:recordId
async function update(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from('market_access_records')
    .select('*, farmers(created_by_agent_id)')
    .eq('id', req.params.recordId)
    .maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);
  const b = req.body;
  const patch = {};
  if (b.seasonYear !== undefined) patch.season_year = b.seasonYear;
  if (b.buyerName !== undefined) patch.buyer_name = b.buyerName;
  if (b.pricePerTon !== undefined) patch.price_per_ton = b.pricePerTon;
  if (b.priceContext !== undefined) patch.price_context = b.priceContext;
  if (b.isConfirmed !== undefined) patch.is_confirmed = b.isConfirmed;
  if (b.harvestWindow !== undefined) patch.harvest_window = b.harvestWindow;
  if (b.notes !== undefined) patch.notes = b.notes;
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('market_access_records').update(patch).eq('id', existing.id).select().single();
  if (error) throw error;
  return ok(res, data);
}

// DELETE /market-access/:recordId
async function remove(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from('market_access_records')
    .select('id, farmers(created_by_agent_id)')
    .eq('id', req.params.recordId)
    .maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);
  await sb.from('market_access_records').delete().eq('id', req.params.recordId);
  await logActivity({ actor: req.user, action: 'market_access_deleted', entityType: 'market_access', entityId: req.params.recordId, req });
  return noContent(res);
}

module.exports = { listByFarmer, create, update, remove };
