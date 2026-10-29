'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, noContent, badRequest, serverError } = require('../utils/response');
const { logActivity } = require('../utils/activity');
// FIXED — this file carried its own `assertFarmer`, one of three near-identical
// copies (productions, fieldNotes) that had drifted apart. Shared now.
const { assertFarmerAccess } = require('../utils/ownership');

/** Map an ownership-check failure onto a response. */
function denyFor(res, code) {
  if (code === 'not_found') return notFound(res, 'Farmer not found');
  if (code === 'forbidden') return forbidden(res);
  return serverError(res, 'Could not verify access to that farmer');
}

// GET /farmers/:farmerId/market-access  (offtake history)
async function listByFarmer(req, res) {
  const sb = supabaseAdmin();
  const acc = await assertFarmerAccess(sb, req.params.farmerId, req.user);
  if (acc.error) return denyFor(res, acc.error);
  const { data, error } = await sb
    .from('market_access_records')
    .select('*')
    .eq('farmer_id', req.params.farmerId)
    .order('season_year', { ascending: true, nullsFirst: true })
    .limit(500);
  if (error) throw error;
  return ok(res, data || []);
}

// POST /market-access
async function create(req, res) {
  const sb = supabaseAdmin();
  const b = req.body;
  const acc = await assertFarmerAccess(sb, b.farmerId, req.user);
  if (acc.error) return denyFor(res, acc.error);
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
  const { data: existing, error: readErr } = await sb
    .from('market_access_records')
    .select('*, farmers(created_by_agent_id)')
    .eq('id', req.params.recordId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) return notFound(res, 'Market access record not found');
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
  // FIXED — an empty body produced a patch of only `updated_at`, which
  // "succeeded" while changing nothing the caller asked for.
  if (Object.keys(patch).length === 0) return badRequest(res, 'No fields to update');
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('market_access_records').update(patch).eq('id', existing.id).select().single();
  if (error) throw error;
  return ok(res, data);
}

// DELETE /market-access/:recordId
async function remove(req, res) {
  const sb = supabaseAdmin();
  const { data: existing, error: readErr } = await sb
    .from('market_access_records')
    .select('id, farmers(created_by_agent_id)')
    .eq('id', req.params.recordId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) return notFound(res, 'Market access record not found');
  if (req.user.role === 'field_agent' && existing.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);
  // FIXED — the delete's error was discarded and the handler returned 204
  // regardless, so a blocked delete looked successful and the row reappeared.
  const { error: delErr } = await sb.from('market_access_records').delete().eq('id', req.params.recordId);
  if (delErr) throw delErr;
  await logActivity({ actor: req.user, action: 'market_access_deleted', entityType: 'market_access', entityId: req.params.recordId, req });
  return noContent(res);
}

module.exports = { listByFarmer, create, update, remove };
