import {
  cooperativeToForm,
  emptyCooperativeForm,
  parseCooperative,
  toCooperativeBody,
} from '../cooperative';
import { cooperativeFormSchema } from '../validation';

/**
 * The v2 cooperative rules:
 *
 *  - no land size anywhere (it is derived from member farms now);
 *  - exactly one primary crop, which the secondaries must not repeat.
 *
 * `cooperatives.primary_crop` existed in the schema from the start and was
 * read by the credit report, but no endpoint ever wrote it — it was missing
 * from the server validator — so it was NULL for every cooperative. These
 * tests pin that it is now collected and sent.
 */

const form = (over: Partial<ReturnType<typeof emptyCooperativeForm>> = {}) => ({
  ...emptyCooperativeForm(),
  name: 'Oju Farmers Cooperative',
  registrationNumber: 'RC-1234',
  state: 'Benue',
  lga: 'Oju',
  address: '12 Market Road',
  primaryCrop: 'cassava',
  cropsSupported: ['maize'],
  // The cooperative's GPS point is required by the v2 flow ("registration
  // GPS point captured and labelled as the cooperative location"), so a
  // fixture without it fails for a reason unrelated to the crops.
  gpsLat: '6.8512',
  gpsLng: '8.3912',
  ...over,
});

describe('the land-size question is gone', () => {
  it('is not part of the form at all', () => {
    expect('estimatedLandSize' in emptyCooperativeForm()).toBe(false);
  });

  it('is not sent in the request body', () => {
    const body = toCooperativeBody(form(), {});
    expect('estimatedLandSize' in body).toBe(false);
  });

  it('reads the derived land total off the detail response', () => {
    const coop = parseCooperative({
      id: 'c-1',
      name: 'Oju Farmers',
      land: {
        total_land_acres: 42.5,
        farm_count: 31,
        members_with_farms: 28,
        members_without_farms: 12,
      },
    });
    expect(coop.land).toEqual({
      totalLandAcres: 42.5,
      farmCount: 31,
      membersWithFarms: 28,
      membersWithoutFarms: 12,
    });
  });

  it('leaves land null on a list response, so no screen prints 0 acres', () => {
    // A list row carries no total. Rendering 0 would read as "this
    // cooperative has no land" rather than "not counted here".
    expect(parseCooperative({ id: 'c-1', name: 'Oju' }).land).toBeNull();
  });
});

describe('primary crop', () => {
  it('is read from the response', () => {
    expect(parseCooperative({ primary_crop: 'cassava' }).primaryCrop).toBe('cassava');
  });

  it('is sent in the request body', () => {
    expect(toCooperativeBody(form(), {}).primaryCrop).toBe('cassava');
  });

  it('round-trips into the edit form', () => {
    const coop = parseCooperative({
      id: 'c-1',
      name: 'Oju',
      primary_crop: 'yam',
      crops_supported: ['maize'],
      state: 'Benue',
      lga: 'Oju',
    });
    expect(cooperativeToForm(coop).primaryCrop).toBe('yam');
  });

  it('is required — a blank one is what left the column NULL everywhere', () => {
    const result = cooperativeFormSchema.safeParse(form({ primaryCrop: '' }));
    expect(result.success).toBe(false);
  });
});

describe('secondaries cannot repeat the primary', () => {
  it('rejects a duplicate, matching the server rule', () => {
    const result = cooperativeFormSchema.safeParse(
      form({ primaryCrop: 'cassava', cropsSupported: ['cassava', 'maize'] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'cropsSupported')).toBe(true);
    }
  });

  it('ignores case and surrounding space when comparing', () => {
    // The crop values are canonical, but an imported or hand-edited record
    // can carry 'Cassava'. The server lowercases before comparing, so the
    // app must too or it would pass a body the server rejects.
    const result = cooperativeFormSchema.safeParse(
      form({ primaryCrop: 'cassava', cropsSupported: [' Cassava '] }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts distinct crops', () => {
    const result = cooperativeFormSchema.safeParse(
      form({ primaryCrop: 'cassava', cropsSupported: ['maize', 'rice'] }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts no secondaries at all', () => {
    const result = cooperativeFormSchema.safeParse(
      form({ primaryCrop: 'cassava', cropsSupported: [] }),
    );
    expect(result.success).toBe(true);
  });
});
