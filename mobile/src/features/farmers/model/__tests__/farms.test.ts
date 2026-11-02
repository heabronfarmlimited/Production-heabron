import {
  farmDisplayLabel,
  parseFarmProfile,
  parseFarmer,
  parseFarmerFarmSet,
  parseFarmerLand,
  resolveFarm,
  resolveFarmProfileId,
  resolveFarms,
  resolveLandAcres,
} from '../farmer';

/**
 * A farmer may hold several farms (v2 "Add Another Farm").
 *
 * These tests pin the rules that stop the app and the server disagreeing
 * about a farmer's land — which matters because land is the denominator of
 * the production score, so a difference here shows up as a different credit
 * score in the app than on the lender's report.
 */

const row = (over: Record<string, unknown> = {}) => ({
  id: 'f-1',
  farmer_id: 'farmer-1',
  farm_label: null,
  is_primary: false,
  farm_size_acres: 2,
  computed_area_acres: null,
  gps_mapped: false,
  crop_type: 'maize',
  secondary_crops: [],
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('parseFarmProfile', () => {
  it('reads the v2 columns, including the server-resolved label and acreage', () => {
    const farm = parseFarmProfile(
      row({ farm_label: 'Cassava plot', is_primary: true, label: 'Cassava plot', acres: 2 }),
    );
    expect(farm.farmLabel).toBe('Cassava plot');
    expect(farm.isPrimary).toBe(true);
    expect(farm.label).toBe('Cassava plot');
    expect(farm.acres).toBe(2);
  });

  it('defaults isPrimary to false rather than undefined', () => {
    // A farm row from an older server has no flag. Treating the absence as
    // "primary" would make every farm the main farm.
    const farm = parseFarmProfile(row({ is_primary: undefined }));
    expect(farm.isPrimary).toBe(false);
  });

  it('survives a malformed row without throwing', () => {
    expect(() => parseFarmProfile(null)).not.toThrow();
    expect(parseFarmProfile({}).isPrimary).toBe(false);
  });
});

describe('parseFarmerLand', () => {
  it('reads the snake_case totals', () => {
    const land = parseFarmerLand({
      farm_count: 3,
      total_land_acres: 6.5,
      mapped_land_acres: 2,
      mapped_farm_count: 1,
      fully_mapped: false,
      crops: ['maize', 'cassava'],
      primary_crop: 'maize',
    });
    expect(land).toEqual({
      farmCount: 3,
      totalLandAcres: 6.5,
      mappedLandAcres: 2,
      mappedFarmCount: 1,
      fullyMapped: false,
      crops: ['maize', 'cassava'],
      primaryCrop: 'maize',
    });
  });

  it('is null when the server did not send it', () => {
    // List responses carry no totals; a zeroed object would render as "0
    // acres" for a farmer who has land.
    expect(parseFarmerLand(undefined)).toBeNull();
    expect(parseFarmerLand(null)).toBeNull();
  });
});

describe('parseFarmerFarmSet', () => {
  it('reads the farms endpoint response', () => {
    const set = parseFarmerFarmSet({
      farmer_id: 'farmer-1',
      farms: [row({ id: 'a', is_primary: true }), row({ id: 'b' })],
      land: { farm_count: 2, total_land_acres: 4 },
    });
    expect(set.farmerId).toBe('farmer-1');
    expect(set.farms.map((f) => f.id)).toEqual(['a', 'b']);
    expect(set.land?.totalLandAcres).toBe(4);
  });

  it('returns an empty set rather than throwing on a bad payload', () => {
    expect(parseFarmerFarmSet(null).farms).toEqual([]);
    expect(parseFarmerFarmSet({}).land).toBeNull();
  });
});

describe('resolveFarms', () => {
  it('uses the server order when `farms` is present', () => {
    const farmer = parseFarmer({
      id: 'farmer-1',
      farms: [row({ id: 'b', is_primary: true }), row({ id: 'a' })],
    });
    expect(resolveFarms(farmer).map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('pulls the primary farm to the front of an unordered farm_profiles', () => {
    // An embedded PostgREST select has no promised order, so without this the
    // cards could reorder between reads of the same farmer.
    const farmer = parseFarmer({
      id: 'farmer-1',
      farm_profiles: [
        row({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
        row({ id: 'b', created_at: '2026-02-01T00:00:00.000Z', is_primary: true }),
      ],
    });
    expect(resolveFarms(farmer).map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('is empty for a farmer with no farms, and for no farmer', () => {
    expect(resolveFarms(parseFarmer({ id: 'x' }))).toEqual([]);
    expect(resolveFarms(null)).toEqual([]);
  });
});

describe('resolveFarm', () => {
  it('prefers the server-picked `farm` object', () => {
    const farmer = parseFarmer({
      id: 'farmer-1',
      farm: { farmSizeAcres: 9, cropType: 'yam' },
      farm_profiles: [row({ id: 'a', farm_size_acres: 1 })],
    });
    expect(resolveFarm(farmer)?.farmSizeAcres).toBe(9);
  });

  it('falls back to the primary farm, not an arbitrary row', () => {
    const farmer = parseFarmer({
      id: 'farmer-1',
      farm_profiles: [
        row({ id: 'a', farm_size_acres: 1 }),
        row({ id: 'b', farm_size_acres: 5, is_primary: true }),
      ],
    });
    expect(resolveFarm(farmer)?.farmSizeAcres).toBe(5);
  });

  it('is null when the farmer has no farm at all', () => {
    expect(resolveFarm(parseFarmer({ id: 'x' }))).toBeNull();
  });
});

describe('resolveFarmProfileId', () => {
  it('returns the primary farm row id', () => {
    const farmer = parseFarmer({
      id: 'farmer-1',
      farm_profiles: [row({ id: 'a' }), row({ id: 'b', is_primary: true })],
    });
    expect(resolveFarmProfileId(farmer)).toBe('b');
  });
});

describe('resolveLandAcres', () => {
  it('uses the server total when present', () => {
    const farmer = parseFarmer({
      id: 'farmer-1',
      land: { farm_count: 2, total_land_acres: 7.5 },
      farm_profiles: [row({ farm_size_acres: 1 })],
    });
    expect(resolveLandAcres(farmer)).toBe(7.5);
  });

  it('sums every farm when the server sent no total', () => {
    // The whole point of the change: one plot's acreage is not the farmer's
    // land.
    const farmer = parseFarmer({
      id: 'farmer-1',
      farm_profiles: [
        row({ id: 'a', farm_size_acres: 2 }),
        row({ id: 'b', farm_size_acres: 3.5 }),
      ],
    });
    expect(resolveLandAcres(farmer)).toBe(5.5);
  });

  it('sums without float dust', () => {
    const farmer = parseFarmer({
      id: 'farmer-1',
      farm_profiles: [
        row({ id: 'a', farm_size_acres: 0.1 }),
        row({ id: 'b', farm_size_acres: 0.2 }),
      ],
    });
    expect(resolveLandAcres(farmer)).toBe(0.3);
  });

  it('falls back to the walked area when no size was entered', () => {
    const farmer = parseFarmer({
      id: 'farmer-1',
      farm_profiles: [row({ farm_size_acres: null, computed_area_acres: 4 })],
    });
    expect(resolveLandAcres(farmer)).toBe(4);
  });

  it('is null — not 0 — for a farmer with no farms', () => {
    // "No farm recorded" and "a farm of no size" need different wording on
    // screen, so the two must stay distinguishable.
    expect(resolveLandAcres(parseFarmer({ id: 'x' }))).toBeNull();
    expect(resolveLandAcres(null)).toBeNull();
  });
});

describe('farmDisplayLabel', () => {
  it('prefers the server label, then the raw one, then the position', () => {
    expect(farmDisplayLabel(parseFarmProfile(row({ label: 'Farm 2' })), 0)).toBe('Farm 2');
    expect(
      farmDisplayLabel(parseFarmProfile(row({ farm_label: 'River plot' })), 3),
    ).toBe('River plot');
    expect(farmDisplayLabel(parseFarmProfile(row()), 1)).toBe('Farm 2');
  });

  it('numbers an undefined farm by position rather than crashing', () => {
    expect(farmDisplayLabel(undefined, 0)).toBe('Farm 1');
  });
});
