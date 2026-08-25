'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { crop, state, lga } = req.query;
  let q = sb.from('regional_benchmarks').select('*', { count: 'exact' });
  if (crop) q = q.eq('crop', crop);
  if (state) q = q.eq('state', state);
  if (lga) q = q.eq('lga', lga);
  q = q.order('crop').range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function upsert(req, res) {
  const sb = supabaseAdmin();
  const { crop, state, lga, season, benchmarkYieldTonnesPerHectare, source } = req.body;
  const { data, error } = await sb.from('regional_benchmarks').upsert(
    {
      crop,
      state,
      lga: lga || null,
      season: season || null,
      benchmark_yield_tonnes_per_hectare: benchmarkYieldTonnesPerHectare,
      source: source || 'extension',
    },
    { onConflict: 'crop,state,lga,season' }
  ).select().single();
  if (error) throw error;
  return created(res, data);
}

module.exports = { list, upsert };
