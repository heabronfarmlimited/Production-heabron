'use strict';

/**
 * Farm input -> farm_profiles row.
 *
 * Extracted from `farmers.controller.js` so the create / patch distinction can
 * be tested directly. The v2 flow makes a hard promise about editing — "Only
 * changed fields are sent; omitted fields must never be cleared" — and that
 * promise lives entirely in the difference between `farmRow` (an INSERT, every
 * column supplied, creation defaults applied) and `farmPatch` (only the keys
 * the caller sent). Those two functions being one line apart and untested is
 * how a partial edit came to wipe the crop list, the farm photos and the
 * walked boundary in the first place.
 */

const { measureFarm } = require('../../utils/geo');

const FARM_FIELDS = [
  'farmSizeAcres',
  'cropType',
  'secondaryCrops',
  'soilType',
  'irrigationAccess',
  'waterSource',
  'landOwnership',
  'yearsExperience',
  'landDocumentUrl',
  'landDocumentType',
  'farmPhotoUrls',
];

function extractFarmInput(body) {
  if (body && body.farm && typeof body.farm === 'object') return body.farm;
  const flat = {};
  let any = false;
  for (const key of FARM_FIELDS) {
    if (body && body[key] !== undefined) {
      flat[key] = body[key];
      any = true;
    }
  }
  return any ? flat : null;
}

/** camelCase farm input -> farm_profiles column. */
const FARM_COLUMNS = {
  farmLabel: 'farm_label',
  farmSizeAcres: 'farm_size_acres',
  plotCount: 'plot_count',
  cropType: 'crop_type',
  secondaryCrops: 'secondary_crops',
  soilType: 'soil_type',
  irrigationAccess: 'irrigation_access',
  waterSource: 'water_source',
  landOwnership: 'land_ownership',
  yearsExperience: 'years_experience',
  gpsLat: 'gps_lat',
  gpsLng: 'gps_lng',
  gpsPolygon: 'gps_polygon',
  landDocumentUrl: 'land_document_url',
  landDocumentType: 'land_document_type',
  farmPhotoUrls: 'farm_photo_urls',
};

/**
 * Derive mapped area + centre from a boundary polygon, so the agent doesn't
 * have to type acreage and the farm shows as GPS-mapped. Only fills fields the
 * caller left blank.
 */
function applyPolygonDerivations(row, polygon) {
  if (!polygon) return row;
  const m = measureFarm(polygon);
  if (!m) return row;
  row.gps_mapped = true;
  row.computed_area_acres = m.acres;
  if (row.gps_lat == null) row.gps_lat = m.centroid.lat;
  if (row.gps_lng == null) row.gps_lng = m.centroid.lng;
  if (row.farm_size_acres == null) row.farm_size_acres = m.acres;
  return row;
}

/**
 * Full farm row for an INSERT — creation defaults applied.
 *
 * `isPrimary` is passed explicitly rather than read off the input: whether a
 * farm is the primary one is the server's decision (the first farm is, later
 * ones are not unless promoted), and a client that sent `isPrimary: true` for
 * a second farm would hit the partial unique index as a 23505 instead of a
 * useful error.
 */
function farmRow(farmerId, farm, { isPrimary = false } = {}) {
  const row = { farmer_id: farmerId };
  for (const [key, column] of Object.entries(FARM_COLUMNS)) {
    row[column] = farm[key] ?? null;
  }
  row.plot_count = farm.plotCount || 1;
  row.irrigation_access = farm.irrigationAccess === undefined ? false : !!farm.irrigationAccess;
  row.years_experience = farm.yearsExperience || 0;
  row.is_primary = isPrimary;
  return applyPolygonDerivations(row, farm.gpsPolygon);
}

/**
 * Farm patch for an UPDATE — ONLY the keys the client actually sent.
 *
 * FIXED — `update` reused the INSERT builder, which supplies a value for every
 * column. Any partial farm patch therefore wrote the creation defaults over
 * the agent's real data:
 *   secondary_crops  -> null   (crop list wiped)
 *   farm_photo_urls  -> null   (every farm photo URL dropped)
 *   gps_polygon      -> null   (the walked boundary erased)
 *   irrigation_access-> false
 *   years_experience -> 0
 *   plot_count       -> 1
 * So "change the soil type" quietly deleted the farm photos and reset the
 * farmer's experience to zero. (The Joi layer was injecting those same
 * defaults into the request body — fixed separately in validators/domain.js.)
 */
function farmPatch(farm) {
  const patch = {};
  for (const [key, column] of Object.entries(FARM_COLUMNS)) {
    if (farm[key] !== undefined) patch[column] = farm[key];
  }
  if (farm.irrigationAccess !== undefined) patch.irrigation_access = !!farm.irrigationAccess;
  return applyPolygonDerivations(patch, farm.gpsPolygon);
}

module.exports = {
  FARM_FIELDS,
  FARM_COLUMNS,
  extractFarmInput,
  applyPolygonDerivations,
  farmRow,
  farmPatch,
};
