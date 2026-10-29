'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, badRequest, conflict, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer } = require('../services/credit-score');
const email = require('../services/email');
const { getProfileFor, getUsersWithRoles } = require('../utils/profiles');
const { ADMIN_ROLES } = require('../middleware/auth');
const logger = require('../utils/logger');

const ENTITY_TABLE = { farmer: 'farmers', cooperative: 'cooperatives', farm_profile: 'farm_profiles' };

/** Human-readable column per entity type, for the review queue. */
const NAME_COLUMN = { farmer: 'full_name', cooperative: 'name', farm_profile: 'id' };

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

  // Confirm the entity exists and the agent owns it.
  const { data: entity, error: entityErr } = await sb.from(table).select('*').eq('id', entityId).maybeSingle();
  if (entityErr) throw entityErr;
  if (!entity) return notFound(res, `${entityType} not found`);

  if (req.user.role === 'field_agent') {
    if (entityType === 'farm_profile') {
      // FIXED — `farm_profiles` has no `created_by_agent_id`, so the old code
      // set `ownerField = null` and skipped the check ENTIRELY: any field
      // agent could submit a change request against ANY farmer's farm profile
      // by id, and an admin approving it in good faith would apply a stranger's
      // edit (farm size, crop type — the inputs to the credit score) to
      // another agent's farmer. Ownership is resolved through the parent.
      const { data: owner, error: ownerErr } = await sb
        .from('farm_profiles')
        .select('farmer_id, farmers(created_by_agent_id)')
        .eq('id', entityId)
        .maybeSingle();
      if (ownerErr) throw ownerErr;
      if (!owner) return notFound(res, 'farm_profile not found');
      if (owner.farmers?.created_by_agent_id !== req.user.userId) return forbidden(res);
    } else if (entity.created_by_agent_id !== req.user.userId) {
      // FIXED — the old condition was `entity[f] && entity[f] !== userId`, so
      // a row with a NULL `created_by_agent_id` (any legacy or imported
      // record) passed the check for EVERY agent.
      return forbidden(res);
    }
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
  // FIXED — the insert's error was discarded, and the role list was
  // ['super_admin','ops_admin'], excluding finance_admin unlike every other
  // admin broadcast in the codebase.
  try {
    const admins = await getUsersWithRoles(sb, ADMIN_ROLES);
    if (admins.length) {
      const { error: notifyErr } = await sb.from('notifications').insert(admins.map((a) => ({
        user_id: a.userId,
        type: 'change_request_submitted',
        title: 'New change submitted',
        message: `${req.user.fullName || 'A field agent'} submitted a change to a ${entityType.replace('_', ' ')}`,
        metadata: { changeRequestId: data.id, entityType, entityId },
      })));
      if (notifyErr) throw notifyErr;
    }
  } catch (e) {
    logger.warn({ err: e.message, code: e.code }, 'change request admin notification failed');
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
    const { data: ps, error: psErr } = await sb
      .from('profiles')
      .select('user_id, full_name')
      .in('user_id', submitterIds);
    if (psErr) throw psErr;
    profiles = new Map((ps || []).map((p) => [p.user_id, p.full_name]));
  }
  // FIXED — N+1. This issued ONE QUERY PER ROW to resolve the entity name
  // (20 extra round trips for a default page, each with its error discarded).
  // The ids are grouped by table and fetched in one query per table instead —
  // at most three, regardless of page size.
  const idsByType = new Map();
  for (const r of rows) {
    if (!ENTITY_TABLE[r.entity_type] || !r.entity_id) continue;
    if (!idsByType.has(r.entity_type)) idsByType.set(r.entity_type, new Set());
    idsByType.get(r.entity_type).add(r.entity_id);
  }

  const namesByType = new Map();
  for (const [entityType, idSet] of idsByType) {
    const nameCol = NAME_COLUMN[entityType];
    const { data: entities, error: entErr } = await sb
      .from(ENTITY_TABLE[entityType])
      .select(`id, ${nameCol}`)
      .in('id', [...idSet]);
    if (entErr) throw entErr;
    namesByType.set(entityType, new Map((entities || []).map((e) => [e.id, e[nameCol]])));
  }

  const enriched = rows.map((r) => ({
    ...r,
    entity_name: namesByType.get(r.entity_type)?.get(r.entity_id) ?? null,
    submitted_by_name: profiles.get(r.submitted_by_agent_id) || null,
  }));

  return paginated(res, enriched, { page, pageSize, total: count || 0 });
}

// GET /change-requests/:changeRequestId
async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('change_requests')
    .select('*')
    .eq('id', req.params.changeRequestId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res, 'Change request not found');
  if (req.user.role === 'field_agent' && data.submitted_by_agent_id !== req.user.userId) return forbidden(res);
  return ok(res, data);
}

