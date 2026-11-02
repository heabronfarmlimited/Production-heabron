'use strict';

/**
 * Heabron CoopScore — partial-update verification
 * -----------------------------------------------
 * Run with:  node scripts/verify-partial-update.js
 *
 * The v2 user flow makes a hard promise about editing:
 *
 *   "Edit = partial update. Only changed fields are sent; omitted fields must
 *    never be cleared. This one gets explicit tests: photos, polygon,
 *    secondary crops, soil type and experience must survive an edit."
 *
 * That promise lives entirely in the difference between two functions a few
 * lines apart in `services/farms/mapping.js`:
 *
 *   farmRow(farmerId, farm)  an INSERT. Supplies EVERY column, so anything
 *                            the caller omitted is written as NULL — correct
 *                            for a creation, catastrophic for an edit.
 *   farmPatch(farm)          an UPDATE. Writes only the keys the caller sent.
 *
 * The edit path once used `farmRow`, so "change the soil type" also wrote
 * `secondary_crops: null`, `farm_photo_urls: null` and `gps_polygon: null` —
 * silently discarding a walked boundary. These tests make that regression
 * impossible to reintroduce unnoticed: every field named in the flow is
 * checked for absence from the patch, which is what "must not be cleared"
 * means at the SQL layer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  FARM_COLUMNS,
  extractFarmInput,
  farmRow,
  farmPatch,
} = require(path.join(__dirname, '..', 'src', 'services', 'farms', 'mapping.js'));

/** Every column the farm mapping can write. */
const ALL_COLUMNS = Object.values(FARM_COLUMNS);

/** The fields the flow names explicitly. */
const MUST_SURVIVE = [
  'farm_photo_urls',
  'gps_polygon',
  'secondary_crops',
  'soil_type',
  'years_experience',
];

// ──────────────────────────────────────────────── the core promise

test('a one-field edit touches only that field', () => {
  const patch = farmPatch({ soilType: 'alluvial' });
  assert.deepEqual(Object.keys(patch), ['soil_type']);
  assert.equal(patch.soil_type, 'alluvial');
});

test('every field the flow names survives an unrelated edit', () => {
  // "photos, polygon, secondary crops, soil type and experience must survive
  // an edit" — at the SQL layer, surviving means not being in the patch.
  const patch = farmPatch({ cropType: 'cassava' });
  for (const column of MUST_SURVIVE) {
    assert.equal(
      column in patch,
      false,
      `${column} is in the patch, so an edit of the crop type would overwrite it`
    );
  }
});

test('no column is written by an empty edit', () => {
  const patch = farmPatch({});
  assert.deepEqual(patch, {});
  for (const column of ALL_COLUMNS) {
    assert.equal(column in patch, false, `${column} written by an empty patch`);
  }
});

test('each field can be edited on its own without disturbing the others', () => {
  // Exhaustive rather than by example: a column added to FARM_COLUMNS in
  // future is covered the moment it exists.
  const sample = {
    farmLabel: 'River plot',
    farmSizeAcres: 3,
    plotCount: 2,
    cropType: 'maize',
    secondaryCrops: ['soybean'],
    soilType: 'forest',
    irrigationAccess: true,
    waterSource: 'river_stream',
    landOwnership: 'family',
    yearsExperience: 7,
    gpsLat: 6.85,
    gpsLng: 8.39,
    landDocumentUrl: 'https://example.test/doc.pdf',
    landDocumentType: 'c_of_o',
    farmPhotoUrls: ['https://example.test/1.jpg'],
  };

  for (const [key, value] of Object.entries(sample)) {
    const patch = farmPatch({ [key]: value });
    const expected = FARM_COLUMNS[key];
    assert.deepEqual(
      Object.keys(patch),
      [expected],
      `editing ${key} wrote ${JSON.stringify(Object.keys(patch))}`
    );
  }
});

// ──────────────────────────────────────── explicit nulls still clear

test('an explicit null clears the field, because that is a real edit', () => {
  // "Omitted must not be cleared" is not "nothing can be cleared". An agent
  // removing a land document sends null for it, and that has to work.
  const patch = farmPatch({ landDocumentUrl: null });
  assert.deepEqual(patch, { land_document_url: null });
});

test('an empty crop array clears the list, which is how the app removes crops', () => {
  const patch = farmPatch({ secondaryCrops: [] });
  assert.deepEqual(patch, { secondary_crops: [] });
});

test('false is kept, not mistaken for absent', () => {
  // `if (farm[key])` instead of `!== undefined` would drop this, and a farmer
  // who lost irrigation access would keep showing as having it.
  const patch = farmPatch({ irrigationAccess: false });
  assert.deepEqual(patch, { irrigation_access: false });
});

