'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

async function getProfilesForMany(sb, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await sb.from('profiles').select('user_id, full_name, email').in('user_id', ids);
  return new Map((data || []).map((p) => [p.user_id, p]));
}

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { actorId, action, entityType } = req.query;

  
  let q = sb.from('activity_logs').select('*', { count: 'exact' });
  if (actorId) q = q.eq('actor_id', actorId);
  if (action) q = q.eq('action', action);
  if (entityType) q = q.eq('entity_type', entityType);
  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;

  const profiles = await getProfilesForMany(sb, (data || []).map((r) => r.actor_id));
  const enriched = (data || []).map((r) => ({
    ...r,
    actor: profiles.get(r.actor_id) || null,
  }));

  return paginated(res, enriched, { page, pageSize, total: count || 0 });
}

module.exports = { list };