// POST /change-requests/:changeRequestId/decision   (admin)  { decision:'approve'|'reject', reviewNotes? }
async function decide(req, res) {
  const sb = supabaseAdmin();
  const { decision, reviewNotes } = req.body;
  const { data: cr, error: readErr } = await sb
    .from('change_requests')
    .select('*')
    .eq('id', req.params.changeRequestId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!cr) return notFound(res, 'Change request not found');
  if (cr.status !== 'pending') {
    return conflict(res, `This change request has already been ${cr.status}`, {
      changeRequestId: cr.id,
      currentStatus: cr.status,
    });
  }

  const table = ENTITY_TABLE[cr.entity_type];
  // FIXED — `ENTITY_TABLE[cr.entity_type]` was used without checking, so a row
  // with an unrecognised `entity_type` reached `sb.from(undefined)`.
  if (!table) return badRequest(res, `Unknown entityType on this change request: ${cr.entity_type}`);

  const approved = decision === 'approve';
  let applied = null;

  // FIXED — the status was written AFTER the entity change with its own error
  // discarded. If the entity update succeeded and the status write failed, the
  // change was applied to live data while the request stayed `pending` — so an
  // admin could approve it a second time and apply it twice. The request is now
  // claimed FIRST, conditionally on still being pending, and rolled back if
  // applying it fails.
  const { data: claimed, error: claimErr } = await sb
    .from('change_requests')
    .update({
      status: approved ? 'approved' : 'rejected',
      reviewed_by_admin_id: req.user.userId,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes || null,
    })
    .eq('id', cr.id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    return conflict(res, 'This change request was decided by someone else a moment ago', {
      changeRequestId: cr.id,
    });
  }

  if (approved) {
    try {
      if (cr.change_type === 'delete') {
        const { error: delErr } = await sb.from(table).delete().eq('id', cr.entity_id);
        if (delErr) throw delErr;
      } else {
        const patch = { ...cr.proposed_changes, updated_at: new Date().toISOString() };
        const { data: updated, error } = await sb
          .from(table)
          .update(patch)
          .eq('id', cr.entity_id)
          .select()
          .maybeSingle();
        if (error) throw error;
        applied = updated;
        // If a farm/farmer field that affects scoring changed, recalc.
        // FIXED — was fire-and-forget, so an approved farm-size change never
        // reached the credit score on Vercel.
        const farmerId = cr.entity_type === 'farmer' ? cr.entity_id
          : cr.entity_type === 'farm_profile' ? updated?.farmer_id : null;
        if (farmerId) await safeRecalculateFarmer(farmerId, { triggerReason: 'change_request_approved' });
      }
    } catch (applyErr) {
      // Put the request back in the queue rather than marking it approved
      // when the change was not in fact applied.
      await sb
        .from('change_requests')
        .update({ status: 'pending', reviewed_by_admin_id: null, reviewed_at: null, review_notes: null })
        .eq('id', cr.id);
      logger.error(
        { err: applyErr.message, code: applyErr.code, changeRequestId: cr.id, entityType: cr.entity_type },
        'change request could not be applied — returned to pending'
      );
      throw applyErr;
    }
  }

  // Notify + email submitting agent
  if (cr.submitted_by_agent_id) {
    try {
      const nameCol = NAME_COLUMN[cr.entity_type];
      const { data: e } = await sb.from(table).select(nameCol).eq('id', cr.entity_id).maybeSingle();
      const entityName = e ? e[nameCol] : cr.entity_type;
      await sb.from('notifications').insert({
        user_id: cr.submitted_by_agent_id,
        type: approved ? 'change_request_approved' : 'change_request_rejected',
        title: approved ? 'Change approved' : 'Change rejected',
        message: `Your update to ${entityName} was ${approved ? 'approved' : 'rejected'}`,
        metadata: { changeRequestId: cr.id },
      });
      const ap = await getProfileFor(sb, cr.submitted_by_agent_id);
      if (ap?.email) {
        // FIXED — fire-and-forget `email.safe(...)`: on Vercel the lambda is
        // frozen when the response is written, so the agent was never told
        // their change had been reviewed.
        const result = await email.safe(email.sendChangeRequestDecision)(ap.email, {
          recipientName: ap.full_name,
          entityName,
          decision: approved ? 'approved' : 'rejected',
          reviewNotes,
        });
        if (result?.error) logger.warn({ err: result.error, to: ap.email }, 'change request email rejected');
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'change request decision notify failed');
    }
  }

  await logActivity({ actor: req.user, action: `change_request_${approved ? 'approved' : 'rejected'}`, entityType: 'change_request', entityId: cr.id, req });
  const { data: updated, error: reReadErr } = await sb
    .from('change_requests')
    .select('*')
    .eq('id', cr.id)
    .maybeSingle();
  if (reReadErr) throw reReadErr;
  return ok(res, { ...updated, applied });
}

module.exports = { create, list, getById, decide };