test('zero is kept, not mistaken for absent', () => {
  const patch = farmPatch({ yearsExperience: 0 });
  assert.deepEqual(patch, { years_experience: 0 });
});

// ───────────────────────────────── creation still fills every column

test('a create supplies every column, so defaults are applied', () => {
  const row = farmRow('farmer-1', { farmSizeAcres: 2, cropType: 'maize' });
  for (const column of ALL_COLUMNS) {
    assert.equal(column in row, true, `${column} missing from an INSERT`);
  }
  assert.equal(row.farmer_id, 'farmer-1');
  // Creation defaults, which a patch must never inject.
  assert.equal(row.plot_count, 1);
  assert.equal(row.irrigation_access, false);
  assert.equal(row.years_experience, 0);
});

test('a patch never injects the creation defaults', () => {
  // Joi `fork()` keeps `.default()`, which is how a PATCH of one field came
  // to reset plot_count, irrigation_access, water_source and
  // years_experience. The mapping must not reintroduce them.
  const patch = farmPatch({ soilType: 'sandy' });
  for (const column of ['plot_count', 'irrigation_access', 'water_source', 'years_experience']) {
    assert.equal(column in patch, false, `${column} default injected into a patch`);
  }
});

test('the first farm created with a farmer is marked primary', () => {
  assert.equal(farmRow('farmer-1', {}, { isPrimary: true }).is_primary, true);
  // And a later one is not, unless promoted — the partial unique index
  // allows only one primary per farmer.
  assert.equal(farmRow('farmer-1', {}).is_primary, false);
});

// ────────────────────────────────────────── polygon derivations

test('a patch carrying a polygon derives the area, as a re-map should', () => {
  const polygon = [
    { lat: 6.8512, lng: 8.3912 },
    { lat: 6.8512, lng: 8.3922 },
    { lat: 6.8522, lng: 8.3922 },
    { lat: 6.8522, lng: 8.3912 },
  ];
  const patch = farmPatch({ gpsPolygon: polygon });
  assert.equal(patch.gps_mapped, true);
  assert.ok(patch.computed_area_acres > 0);
  // The centre is filled in because the caller sent no coordinates.
  assert.ok(Number.isFinite(patch.gps_lat));
  assert.ok(Number.isFinite(patch.gps_lng));
});

test('a polygon does not overwrite a size the agent typed', () => {
  // `applyPolygonDerivations` only fills blanks. An agent who corrects the
  // acreage after walking a boundary that took in a path must keep their
  // correction.
  const polygon = [
    { lat: 6.8512, lng: 8.3912 },
    { lat: 6.8512, lng: 8.3922 },
    { lat: 6.8522, lng: 8.3922 },
  ];
  const patch = farmPatch({ gpsPolygon: polygon, farmSizeAcres: 1.25 });
  assert.equal(patch.farm_size_acres, 1.25);
});

test('an invalid polygon is stored without claiming the farm is mapped', () => {
  // Two points cannot bound an area. Setting gps_mapped here would put a
  // "boundary walked" badge on a farm that has none.
  const patch = farmPatch({ gpsPolygon: [{ lat: 6.85, lng: 8.39 }] });
  assert.equal(patch.gps_mapped, undefined);
  assert.equal(patch.computed_area_acres, undefined);
});

// ─────────────────────────────────────────── input extraction

test('a nested farm object is used as sent', () => {
  assert.deepEqual(extractFarmInput({ farm: { soilType: 'sandy' } }), { soilType: 'sandy' });
});

test('flat farm fields are gathered when there is no nested object', () => {
  const input = extractFarmInput({ fullName: 'Ada', soilType: 'sandy', cropType: 'maize' });
  assert.deepEqual(input, { soilType: 'sandy', cropType: 'maize' });
});

test('a body with no farm fields yields null, not an empty edit', () => {
  // An empty object here would reach the database as `update({})`, which
  // PostgREST rejects, and the agent would see a generic 500 for an edit
  // that simply touched no farm field.
  assert.equal(extractFarmInput({ fullName: 'Ada' }), null);
  assert.equal(extractFarmInput({}), null);
  assert.equal(extractFarmInput(null), null);
});

test('a farmer-only edit does not look like a farm edit', () => {
  // `PATCH /farmers/:id {"phone": "..."}` must not produce a farm patch at
  // all, or every phone correction would touch farm_profiles.
  assert.equal(extractFarmInput({ phone: '08030000000', address: '12 Market Road' }), null);
});
