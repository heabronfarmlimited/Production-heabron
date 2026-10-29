/**
 * Domain option lists — the single source of truth for every dropdown.
 *
 * Each entry pairs the LABEL shown to the user (taken verbatim from the
 * Flutter screens, so the UI reads identically) with the VALUE the backend
 * accepts (taken from backend/src/validators/domain.js).
 *
 * This mapping layer is the main correctness fix in the port. The Flutter app
 * sent display labels straight to the API — e.g. `soilType: 'Lateritic
 * (Red/Brown)'` and `waterSource: 'River / Stream'` — where the backend
 * documents canonical snake_case values. Those two fields are free TEXT
 * server-side so they didn't 422, but they stored inconsistent data that the
 * credit-score service and admin portal then had to interpret. Fields that ARE
 * validated (`season`, `paymentMethod`, `priceContext`, `noteType`,
 * `tagVariant`, `gender`, `tier`) would reject a mismatched label outright.
 */

export interface Option<T extends string = string> {
  /** Shown in the UI. */
  label: string;
  /** Sent to / received from the API. */
  value: T;
}

/** Resolves an API value back to its display label. */
export function labelFor<T extends string>(
  options: readonly Option<T>[],
  value?: string | null,
): string {
  if (!value) return '';
  const match = options.find((o) => o.value === value.toLowerCase());
  if (match) return match.label;
  // Unknown value (free-text field, or legacy data written by the Flutter
  // app) — present it readably rather than hiding it.
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convenience for `<Picker>`-style components that want plain label arrays. */
export const labels = <T extends string>(options: readonly Option<T>[]): string[] =>
  options.map((o) => o.label);

// ---------------------------------------------------------------- gender
/** Validator: `Joi.string().lowercase().valid('male','female','other')` */
export const GENDERS = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
] as const satisfies readonly Option[];

// ----------------------------------------------------------------- crops
/**
 * The 18 crops from the Flutter `CropTypeSelector` / primary-crop dropdown.
 * `cropType` is free text server-side; lowercase values keep storage
 * consistent with the CSV import template (which uses `maize`).
 */
export const CROPS = [
  { label: 'Maize', value: 'maize' },
  { label: 'Rice', value: 'rice' },
  { label: 'Cassava', value: 'cassava' },
  { label: 'Yam', value: 'yam' },
  { label: 'Sorghum', value: 'sorghum' },
  { label: 'Millet', value: 'millet' },
  { label: 'Groundnut', value: 'groundnut' },
  { label: 'Cowpea', value: 'cowpea' },
  { label: 'Soybean', value: 'soybean' },
  { label: 'Wheat', value: 'wheat' },
  { label: 'Tomato', value: 'tomato' },
  { label: 'Onion', value: 'onion' },
  { label: 'Pepper', value: 'pepper' },
  { label: 'Plantain', value: 'plantain' },
  { label: 'Cocoa', value: 'cocoa' },
  { label: 'Palm Oil', value: 'palm_oil' },
  { label: 'Cotton', value: 'cotton' },
  { label: 'Other', value: 'other' },
] as const satisfies readonly Option[];

/** `farm.secondaryCrops` is `Joi.array().items(string).max(7)`. */
export const MAX_SECONDARY_CROPS = 7;

// ------------------------------------------------------------- soil type
/**
 * Nigerian soil classifications. Labels are the ones APP_DEV_HANDOFF.md says
 * were aligned in the Flutter app; values are the canonical forms documented
 * in the `createFarmer` validator comment.
 */
export const SOIL_TYPES = [
  { label: 'Sandy', value: 'sandy' },
  { label: 'Lateritic (Red/Brown)', value: 'lateritic_red_brown' },
  { label: 'Forest', value: 'forest' },
  { label: 'Alluvial', value: 'alluvial' },
  { label: 'Hydromorphic (Fadama)', value: 'hydromorphic_fadama' },
] as const satisfies readonly Option[];

// ----------------------------------------------------------- water source
/**
 * The validator documents four canonical values
 * (`rain_fed | artificial_irrigation | river_stream | well`) and defaults to
 * `rain_fed`. The Flutter dropdown offered eight labels; the four extra ones
 * are kept because the field is free text and agents do use them, but each
 * maps to a stable snake_case value instead of a label with spaces and
 * slashes.
 */
