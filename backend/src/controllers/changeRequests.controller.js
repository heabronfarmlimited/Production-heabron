'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, badRequest, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer } = require('../services/credit-score');
const email = require('../services/email');
const logger = require('../utils/logger');

const ENTITY_TABLE = { farmer: 'farmers', cooperative: 'cooperatives', farm_profile: 'farm_profiles' };

// Whitelist of camelCase -> snake_case columns an agent may propose to change,
// per entity. Anything outside this list is ignored (protected fields like NIN,
// BVN, verification status, credit score are never editable via change request).
const FIELD_MAP = {
  farmer: {
    fullName: 'full_name', phone: 'phone', altPhone: 'alt_phone', address: 'address',
    state: 'state', lga: 'lga', gender: 'gender', dateOfBirth: 'date_of_birth',
    householdSize: 'household_size', dependents: 'dependents', educationLevel: 'education_level',
    cooperativeId: 'cooperative_id', memberSince: 'member_since',
  },
  cooperative: {
    name: 'name', leaderName: 'leader_name', leaderPhone: 'leader_phone',
    address: 'address', state: 'state', lga: 'lga', primaryCrop: 'primary_crop',
    cropsSupported: 'crops_supported', estimatedLandSize: 'estimated_land_size',
  },
  farm_profile: {
    farmSizeAcres: 'farm_size_acres', plotCount: 'plot_count', cropType: 'crop_type',
    secondaryCrops: 'secondary_crops', soilType: 'soil_type', waterSource: 'water_source',
    irrigationAccess: 'irrigation_access', landOwnership: 'land_ownership',
    yearsExperience: 'years_experience',
  },
};

function mapChanges(entityType, proposed) {
  const map = FIELD_MAP[entityType] || {};
  const out = {};
  for (const [k, v] of Object.entries(proposed || {})) {
    if (map[k]) out[map[k]] = v;
  }
  return out;
}

// POST /change-requests   (agent)
async function create(req, res) {
  const sb = supabaseAdmin();
  const { entityType, entityId, changeType, proposedChanges } = req.body;
  const table = ENTITY_TABLE[entityType];
  if (!table) return badRequest(res, 'Invalid entityType');

  // Confirm the entity exists and the agent owns it (for farmer/coop).
  const { data: entity } = await sb.from(table).select('*').eq('id', entityId).maybeSingle();
  if (!entity) return notFound(res, `${entityType} not found`);
  if (req.user.role === 'field_agent') {
    const ownerField = entityType === 'farm_profile' ? null : 'created_by_agent_id';
    if (ownerField && entity[ownerField] && entity[ownerField] !== req.user.userId) return forbidden(res);
  }

  const mapped = mapChanges(entityType, proposedChanges);
  if (changeType !== 'delete' && Object.keys(mapped).length === 0) {
    return badRequest(res, 'No editable fields in proposedChanges');
  }
  const snapshot = {};
  for (const col of Object.keys(mapped)) snapshot[col] = entity[col];

  const { data, error } = await sb.from('change_requests').insert({
    entity_type: entityType,
    entity_id: entityId,
    change_type: changeType || 'update',
    proposed_changes: mapped,
    current_snapshot: snapshot,
    status: 'pending',
    submitted_by_agent_id: req.user.userId,
  }).select().single();
  if (error) throw error;

  // Notify admins there is a pending change to review.
  const { data: admins } = await sb.from('user_roles').select('user_id').in('role', ['super_admin', 'ops_admin']);
  if (admins?.length) {
    await sb.from('notifications').insert(admins.map((a) => ({
      user_id: a.user_id,
      type: 'change_request_submitted',
      title: 'New change submitted',
      message: `A field agent submitted a change to a ${entityType.replace('_', ' ')}`,
      metadata: { changeRequestId: data.id, entityType, entityId },
    })));
  }

  await logActivity({ actor: req.user, action: 'change_request_submitted', entityType: 'change_request', entityId: data.id, req });
  return created(res, data);
}

