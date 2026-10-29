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

/**
 * Create or update a regional yield benchmark.
 *
 * FIXED — two bugs.
 *
 *  1. The route had NO validator (see validators/domain.js `upsertBenchmark`).
 *     `benchmark_yield_tonnes_per_hectare` is the DENOMINATOR of every
 *     farmer's yield score, so an admin typing "4,5" wrote a non-numeric value
 *     and a blank field wrote NULL — silently zeroing the production score of
 *     every farmer growing that crop in that state.
 *
 *  2. `onConflict: 'crop,state,lga,season'` relies on the table's
 *     `UNIQUE (crop, state, lga, season)` constraint, but Postgres treats
 *     NULLs as DISTINCT by default: two rows with `lga IS NULL` do not
 *     conflict. State-level benchmarks (the common case — `lga` and `season`
 *     are both optional) therefore inserted a NEW DUPLICATE row on every save
 *     instead of updating, and `lookupBenchmark` then picked between the
 *     duplicates arbitrarily. The upsert is now split: when either key is
 *     NULL we locate the existing row explicitly and UPDATE it.
 */
async function upsert(req, res) {
  const sb = supabaseAdmin();
  const { crop, state, lga, season, benchmarkYieldTonnesPerHectare, source } = req.body;
  const row = {
    crop,
    state,
    lga: lga || null,
    season: season || null,
    benchmark_yield_tonnes_per_hectare: benchmarkYieldTonnesPerHectare,
    source: source || 'extension',
  };

  // NULL in the unique key — find-then-write, because ON CONFLICT cannot
  // match a NULL.
  if (row.lga === null || row.season === null) {
    let find = sb.from('regional_benchmarks').select('id').eq('crop', row.crop).eq('state', row.state);
    find = row.lga === null ? find.is('lga', null) : find.eq('lga', row.lga);
    find = row.season === null ? find.is('season', null) : find.eq('season', row.season);

    const { data: existing, error: findErr } = await find.limit(1);
    if (findErr) throw findErr;

    if (existing?.length) {
      const { data, error } = await sb
        .from('regional_benchmarks')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id)
        .select()
        .single();
      if (error) throw error;
      return ok(res, data);
    }

    const { data, error } = await sb.from('regional_benchmarks').insert(row).select().single();
    if (error) throw error;
    return created(res, data);
  }

  const { data, error } = await sb
    .from('regional_benchmarks')
    .upsert(row, { onConflict: 'crop,state,lga,season' })
    .select()
    .single();
  if (error) throw error;
  return created(res, data);
}

module.exports = { list, upsert };