export const WATER_SOURCES = [
  { label: 'Rain-fed', value: 'rain_fed' },
  { label: 'River / Stream', value: 'river_stream' },
  { label: 'Well', value: 'well' },
  { label: 'Borehole', value: 'borehole' },
  { label: 'Irrigation Canal', value: 'artificial_irrigation' },
  { label: 'Dam / Reservoir', value: 'dam_reservoir' },
  { label: 'Pond', value: 'pond' },
  { label: 'Other', value: 'other' },
] as const satisfies readonly Option[];

export const DEFAULT_WATER_SOURCE = 'rain_fed';

// --------------------------------------------------------- land ownership
export const LAND_OWNERSHIPS = [
  { label: 'Owned', value: 'owned' },
  { label: 'Leased', value: 'leased' },
  { label: 'Communal', value: 'communal' },
  { label: 'Rented', value: 'rented' },
  { label: 'Family Land', value: 'family_land' },
  { label: 'Government Allocation', value: 'government_allocation' },
  { label: 'Other', value: 'other' },
] as const satisfies readonly Option[];

// --------------------------------------------------------- payment method
/**
 * Validator: `valid('cash','bank_transfer','mobile_money','card','pos','cheque','in_kind')`
 *
 * The Flutter dropdown exposed only the first four AND displayed the raw
 * snake_case values to the user. All seven are offered here with readable
 * labels — `pos` and `cheque` in particular are common in Nigerian field
 * collections, and APP_DEV_HANDOFF.md confirms the backend accepts them.
 */
export const PAYMENT_METHODS = [
  { label: 'Cash', value: 'cash' },
  { label: 'Bank Transfer', value: 'bank_transfer' },
  { label: 'Mobile Money', value: 'mobile_money' },
  { label: 'Card', value: 'card' },
  { label: 'POS', value: 'pos' },
  { label: 'Cheque', value: 'cheque' },
  { label: 'In Kind', value: 'in_kind' },
] as const satisfies readonly Option[];

export const DEFAULT_PAYMENT_METHOD = 'cash';

// ----------------------------------------------------------- context flag
/** Validator: `valid('none','weather','market','health')`, default `none`. */
export const CONTEXT_FLAGS = [
  { label: 'None', value: 'none' },
  { label: 'Weather', value: 'weather' },
  { label: 'Market', value: 'market' },
  { label: 'Health', value: 'health' },
] as const satisfies readonly Option[];

export const DEFAULT_CONTEXT_FLAG = 'none';

/** Explainer copy shown beside the Context Flag field, from the Flutter screen. */
export const CONTEXT_FLAG_HELP =
  'Context Flag allows agents to mark late repayments caused by genuine ' +
  'external events (weather, market, health) so they are excluded from ' +
  'credit score timeliness penalties.';

// --------------------------------------------------------------- seasons
/**
 * Validator: `valid('wet','dry','all_year')` — **required and enforced**.
 * The Flutter app built this value with
 * `[if (s == 'all year') 'all_year' else s.toLowerCase()].join(',')`,
 * which is fragile; a plain mapping is used instead.
 */
export const FINANCING_SEASONS = [
  { label: 'Wet', value: 'wet' },
  { label: 'Dry', value: 'dry' },
  { label: 'All Year', value: 'all_year' },
] as const satisfies readonly Option[];

export const DEFAULT_FINANCING_SEASON = 'wet';

/** `repaymentWindowDays`: `integer().min(30).max(540).default(180)`. */
export const REPAYMENT_WINDOW = { min: 30, max: 540, default: 180 } as const;