// GET /change-requests   (agent sees own; admin sees all)  ?status=pending|approved|rejected
async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { status } = req.query;
  let q = sb.from('change_requests').select('*', { count: 'exact' });
  if (req.user.role === 'field_agent') q = q.eq('submitted_by_agent_id', req.user.userId);
  if (status) q = q.eq('status', status);
  q = q.order('created_at', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  // Enrich with entity name + submitter name (best-effort).
  const rows = data || [];
  const submitterIds = [...new Set(rows.map((r) => r.submitted_by_agent_id).filter(Boolean))];
  let profiles = new Map();
  if (submitterIds.length) {
    const { data: ps } = await sb.from('profiles').select('user_id, full_name').in('user_id', submitterIds);
    profiles = new Map((ps || []).map((p) => [p.user_id, p.full_name]));
  }
  const enriched = await Promise.all(rows.map(async (r) => {
    const table = ENTITY_TABLE[r.entity_type];
    let entityName = null;
    if (table && r.entity_id) {
      const nameCol = r.entity_type === 'cooperative' ? 'name' : r.entity_type === 'farm_profile' ? 'id' : 'full_name';
      const { data: e } = await sb.from(table).select(nameCol).eq('id', r.entity_id).maybeSingle();
      entityName = e ? e[nameCol] : null;
    }
    return { ...r, entity_name: entityName, submitted_by_name: profiles.get(r.submitted_by_agent_id) || null };
  }));

  return paginated(res, enriched, { page, pageSize, total: count || 0 });
}

// GET /change-requests/:changeRequestId
async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data } = await sb.from('change_requests').select('*').eq('id', req.params.changeRequestId).maybeSingle();
  if (!data) return notFound(res);
  if (req.user.role === 'field_agent' && data.submitted_by_agent_id !== req.user.userId) return forbidden(res);
  return ok(res, data);
}

// POST /change-requests/:changeRequestId/decision   (admin)  { decision:'approve'|'reject', reviewNotes? }
async function decide(req, res) {
  const sb = supabaseAdmin();
  const { decision, reviewNotes } = req.body;
  const { data: cr } = await sb.from('change_requests').select('*').eq('id', req.params.changeRequestId).maybeSingle();
  if (!cr) return notFound(res);
  if (cr.status !== 'pending') return badRequest(res, `Change request already ${cr.status}`);

  const approved = decision === 'approve';
  let applied = null;

  if (approved) {
    const table = ENTITY_TABLE[cr.entity_type];
    if (cr.change_type === 'delete') {
      await sb.from(table).delete().eq('id', cr.entity_id);
    } else {
      const patch = { ...cr.proposed_changes, updated_at: new Date().toISOString() };
      const { data: updated, error } = await sb.from(table).update(patch).eq('id', cr.entity_id).select().maybeSingle();
      if (error) throw error;
      applied = updated;
      // If a farm/farmer field that affects scoring changed, recalc.
      const farmerId = cr.entity_type === 'farmer' ? cr.entity_id
        : cr.entity_type === 'farm_profile' ? updated?.farmer_id : null;
      if (farmerId) safeRecalculateFarmer(farmerId, { triggerReason: 'change_request_approved' });
    }
  }

  await sb.from('change_requests').update({
    status: approved ? 'approved' : 'rejected',
    reviewed_by_admin_id: req.user.userId,
    reviewed_at: new Date().toISOString(),
    review_notes: reviewNotes || null,
  }).eq('id', cr.id);

  // Notify + email submitting agent
  if (cr.submitted_by_agent_id) {
    try {
      const table = ENTITY_TABLE[cr.entity_type];
      const nameCol = cr.entity_type === 'cooperative' ? 'name' : cr.entity_type === 'farm_profile' ? 'id' : 'full_name';
      const { data: e } = await sb.from(table).select(nameCol).eq('id', cr.entity_id).maybeSingle();
      const entityName = e ? e[nameCol] : cr.entity_type;
      await sb.from('notifications').insert({
        user_id: cr.submitted_by_agent_id,
        type: approved ? 'change_request_approved' : 'change_request_rejected',
        title: approved ? 'Change approved' : 'Change rejected',
        message: `Your update to ${entityName} was ${approved ? 'approved' : 'rejected'}`,
        metadata: { changeRequestId: cr.id },
      });
      const { data: ap } = await sb.from('profiles').select('email, full_name').eq('user_id', cr.submitted_by_agent_id).maybeSingle();
      if (ap?.email) {
        email.safe(email.sendChangeRequestDecision)(ap.email, {
          recipientName: ap.full_name,
          entityName,
          decision: approved ? 'approved' : 'rejected',
          reviewNotes,
        });
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'change request decision notify failed');
    }
  }

  await logActivity({ actor: req.user, action: `change_request_${approved ? 'approved' : 'rejected'}`, entityType: 'change_request', entityId: cr.id, req });
  const { data: updated } = await sb.from('change_requests').select('*').eq('id', cr.id).maybeSingle();
  return ok(res, { ...updated, applied });
}

module.exports = { create, list, getById, decide };
