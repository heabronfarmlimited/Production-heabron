'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, paginated, notFound } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  // NOTE: `unread` was being stripped by `validate(v.listQuery, 'query')` on
  // the agent route, so the mobile app's "unread only" filter did nothing.
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
  // FIXED — the error was discarded, so a failed count reported `0` unread
  // and the app's badge silently cleared itself.
  const { count, error } = await sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.userId)
    .eq('is_read', false);
  if (error) throw error;
  return ok(res, { count: count || 0 });
}

async function markRead(req, res) {
  const sb = supabaseAdmin();
  // FIXED — the update's error was discarded and the handler answered
  // `{ marked: true }` unconditionally, including when the notification did
  // not exist or belonged to another user. The affected row is now checked,
  // so the client is told when nothing was marked.
  const { data, error } = await sb
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', req.params.notificationId)
    .eq('user_id', req.user.userId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) return notFound(res, 'Notification not found');
  return ok(res, { marked: true });
}

async function markAllRead(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', req.user.userId)
    .eq('is_read', false)
    .select('id');
  if (error) throw error;
  return ok(res, { marked: true, count: (data || []).length });
}

async function clearAll(req, res) {
  const sb = supabaseAdmin();
  const { error } = await sb.from('notifications').delete().eq('user_id', req.user.userId);
  if (error) throw error;
  return ok(res, { cleared: true });
}

module.exports = { list, unreadCount, markRead, markAllRead, clearAll };