// ---------------------------------------------------------- price context
/** Validator: `valid('distress','market','confirmed','pre_agreed')`. */
export const PRICE_CONTEXTS = [
  { label: 'Distress', value: 'distress' },
  { label: 'Market', value: 'market' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Pre-agreed', value: 'pre_agreed' },
] as const satisfies readonly Option[];

// -------------------------------------------------------------- note type
/**
 * Validator: `valid('assessment','disbursement','repayment','registration','visit','general')`,
 * default `general`.
 */
export const NOTE_TYPES = [
  { label: 'Assessment', value: 'assessment' },
  { label: 'Disbursement', value: 'disbursement' },
  { label: 'Repayment', value: 'repayment' },
  { label: 'Registration', value: 'registration' },
  { label: 'Visit', value: 'visit' },
  { label: 'General', value: 'general' },
] as const satisfies readonly Option[];

export const DEFAULT_NOTE_TYPE = 'general';

/** Validator: `valid('green','amber','neutral')`, default `green`. */
export const TAG_VARIANTS = [
  { label: 'Green', value: 'green' },
  { label: 'Amber', value: 'amber' },
  { label: 'Neutral', value: 'neutral' },
] as const satisfies readonly Option[];

export const DEFAULT_TAG_VARIANT = 'green';

// ------------------------------------------------------------------ tiers
/**
 * Validator: the `tier` list filter is `valid('A','B','C','D')` — **uppercase**.
 * The Flutter filter sheet was a free-text field hinting "e.g. A, B", so any
 * other input produced a 422. This is a fixed four-option picker instead.
 */
export const CREDIT_TIERS = [
  { label: 'Tier A', value: 'A' },
  { label: 'Tier B', value: 'B' },
  { label: 'Tier C', value: 'C' },
  { label: 'Tier D', value: 'D' },
] as const satisfies readonly Option[];

/** Delivery `qualityGrade`: `valid('A','B','C','D')`. */
export const QUALITY_GRADES = CREDIT_TIERS.map((t) => ({
  label: `Grade ${t.value}`,
  value: t.value,
}));

// --------------------------------------------------------------- statuses
/** Financing / settlement statuses the UI filters and badges on. */
export const FINANCING_STATUS_TABS = [
  { label: 'All', value: '' },
  { label: 'Approved', value: 'approved' },
  { label: 'Denied', value: 'rejected' },
  { label: 'Pending', value: 'pending' },
] as const satisfies readonly Option[];

/** Activity tabs from the Flutter `ActivitiesView`. */
export const ACTIVITY_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Deliveries', value: 'deliveries' },
  { label: 'Repayments', value: 'repayments' },
  { label: 'Imports', value: 'imports' },
] as const satisfies readonly Option[];

// --------------------------------------------------------- field limits
/**
 * Lengths and patterns straight from the validators, so the client rejects
 * bad input before a round trip instead of surfacing a 422.
 */
export const LIMITS = {
  /** `Joi.string().pattern(/^\+?[0-9]{7,15}$/)` */
  phonePattern: /^\+?[0-9]{7,15}$/,
  /** `Joi.string().pattern(/^\d{11}$/)` */
  ninPattern: /^\d{11}$/,
  bvnPattern: /^\d{11}$/,
  /** `Joi.string().pattern(/^\d{10}$/)` */
  accountNumberPattern: /^\d{10}$/,
  cooperativeName: { min: 2, max: 150 },
  registrationNumber: { max: 60 },
  leaderName: { max: 120 },
  address: { max: 500 },
  farmerName: { min: 2, max: 150 },
  educationLevel: { max: 60 },
  soilType: { max: 60 },
  waterSource: { max: 60 },
  purpose: { max: 500 },
  notes: { max: 500 },
  fieldNoteBody: { max: 2000 },
  fieldNoteTitle: { max: 160 },
  tagLabel: { max: 60 },
  buyerName: { max: 150 },
  harvestWindow: { max: 120 },
  referenceNumber: { max: 100 },
  seedType: { max: 120 },
  fertilizerUsed: { max: 120 },
  postHarvestStorage: { max: 120 },
  bankName: { min: 2, max: 120 },
  accountName: { min: 2, max: 120 },
  search: { max: 120 },
  /** `pageSize: integer().min(1).max(100).default(20)` */
  pageSize: { min: 1, max: 100, default: 20 },
  /** `householdSize: integer().min(1).default(1)` */
  householdSize: { min: 1, default: 1 },
  /**
   * `dependents: integer().min(0).default(0)`.
   * NOTE — the Flutter form required `min(1)` here, so an agent could not
   * record a farmer with no dependents. The backend allows 0.
   */
  dependents: { min: 0, default: 0 },
  yearsExperience: { min: 0, default: 0 },
  /** `gpsLat: number().min(-90).max(90)` */
  latitude: { min: -90, max: 90 },
  /** `gpsLng: number().min(-180).max(180)` */
  longitude: { min: -180, max: 180 },
  /** `mapFarm.gpsPolygon`: `.min(3).required()` */
  minPolygonPoints: 3,
  seasonYear: { min: 2000, max: 2100 },
} as const;

/** Season-year picker: `List.generate(5, (i) => now.year - 2 + i)`. */
export function seasonYearOptions(now: Date = new Date()): Option[] {
  const start = now.getFullYear() - 2;
  return Array.from({ length: 5 }, (_, i) => {
    const year = String(start + i);
    return { label: year, value: year };
  });
}

/** Default `season` string for a production record: `wet_<year>`. */
export const defaultProductionSeason = (now: Date = new Date()): string =>
  `wet_${now.getFullYear()}`;
