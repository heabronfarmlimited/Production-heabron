'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, noContent } = require('../utils/response');
const { logActivity } = require('../utils/activity');

async function assertFarmer(sb, farmerId, user) {
  const { data: farmer } = await sb.from('farmers').select('id, created_by_agent_id, cooperative_id').eq('id', farmerId).maybeSingle();
  if (!farmer) return { error: 'not_found' };
  if (user.role === 'field_agent' && farmer.created_by_agent_id !== user.userId) return { error: 'forbidden' };
  return { farmer };
}

// GET /farmers/:farmerId/field-notes  (timeline, newest first)
async function listByFarmer(req, res) {
  const sb = supabaseAdmin();
  const acc = await assertFarmer(sb, req.params.farmerId, req.user);
  if (acc.error === 'not_found') return notFound(res, 'Farmer not found');
  if (acc.error === 'forbidden') return forbidden(res);
  const { data, error } = await sb
    .from('field_notes')
    .select('*')
    .eq('farmer_id', req.params.farmerId)
    .order('event_date', { ascending: false });
  if (error) throw error;
  return ok(res, data || []);
}

// POST /field-notes
async function create(req, res) {
  const sb = supabaseAdmin();
  const b = req.body;
  const acc = await assertFarmer(sb, b.farmerId, req.user);
  if (acc.error === 'not_found') return notFound(res, 'Farmer not found');
  if (acc.error === 'forbidden') return forbidden(res);
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

// DELETE /field-notes/:noteId
async function update(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from('field_notes').select('id, created_by_agent_id').eq('id', req.params.noteId).maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.created_by_agent_id !== req.user.userId) return forbidden(res);

  const b = req.body;
  const patch = {};
  if (b.noteType !== undefined) patch.note_type = b.noteType;
  if (b.title !== undefined) patch.title = b.title || null;
  if (b.body !== undefined) patch.body = b.body;
  if (b.tagLabel !== undefined) patch.tag_label = b.tagLabel || null;
  if (b.tagVariant !== undefined) patch.tag_variant = b.tagVariant;
  if (b.eventDate !== undefined) patch.event_date = b.eventDate;

  const { data, error } = await sb.from('field_notes').update(patch).eq('id', req.params.noteId).select().single();
  if (error) throw error;
  await logActivity({ actor: req.user, action: 'field_note_updated', entityType: 'field_note', entityId: req.params.noteId, req });
  return ok(res, data);
}

async function remove(req, res) {
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from('field_notes').select('id, created_by_agent_id').eq('id', req.params.noteId).maybeSingle();
  if (!existing) return notFound(res);
  if (req.user.role === 'field_agent' && existing.created_by_agent_id !== req.user.userId) return forbidden(res);
  await sb.from('field_notes').delete().eq('id', req.params.noteId);
  return noContent(res);
}

module.exports = { listByFarmer, create, update, remove };
