'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
// FIXED — this file carried its own copy of `getProfilesForMany` (one of three
// in the codebase, each with a different select list and none checking the
// query error). Shared implementation now; see utils/profiles.js.
const { getProfilesForMany } = require('../utils/profiles');

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  // NOTE: `actorId`, `action` and `entityType` were being stripped by the
  // route's `validate(v.listQuery, 'query')` because `listQuery` never
  // declared them, so all three admin audit-log filters silently did nothing.
  // Declared in validators/domain.js now.
  const { actorId, action, entityType, startDate, endDate } = req.query;

  let q = sb.from('activity_logs').select('*', { count: 'exact' });
  if (actorId) q = q.eq('actor_id', actorId);
  if (action) q = q.eq('action', action);
  if (entityType) q = q.eq('entity_type', entityType);
  if (startDate) q = q.gte('created_at', startDate);
  if (endDate) q = q.lte('created_at', endDate);
  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;

  const profiles = await getProfilesForMany(sb, (data || []).map((r) => r.actor_id), 'user_id, full_name, email');
  const enriched = (data || []).map((r) => ({
    ...r,
    actor: profiles.get(r.actor_id) || null,
  }));

  return paginated(res, enriched, { page, pageSize, total: count || 0 });
}

module.exports = { list };
