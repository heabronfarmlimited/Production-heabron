'use strict';

const { parse } = require('csv-parse/sync');
const { supabaseAdmin } = require('../config/supabase');
const { created, badRequest, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateMany } = require('../services/credit-score');
const logger = require('../utils/logger');

/**
 * A bulk import runs one INSERT per row inside a serverless request, so the
 * row count has to be bounded or the function times out part-way through and
 * leaves a half-finished import with no record of where it stopped.
 */
const MAX_IMPORT_ROWS = 2000;

/**
 * Bulk import farmers (and auto-create their cooperatives if missing).
 * Expected CSV columns (case-insensitive, snake_case or Title Case OK):
 *   cooperative_name, state, lga,
 *   farmer_full_name, gender, phone, nin, date_of_birth,
 *   farm_size_acres, crop_type
 *
 * The agent that uploads owns the resulting cooperatives + farmers.
 */
async function bulkImport(req, res) {
  if (!req.file) return badRequest(res, 'CSV file required (field: file)');

  const sb = supabaseAdmin();
  const text = req.file.buffer.toString('utf8');
  let rows;
  try {
    rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return badRequest(res, `CSV parse error: ${err.message}`);
  }

  const normalize = (s) => String(s || '').toLowerCase().replace(/\s+|-/g, '_');
  const getField = (row, ...candidates) => {
    for (const c of candidates) {
      for (const key of Object.keys(row)) {
        if (normalize(key) === normalize(c)) return row[key];
      }
    }
    return null;
  };

  // FIXED — there was no row cap. A 50k-row CSV issued 50k sequential inserts
  // in one request; Vercel kills the function long before that finishes,
  // leaving thousands of farmers created, no import_logs row written, and no
  // way for the agent to tell what had landed.
  if (rows.length > MAX_IMPORT_ROWS) {
    return badRequest(
      res,
      `This file has ${rows.length} rows, which is above the ${MAX_IMPORT_ROWS}-row limit for a single import. Split it into smaller files.`,
      { rows: rows.length, maxRows: MAX_IMPORT_ROWS }
    );
  }
  if (rows.length === 0) return badRequest(res, 'The CSV has no data rows');

  const errors = [];
  const cooperativeCache = new Map();
  const createdCoopIds = new Set();
  const createdFarmerIds = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNo = i + 2; // header + 1-indexed
    try {
      const coopName = getField(row, 'cooperative_name', 'cooperative');
      const state = getField(row, 'state');
      const lga = getField(row, 'lga');
      const farmerName = getField(row, 'farmer_full_name', 'full_name', 'farmer_name');
      const phone = getField(row, 'phone');
      const nin = getField(row, 'nin');
      const dob = getField(row, 'date_of_birth', 'dob');
      const gender = getField(row, 'gender');
      const farmSize = Number(getField(row, 'farm_size_acres', 'farm_size') || 0);
      const cropType = getField(row, 'crop_type', 'crop');

      if (!coopName) throw new Error('cooperative_name required');
      if (!farmerName) throw new Error('farmer_full_name required');
      if (!state || !lga) throw new Error('state and lga required');

      // Find or create cooperative
      let coopId = cooperativeCache.get(coopName.toLowerCase());
      if (!coopId) {
        const { data: existing, error: lookupErr } = await sb
          .from('cooperatives')
          .select('id')
          .eq('name', coopName)
          .eq('created_by_agent_id', req.user.userId)
          .maybeSingle();
        // Discarded before: a failed lookup read as "no such cooperative" and
        // the importer created a DUPLICATE alongside the existing one.
        if (lookupErr) throw lookupErr;
        if (existing) {
          coopId = existing.id;
        } else {
          // FIXED — `cooperatives.create` seeds `cooperative_tier: 'D'`,
          // `average_credit_score: 0`, `total_members: 0` and a
          // `cooperative_credit_scores` row; the import path did none of
          // that, so an imported cooperative had a NULL tier that every list
          // screen rendered as blank while a hand-created one showed 'D'.
          const { data: createdCoop, error: coopErr } = await sb.from('cooperatives').insert({
            name: coopName,
            state,
            lga,
            crops_supported: cropType ? [cropType] : null,
            created_by_agent_id: req.user.userId,
            cooperative_tier: 'D',
            average_credit_score: 0,
            total_members: 0,
          }).select().single();
          if (coopErr) throw coopErr;
          coopId = createdCoop.id;
          createdCoopIds.add(coopId);

          const { error: seedErr } = await sb.from('cooperative_credit_scores').upsert(
            {
              cooperative_id: coopId,
              average_score: 0,
              cooperative_tier: 'D',
              total_farmers: 0,
              scored_farmers: 0,
              tier_a_count: 0,
              tier_b_count: 0,
              tier_c_count: 0,
              tier_d_count: 0,
              last_calculated_at: new Date().toISOString(),
            },
            { onConflict: 'cooperative_id' }
          );
          if (seedErr) {
            logger.warn({ err: seedErr.message, cooperativeId: coopId }, 'imported cooperative score seed failed');
          }
        }
        cooperativeCache.set(coopName.toLowerCase(), coopId);
      }

      const { data: farmer, error: farmerErr } = await sb.from('farmers').insert({
        cooperative_id: coopId,
        full_name: farmerName,
        date_of_birth: dob || null,
        gender: gender ? String(gender).toLowerCase() : null,
        phone,
        nin,
        state,
        lga,
        created_by_agent_id: req.user.userId,
      }).select().single();
      if (farmerErr) throw farmerErr;
      createdFarmerIds.push(farmer.id);

      if (farmSize > 0 || cropType) {
        // FIXED — the farm profile insert discarded its error, so a farmer
        // could be imported with no farm profile and the row still counted as
        // a success. Without a farm size the farmer can never be scored.
        const { error: fpErr } = await sb.from('farm_profiles').insert({
          farmer_id: farmer.id,
          farm_size_acres: farmSize,
          crop_type: cropType,
        });
        if (fpErr) throw fpErr;
      }
      // FIXED — `safeRecalculateFarmer` was called here, un-awaited, once per
      // row. On Vercel those promises were all killed when the response was
      // written, so a bulk import produced farmers with no credit score at
      // all. Scoring is now done once, after the loop, and awaited.
    } catch (err) {
      errors.push({ line: lineNo, message: err.message });
    }
  }

  // Refresh member counts for every cooperative touched, then score the
  // imported farmers in one bounded, awaited pass.
  for (const coopId of new Set([...cooperativeCache.values()])) {
    const { count, error: countErr } = await sb
      .from('farmers')
      .select('id', { count: 'exact', head: true })
      .eq('cooperative_id', coopId);
    if (countErr) {
      logger.warn({ err: countErr.message, cooperativeId: coopId }, 'import member count failed');
      continue;
    }
    const { error: updErr } = await sb.from('cooperatives').update({ total_members: count || 0 }).eq('id', coopId);
    if (updErr) logger.warn({ err: updErr.message, cooperativeId: coopId }, 'import member count update failed');
  }

  await safeRecalculateMany(createdFarmerIds, { triggerReason: 'csv_import' }, { max: MAX_IMPORT_ROWS });

  const log = await sb.from('import_logs').insert({
    agent_id: req.user.userId,
    filename: req.file.originalname,
    total_rows: rows.length,
    successful_rows: rows.length - errors.length,
    failed_rows: errors.length,
    errors: errors.length ? errors : null,
    imported_cooperative_ids: Array.from(createdCoopIds),
    imported_farmer_ids: createdFarmerIds,
  }).select().single();
  // FIXED — the import_logs insert discarded its error, so a failure meant the
  // import had happened but no audit record of it existed; the response then
  // reported `importLog: undefined` as though that were normal.
  if (log.error) {
    logger.error({ err: log.error.message, code: log.error.code }, 'import_logs insert failed');
  }

  await logActivity({ actor: req.user, action: 'bulk_import', entityType: 'import', entityId: log.data?.id, metadata: { total: rows.length, errors: errors.length }, req });

  return created(res, {
    importLog: log.data,
    summary: {
      totalRows: rows.length,
      successful: rows.length - errors.length,
      failed: errors.length,
      cooperativesCreated: createdCoopIds.size,
      farmersCreated: createdFarmerIds.length,
    },
    errors,
  });
}

async function listImports(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  let q = sb.from('import_logs').select('*', { count: 'exact' });
  if (req.user.role === 'field_agent') q = q.eq('agent_id', req.user.userId);
  q = q.order('created_at', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;
  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function downloadTemplate(req, res) {
  // FIXED — the template shipped two fabricated people ("Adaeze Nwosu",
  // "Emeka Okafor") with invented 11-digit NINs against a real-sounding
  // company name. An agent filling this in is very likely to leave a row
  // behind, and a syntactically valid NIN that belongs to nobody is exactly
  // the kind of data that gets submitted to an identity provider and then
  // sits in the farmers table. The example row is now unmistakably a
  // placeholder and carries no NIN at all.
  const csv = [
    'cooperative_name,state,lga,farmer_full_name,gender,phone,nin,date_of_birth,farm_size_acres,crop_type',
    'EXAMPLE - DELETE THIS ROW,Oyo,Akinyele,EXAMPLE FARMER NAME,female,,,,4.5,maize',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="heabron-import-template.csv"');
  return res.send(csv);
}

module.exports = { bulkImport, listImports, downloadTemplate };
