'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const unreadOnly = req.query.unread === 'true';
  let q = sb.from('notifications').select('*', { count: 'exact' }).eq('user_id', req.user.userId);
  if (unreadOnly) q = q.eq('is_read', false);
  q = q.order('created_at', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function unreadCount(req, res) {
  const sb = supabaseAdmin();
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.userId).eq('is_read', false);
  return ok(res, { count: count || 0 });
}

async function markRead(req, res) {
  const sb = supabaseAdmin();
  await sb.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', req.params.notificationId).eq('user_id', req.user.userId);
  return ok(res, { marked: true });
}

async function markAllRead(req, res) {
  const sb = supabaseAdmin();
  await sb.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('user_id', req.user.userId).eq('is_read', false);
  return ok(res, { marked: true });
}

async function clearAll(req, res) {
  const sb = supabaseAdmin();
  await sb.from('notifications').delete().eq('user_id', req.user.userId);
  return ok(res, { cleared: true });
}

module.exports = { list, unreadCount, markRead, markAllRead, clearAll };
