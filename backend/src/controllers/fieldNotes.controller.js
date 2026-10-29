'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, noContent, badRequest, serverError } = require('../utils/response');
const { logActivity } = require('../utils/activity');
// FIXED — third copy of the same ownership check; shared now.
const { assertFarmerAccess } = require('../utils/ownership');

/** Map an ownership-check failure onto a response. */
function denyFor(res, code) {
  if (code === 'not_found') return notFound(res, 'Farmer not found');
  if (code === 'forbidden') return forbidden(res);
  return serverError(res, 'Could not verify access to that farmer');
}

// GET /farmers/:farmerId/field-notes  (timeline, newest first)
async function listByFarmer(req, res) {
  const sb = supabaseAdmin();
  const acc = await assertFarmerAccess(sb, req.params.farmerId, req.user);
  if (acc.error) return denyFor(res, acc.error);
  const { data, error } = await sb
    .from('field_notes')
    .select('*')
    .eq('farmer_id', req.params.farmerId)
    .order('event_date', { ascending: false })
    .limit(500);
  if (error) throw error;
  return ok(res, data || []);
}

// POST /field-notes
async function create(req, res) {
  const sb = supabaseAdmin();
  const b = req.body;
  const acc = await assertFarmerAccess(sb, b.farmerId, req.user);
  if (acc.error) return denyFor(res, acc.error);
  const { data, error } = await sb.from('field_notes').insert({
    farmer_id: b.farmerId,
    cooperative_id: b.cooperativeId || acc.farmer.cooperative_id || null,
    note_type: b.noteType || 'general',
    title: b.title ?? null,
    body: b.body,
    tag_label: b.tagLabel ?? null,
    tag_variant: b.tagVariant || 'green',
    event_date: b.eventDate || new Date().toISOString(),
    created_by_agent_id: req.user.userId,
  }).select().single();
  if (error) throw error;
  await logActivity({ actor: req.user, action: 'field_note_added', entityType: 'field_note', entityId: data.id, req });
  return created(res, data);
}

// PATCH /field-notes/:noteId
// (the comment here used to read "DELETE /field-notes/:noteId")
async function update(req, res) {
  const sb = supabaseAdmin();
  const { data: existing, error: readErr } = await sb
    .from('field_notes')
    .select('id, created_by_agent_id')
    .eq('id', req.params.noteId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) return notFound(res, 'Field note not found');
  if (req.user.role === 'field_agent' && existing.created_by_agent_id !== req.user.userId) return forbidden(res);

  const b = req.body;
  const patch = {};
  if (b.noteType !== undefined) patch.note_type = b.noteType;
  if (b.title !== undefined) patch.title = b.title || null;
  if (b.body !== undefined) patch.body = b.body;
  if (b.tagLabel !== undefined) patch.tag_label = b.tagLabel || null;
  if (b.tagVariant !== undefined) patch.tag_variant = b.tagVariant;
  if (b.eventDate !== undefined) patch.event_date = b.eventDate;
  if (Object.keys(patch).length === 0) return badRequest(res, 'No fields to update');

  const { data, error } = await sb.from('field_notes').update(patch).eq('id', req.params.noteId).select().single();
  if (error) throw error;
  await logActivity({ actor: req.user, action: 'field_note_updated', entityType: 'field_note', entityId: req.params.noteId, req });
  return ok(res, data);
}

async function remove(req, res) {
  const sb = supabaseAdmin();
  const { data: existing, error: readErr } = await sb
    .from('field_notes')
    .select('id, created_by_agent_id')
    .eq('id', req.params.noteId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) return notFound(res, 'Field note not found');
  if (req.user.role === 'field_agent' && existing.created_by_agent_id !== req.user.userId) return forbidden(res);
  // FIXED — the delete's error was discarded and 204 returned regardless.
  const { error: delErr } = await sb.from('field_notes').delete().eq('id', req.params.noteId);
  if (delErr) throw delErr;
  // FIXED — the delete was not recorded in the activity log, unlike every
  // other destructive action in the codebase (market access, farmer,
  // cooperative and production deletes all log).
  await logActivity({ actor: req.user, action: 'field_note_deleted', entityType: 'field_note', entityId: req.params.noteId, req });
  return noContent(res);
}

module.exports = { listByFarmer, create, update, remove };
