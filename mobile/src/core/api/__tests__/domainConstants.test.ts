/**
 * Guards the label -> API-value mapping.
 *
 * This is the main correctness fix in the port: the Flutter app sent display
 * labels straight to the API, so `soilType: 'Lateritic (Red/Brown)'` and
 * `waterSource: 'River / Stream'` were stored as free text, and the strictly
 * validated fields would have rejected a mismatched label outright.
 *
 * The expected values below come from backend/src/validators/domain.js. If a
 * validator changes, these tests should fail before a user sees a 422.
 */
import {
  CONTEXT_FLAGS,
  CREDIT_TIERS,
  CROPS,
  FINANCING_SEASONS,
  GENDERS,
  LAND_OWNERSHIPS,
  LIMITS,
  MAX_SECONDARY_CROPS,
  NOTE_TYPES,
  PAYMENT_METHODS,
  PRICE_CONTEXTS,
  REPAYMENT_WINDOW,
  SOIL_TYPES,
  TAG_VARIANTS,
  WATER_SOURCES,
  labelFor,
  seasonYearOptions,
} from '../domainConstants';

const values = (options: readonly { value: string }[]) => options.map((o) => o.value);

describe('values accepted by strict Joi enums', () => {
  it('gender matches valid("male","female","other")', () => {
    expect(values(GENDERS)).toEqual(['male', 'female', 'other']);
  });

  it('financing season matches valid("wet","dry","all_year")', () => {
    expect(values(FINANCING_SEASONS)).toEqual(['wet', 'dry', 'all_year']);
  });

  it('payment method covers all seven the backend accepts', () => {
    // The Flutter dropdown exposed only the first four.
    expect(values(PAYMENT_METHODS)).toEqual([
      'cash',
      'bank_transfer',
      'mobile_money',
      'card',
      'pos',
      'cheque',
      'in_kind',
    ]);
  });

  it('context flag matches valid("none","weather","market","health")', () => {
    expect(values(CONTEXT_FLAGS)).toEqual(['none', 'weather', 'market', 'health']);
  });

  it('price context matches valid("distress","market","confirmed","pre_agreed")', () => {
    expect(values(PRICE_CONTEXTS)).toEqual([
      'distress',
      'market',
      'confirmed',
      'pre_agreed',
    ]);
  });

  it('note type matches the six valid values', () => {
    expect(values(NOTE_TYPES)).toEqual([
      'assessment',
      'disbursement',
      'repayment',
      'registration',
      'visit',
      'general',
    ]);
  });

  it('tag variant matches valid("green","amber","neutral")', () => {
    expect(values(TAG_VARIANTS)).toEqual(['green', 'amber', 'neutral']);
  });

  it('credit tier is uppercase A-D, as the listQuery validator requires', () => {
    // The Flutter filter was a free-text field, so anything else 422'd.
    expect(values(CREDIT_TIERS)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('free-text fields still use canonical values', () => {
  it('soil types use the documented snake_case forms, not display labels', () => {
    expect(values(SOIL_TYPES)).toEqual([
      'sandy',
      'lateritic_red_brown',
      'forest',
      'alluvial',
      'hydromorphic_fadama',
    ]);
    // The label a user sees is unchanged from the Flutter app.
    expect(SOIL_TYPES[1]?.label).toBe('Lateritic (Red/Brown)');
  });

  it('water sources map the documented four plus the extra labels agents use', () => {
    const byValue = values(WATER_SOURCES);
    expect(byValue).toContain('rain_fed');
    expect(byValue).toContain('river_stream');
    expect(byValue).toContain('well');
    expect(byValue).toContain('artificial_irrigation');
    // No value contains a space or slash that would end up in the database.
    byValue.forEach((v) => expect(v).toMatch(/^[a-z_]+$/));
  });

  it('land ownership values are snake_case', () => {
    values(LAND_OWNERSHIPS).forEach((v) => expect(v).toMatch(/^[a-z_]+$/));
  });

  it('keeps all 18 crops and emits snake_case values', () => {
    expect(CROPS).toHaveLength(18);
    expect(CROPS.map((c) => c.label)).toContain('Palm Oil');
    expect(values(CROPS)).toContain('palm_oil');
  });
});

describe('limits taken from the validators', () => {
  it('caps secondary crops at the validator maximum of 7', () => {
    expect(MAX_SECONDARY_CROPS).toBe(7);
  });

  it('bounds the repayment window to 30-540 days, defaulting to 180', () => {
    expect(REPAYMENT_WINDOW).toEqual({ min: 30, max: 540, default: 180 });
  });

  it('allows zero dependents, which the Flutter form wrongly forbade', () => {
    expect(LIMITS.dependents.min).toBe(0);
    expect(LIMITS.householdSize.min).toBe(1);
  });

  it('caps pageSize at the validator maximum of 100', () => {
    expect(LIMITS.pageSize.max).toBe(100);
  });

  it('bounds coordinates to the validator ranges', () => {
    expect(LIMITS.latitude).toEqual({ min: -90, max: 90 });
    expect(LIMITS.longitude).toEqual({ min: -180, max: 180 });
  });

  it('requires at least 3 polygon points for farm mapping', () => {
    expect(LIMITS.minPolygonPoints).toBe(3);
  });

  it('accepts an 11-digit NIN and a 10-digit account number', () => {
    expect(LIMITS.ninPattern.test('12345678901')).toBe(true);
    expect(LIMITS.ninPattern.test('1234567890')).toBe(false);
    expect(LIMITS.accountNumberPattern.test('0123456789')).toBe(true);
    expect(LIMITS.accountNumberPattern.test('012345678')).toBe(false);
  });

  it('accepts Nigerian phone formats the validator allows', () => {
    expect(LIMITS.phonePattern.test('08012345678')).toBe(true);
    expect(LIMITS.phonePattern.test('+2348012345678')).toBe(true);
    expect(LIMITS.phonePattern.test('0801234')).toBe(true); // 7 digits, the floor
    expect(LIMITS.phonePattern.test('080123')).toBe(false);
    expect(LIMITS.phonePattern.test('0801234567a')).toBe(false);
  });
});

describe('labelFor', () => {
  it('maps a stored value back to its display label', () => {
    expect(labelFor(SOIL_TYPES, 'lateritic_red_brown')).toBe('Lateritic (Red/Brown)');
    expect(labelFor(PAYMENT_METHODS, 'bank_transfer')).toBe('Bank Transfer');
  });

  it('is case-insensitive, since some rows were written uppercase', () => {
    expect(labelFor(GENDERS, 'MALE')).toBe('Male');
  });

  it('humanises an unknown value rather than hiding it', () => {
    // Legacy rows written by the Flutter app contain arbitrary free text.
    expect(labelFor(WATER_SOURCES, 'hand_dug_pit')).toBe('Hand Dug Pit');
  });

  it('returns an empty string for a missing value', () => {
    expect(labelFor(GENDERS, null)).toBe('');
    expect(labelFor(GENDERS, undefined)).toBe('');
  });
});

describe('seasonYearOptions', () => {
  it('spans two years back to two years forward', () => {
    const options = seasonYearOptions(new Date('2026-06-01T00:00:00Z'));
    expect(options.map((o) => o.value)).toEqual([
      '2024',
      '2025',
      '2026',
      '2027',
      '2028',
    ]);
  });
});
