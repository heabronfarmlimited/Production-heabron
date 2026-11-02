'use strict';

/**
 * Heabron CoopScore — farm set verification
 * -----------------------------------------
 * Run with:  node scripts/verify-farms.js
 *
 * A farmer may hold several farms ("Add Another Farm" in the v2 user flow).
 * Before src/services/farms, every read in the API took
 * `farmer.farm_profiles?.[0]` — one arbitrary row out of an unordered set.
 * These tests pin the three things that went wrong:
 *
 *   1. the farmer's land must be the SUM of their farms, because it is the
 *      denominator of the production score;
 *   2. the order must be deterministic, because PostgREST promises no order
 *      on an embedded select and two reads must not disagree;
 *   3. a cooperative's land total must be derived from member farms, the
 *      agent-entered `estimated_land_size` having been retired.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  toFarmList,
  farmAcres,
  summarizeFarms,
  farmLabel,
  shapeFarms,
  cooperativeLandTotal,
} = require(path.join(__dirname, '..', 'src', 'services', 'farms', 'index.js'));

const farm = (over = {}) => ({
  id: over.id || 'f-1',
  farmer_id: 'farmer-1',
  farm_size_acres: 2,
  computed_area_acres: null,
  gps_mapped: false,
  crop_type: 'maize',
  secondary_crops: [],
  is_primary: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

// ──────────────────────────────────────────────────────────── ordering

test('toFarmList accepts an array, a lone object, null and undefined', () => {
  // PostgREST returns an embedded relationship as an array or a single object
  // depending on how it infers the relationship.
  assert.equal(toFarmList([farm()]).length, 1);
  assert.equal(toFarmList(farm()).length, 1);
  assert.deepEqual(toFarmList(null), []);
  assert.deepEqual(toFarmList(undefined), []);
});

test('the primary farm comes first, then oldest first', () => {
  const list = toFarmList([
    farm({ id: 'c', created_at: '2026-03-01T00:00:00.000Z' }),
    farm({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
    farm({ id: 'b', created_at: '2026-02-01T00:00:00.000Z', is_primary: true }),
  ]);
  assert.deepEqual(list.map((f) => f.id), ['b', 'a', 'c']);
});

test('order is deterministic even when created_at is not selected', () => {
  // Several selects fetch only id and size. Without the id tiebreak the
  // "primary" farm shown on a detail screen could change between requests.
  const rows = [farm({ id: 'z', created_at: undefined }), farm({ id: 'a', created_at: undefined })];
  assert.deepEqual(toFarmList(rows).map((f) => f.id), ['a', 'z']);
  assert.deepEqual(toFarmList([...rows].reverse()).map((f) => f.id), ['a', 'z']);
});

test('toFarmList does not mutate the caller array', () => {
  const rows = [farm({ id: 'b' }), farm({ id: 'a', is_primary: true })];
  toFarmList(rows);
  assert.deepEqual(rows.map((f) => f.id), ['b', 'a']);
});

test('null entries are dropped rather than throwing', () => {
  assert.equal(toFarmList([null, farm(), undefined]).length, 1);
});

// ──────────────────────────────────────────────────────────── acreage

test('the entered size wins over the computed area', () => {
  // An agent can correct the figure after walking a boundary that took in a
  // path or a neighbour's strip. The correction must not be overridden.
  assert.equal(farmAcres(farm({ farm_size_acres: 3, computed_area_acres: 7 })), 3);
});

test('the computed area is used when nothing was entered', () => {
  assert.equal(farmAcres(farm({ farm_size_acres: null, computed_area_acres: 4.25 })), 4.25);
});

test('zero, negative, null and non-numeric all read as no acreage', () => {
  for (const value of [0, -2, null, undefined, '', 'two', NaN]) {
    assert.equal(farmAcres(farm({ farm_size_acres: value, computed_area_acres: null })), 0);
  }
});

test('a numeric string is read, which is how NUMERIC can arrive', () => {
  // supabase-js returns NUMERIC as a string on some driver versions. A string
  // that failed to coerce would silently zero a farmer's land — and so their
  // production score.
  assert.equal(farmAcres(farm({ farm_size_acres: '3.5' })), 3.5);
});

test('a null farm is zero acres, not a crash', () => {
  assert.equal(farmAcres(null), 0);
});

// ──────────────────────────────────────────────────────── farmer totals

test('every farm is summed, not just the first', () => {
  const s = summarizeFarms([
    farm({ id: 'a', farm_size_acres: 2, is_primary: true }),
    farm({ id: 'b', farm_size_acres: 3.5 }),
  ]);
  assert.equal(s.totalAcres, 5.5);
  assert.equal(s.farmCount, 2);
});

test('sums carry no float dust', () => {
  const s = summarizeFarms([
    farm({ id: 'a', farm_size_acres: 0.1 }),
    farm({ id: 'b', farm_size_acres: 0.2 }),
  ]);
  assert.equal(s.totalAcres, 0.3);
});

test('a farmer with no farms has no land and no primary', () => {
  const s = summarizeFarms(null);
  assert.equal(s.totalAcres, 0);
  assert.equal(s.farmCount, 0);
  assert.equal(s.primary, null);
  assert.equal(s.fullyMapped, false);
});

test('the flagged primary is used, falling back to the first farm', () => {
  assert.equal(summarizeFarms([farm({ id: 'a' }), farm({ id: 'b', is_primary: true })]).primary.id, 'b');
  // Legacy rows pre-date the flag, so a farmer may have none set.
  assert.equal(summarizeFarms([farm({ id: 'a' }), farm({ id: 'b' })]).primary.id, 'a');
});

test('mapped acreage is counted separately from total acreage', () => {
  const s = summarizeFarms([
    farm({ id: 'a', farm_size_acres: 2, gps_mapped: true }),
    farm({ id: 'b', farm_size_acres: 3, gps_mapped: false }),
  ]);
  assert.equal(s.totalAcres, 5);
  assert.equal(s.mappedAcres, 2);
  assert.equal(s.mappedCount, 1);
  assert.equal(s.fullyMapped, false);
});

test('fully mapped means every farm has a boundary', () => {
  const s = summarizeFarms([farm({ id: 'a', gps_mapped: true }), farm({ id: 'b', gps_mapped: true })]);
  assert.equal(s.fullyMapped, true);
});

test('crops are collected across all farms, primary crop first', () => {
  const s = summarizeFarms([
    farm({ id: 'a', crop_type: 'maize', secondary_crops: ['soybean'], is_primary: true }),
    farm({ id: 'b', crop_type: 'cassava', secondary_crops: ['maize'] }),
  ]);
  assert.deepEqual(s.crops, ['maize', 'soybean', 'cassava']);
  assert.equal(s.primaryCrop, 'maize');
});

// ──────────────────────────────────────────────────────────── labelling

test('an agent label is used when present, a position number otherwise', () => {
  assert.equal(farmLabel(farm({ farm_label: 'Cassava plot' }), 0), 'Cassava plot');
  assert.equal(farmLabel(farm({ farm_label: null }), 0), 'Farm 1');
  assert.equal(farmLabel(farm({ farm_label: '   ' }), 1), 'Farm 2');
});

test('labels follow the same order as the cards on screen', () => {
  const shaped = shapeFarms([
    farm({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
    farm({ id: 'b', created_at: '2026-02-01T00:00:00.000Z', is_primary: true }),
  ]);
  assert.deepEqual(shaped.map((f) => [f.id, f.label]), [['b', 'Farm 1'], ['a', 'Farm 2']]);
});

test('the shaped farm carries resolved acreage and never null arrays', () => {
  const [shaped] = shapeFarms([
    farm({ farm_size_acres: null, computed_area_acres: 6, secondary_crops: null, farm_photo_urls: null }),
  ]);
  assert.equal(shaped.acres, 6);
  assert.deepEqual(shaped.secondary_crops, []);
  assert.deepEqual(shaped.farm_photo_urls, []);
});

// ─────────────────────────────────────────────────── cooperative totals

test('cooperative land sums across members and their multiple farms', () => {
  const total = cooperativeLandTotal([
    { farm_profiles: [farm({ id: 'a', farm_size_acres: 2 }), farm({ id: 'b', farm_size_acres: 3 })] },
    { farm_profiles: [farm({ id: 'c', farm_size_acres: 1.5 })] },
  ]);
  assert.equal(total.total_land_acres, 6.5);
  assert.equal(total.farm_count, 3);
  assert.equal(total.members_with_farms, 2);
  assert.equal(total.members_without_farms, 0);
});

test('members with no farm are reported rather than hidden', () => {
  // "40 members, 31 with farms" is the number that tells an agent there is
  // onboarding left to finish.
  const total = cooperativeLandTotal([
    { farm_profiles: [farm({ farm_size_acres: 2 })] },
    { farm_profiles: [] },
    { farm_profiles: null },
  ]);
  assert.equal(total.members_with_farms, 1);
  assert.equal(total.members_without_farms, 2);
  assert.equal(total.total_land_acres, 2);
});

test('an empty or null cooperative is zero, not a crash', () => {
  assert.deepEqual(cooperativeLandTotal([]), {
    total_land_acres: 0,
    farm_count: 0,
    members_with_farms: 0,
    members_without_farms: 0,
  });
  assert.equal(cooperativeLandTotal(null).total_land_acres, 0);
});

// ──────────────────────────── farm location is not partner-facing

const {
  maskFarmLocation,
  shapeFarmerForPartner,
} = require(path.join(__dirname, '..', 'src', 'utils', 'shapeFarmer.js'));

const farmerWithFarm = () => ({
  id: 'f-1',
  full_name: 'Ada Nwosu',
  nin: '12345678901',
  address: '12 Market Road',
  farm_profiles: [
    {
      id: 'a',
      gps_lat: 6.8512,
      gps_lng: 8.3912,
      gps_polygon: [{ lat: 6.8512, lng: 8.3912 }],
      gps_mapped: true,
      farm_size_acres: 2,
      crop_type: 'maize',
      farm_photo_urls: ['https://example.test/1.jpg'],
      land_document_url: 'https://example.test/doc.pdf',
      is_primary: true,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
});

test('a lender cannot read a farm\'s exact location', () => {
  // The lender report prints `gpsMapped` and never the coordinates — a
  // lender needs to know the boundary was walked, not where the land is. The
  // browse endpoints select farm_profiles(*), so they used to hand out the
  // centre point and the full boundary ring to anyone with a partner login.
  // A farm boundary is as identifying as the home address, which has always
  // been masked.
  const out = shapeFarmerForPartner(farmerWithFarm());
  assert.equal(out.farm_profiles[0].gps_lat, null);
  assert.equal(out.farm_profiles[0].gps_lng, null);
  assert.equal(out.farm_profiles[0].gps_polygon, null);
  assert.equal(out.farms[0].gps_lat, null);
  assert.equal(out.farm.gpsLat, null);
  assert.equal(out.farm.gpsPolygon, null);
});

test('what a lending decision rests on is still there', () => {
  // Masking has to stop at the point of making the record useless.
  const out = shapeFarmerForPartner(farmerWithFarm());
  assert.equal(out.farm_profiles[0].gps_mapped, true);
  assert.equal(out.farm_profiles[0].farm_size_acres, 2);
  assert.equal(out.farm_profiles[0].crop_type, 'maize');
  assert.equal(out.land.total_land_acres, 2);
});

test('farm photos and the land document are withheld from a browse listing', () => {
  // Signed URLs to pictures of the farm and to the title document are not
  // something a directory needs to hand out.
  const out = shapeFarmerForPartner(farmerWithFarm());
  assert.deepEqual(out.farm_profiles[0].farm_photo_urls, []);
  assert.equal(out.farm_profiles[0].land_document_url, null);
});

test('masking a farm does not mutate the row it was given', () => {
  const farm = { gps_lat: 6.85, gps_lng: 8.39, gps_polygon: [{ lat: 1, lng: 2 }] };
  maskFarmLocation(farm);
  assert.equal(farm.gps_lat, 6.85);
});

test('masking survives a null or oddly shaped farm', () => {
  assert.equal(maskFarmLocation(null), null);
  assert.equal(maskFarmLocation(undefined), undefined);
  assert.deepEqual(maskFarmLocation({}), {});
});

test('a farmer with no farms is masked without error', () => {
  const out = shapeFarmerForPartner({ id: 'f-2', full_name: 'Bio Oche' });
  assert.equal(out.farm, null);
  assert.deepEqual(out.farms, []);
});
