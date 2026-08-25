'use strict';

const { parse } = require('csv-parse/sync');
const { supabaseAdmin } = require('../config/supabase');
const { ok, created, badRequest, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer } = require('../services/credit-score');

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
        const { data: existing } = await sb
          .from('cooperatives')
          .select('id')
          .eq('name', coopName)
          .eq('created_by_agent_id', req.user.userId)
          .maybeSingle();
        if (existing) {
          coopId = existing.id;
        } else {
          const { data: createdCoop, error: coopErr } = await sb.from('cooperatives').insert({
            name: coopName,
            state,
            lga,
            crops_supported: cropType ? [cropType] : null,
            created_by_agent_id: req.user.userId,
          }).select().single();
          if (coopErr) throw coopErr;
          coopId = createdCoop.id;
          createdCoopIds.add(coopId);
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
        await sb.from('farm_profiles').insert({
          farmer_id: farmer.id,
          farm_size_acres: farmSize,
          crop_type: cropType,
        });
      }

      safeRecalculateFarmer(farmer.id, { triggerReason: 'csv_import' });
    } catch (err) {
      errors.push({ line: lineNo, message: err.message });
    }
  }

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
  const csv = [
    'cooperative_name,state,lga,farmer_full_name,gender,phone,nin,date_of_birth,farm_size_acres,crop_type',
    'Hamsel Industries,Oyo,Akinyele,Adaeze Nwosu,female,08012345678,12345678901,1985-03-15,4.5,maize',
    'Hamsel Industries,Oyo,Akinyele,Emeka Okafor,male,08087654321,98765432109,1980-07-22,3.2,maize',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="heabron-import-template.csv"');
  return res.send(csv);
}

module.exports = { bulkImport, listImports, downloadTemplate };
