/**
 * Form schemas for the farmers module — replaces the
 * `form_builder_validators` compositions in the nine Dart controllers/views.
 *
 * Every message is the Dart `errorText` verbatim where one existed. Where the
 * Dart form had no validator and the controller toasted instead, the rule
 * moves into the schema so the error lands on the field; the toast string is
 * reused as the message so the wording is unchanged. Each such move is noted.
 */
import { z } from 'zod';

import { LIMITS, MAX_SECONDARY_CROPS } from '../../../core/api/domainConstants';

/** `FormBuilderValidators.required()` with no `errorText` → this default. */
const REQUIRED = 'This field is required';

const digits = (length: number, message: string) =>
  z.string().min(1, message).regex(new RegExp(`^\\d{${length}}$`), message);

// ------------------------------------------------------------------ farmer
/**
 * Add / Edit Farmer — one schema for both screens, since the field set is
 * identical (the Dart edit view merely dropped four validators, which is what
 * let it submit empty values over real ones).
 */
export const farmerFormSchema = z
  .object({
    // -- Personal Information ------------------------------------------
    fullName: z
      .string()
      .min(1, REQUIRED)
      .min(LIMITS.farmerName.min, 'Full name must be at least 2 characters')
      .max(LIMITS.farmerName.max, 'Full name must be at most 150 characters'),
    dateOfBirth: z.string().min(1, REQUIRED),
    /**
     * Dart had no field validator here; `submit` toasted 'Please select
     * gender'. Same message, now inline.
     */
    gender: z.string().min(1, 'Please select gender'),
    phone: z
      .string()
      .min(1, REQUIRED)
      .regex(/^\d+$/, 'Phone number must be numeric')
      .min(11, 'Value must have a length greater than or equal to 11'),
    /** Optional, but still 11 digits when supplied. */
    altPhone: z
      .string()
      .refine((v) => v.length === 0 || /^\d{11}$/.test(v), {
        message: 'Alt. phone must be 11 digits',
      }),
    nin: digits(11, 'NIN must be 11 digits'),
    /**
     * FIXED — `EditFarmerController.init` had its BVN prefill commented out
     * (`// bvnController.text = farmer. ?? '';`) while the field stayed
     * required, so every edit forced a re-type. The edit screen prefills it.
     */
    bvn: digits(11, 'BVN must be 11 digits'),
    educationLevel: z
      .string()
      .min(1, REQUIRED)
      .max(LIMITS.educationLevel.max, 'Education level must be at most 60 characters'),
    householdSize: z
      .string()
      .min(1, 'Please enter the household size')
      .regex(/^\d+$/, 'Value must be a valid number')
      .refine((v) => Number(v) >= LIMITS.householdSize.min, {
        message: 'Value must be greater than or equal to 1',
      }),
    /**
     * FIXED — Dart forced `min(1)`, so a farmer with no dependents could not
     * be recorded. `validators/domain.js` is `integer().min(0).default(0)`.
     */
    dependents: z
      .string()
      .min(1, 'Please enter the number of dependents')
      .regex(/^\d+$/, 'Value must be a valid number')
      .refine((v) => Number(v) >= LIMITS.dependents.min, {
        message: 'Value must be greater than or equal to 0',
      }),
    address: z
      .string()
      .min(1, REQUIRED)
      .max(LIMITS.address.max, 'Address must be at most 500 characters'),
    /** Dart toasted 'Please select state and lga'; split per control. */
    state: z.string().min(1, 'Please select state and lga'),
    lga: z.string().min(1, 'Please select state and lga'),

    // -- Farm Profile ---------------------------------------------------
    farmSizeAcres: z
      .string()
      .min(1, REQUIRED)
      .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, {
        message: 'Enter a valid farm size',
      }),
    cropType: z.string().min(1, 'Please select a primary crop'),
    secondaryCrops: z
      .array(z.string())
      .max(
        MAX_SECONDARY_CROPS,
        `You can select at most ${MAX_SECONDARY_CROPS} secondary crops`,
      ),
    soilType: z.string().min(1, REQUIRED),
    yearsExperience: z
      .string()
      .min(1, REQUIRED)
      .regex(/^\d+$/, 'Value must be a valid number'),
    waterSource: z.string().min(1, 'Please select a water source'),
    irrigationAccess: z.boolean(),
    landOwnership: z.string().min(1, 'Please select land ownership'),
    /**
     * Dart had no validators on lat/lng at all and sent `0.0` when blank,
     * which the validator happily stored as the Gulf of Guinea. Blank is
     * allowed (and omitted from the body); a value must be in range.
     */
    gpsLat: z
      .string()
      .refine(
        (v) =>
          v.trim().length === 0 ||
          (Number.isFinite(Number(v)) &&
            Number(v) >= LIMITS.latitude.min &&
            Number(v) <= LIMITS.latitude.max),
        { message: 'Latitude must be between -90 and 90' },
      ),
    gpsLng: z
      .string()
      .refine(
        (v) =>
          v.trim().length === 0 ||
          (Number.isFinite(Number(v)) &&
            Number(v) >= LIMITS.longitude.min &&
            Number(v) <= LIMITS.longitude.max),
        { message: 'Longitude must be between -180 and 180' },
      ),

    // -- Uploads --------------------------------------------------------
    /** Shown only once a land document is attached; required then. */
    landDocumentType: z.string(),
  })
  .superRefine((value, ctx) => {
    // Both coordinates or neither — a lone latitude is meaningless and the
    // server would store a half-located farm.
    const hasLat = value.gpsLat.trim().length > 0;
    const hasLng = value.gpsLng.trim().length > 0;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasLat ? 'gpsLng' : 'gpsLat'],
        message: 'Enter both latitude and longitude',
      });
    }
  });

export type FarmerForm = z.infer<typeof farmerFormSchema>;

/**
 * The `landDocumentType` rule depends on whether a document is attached,
 * which lives outside the form state — so it is checked at submit time by the
 * screen using this helper rather than inside the schema.
 */
export const LAND_DOCUMENT_TYPE_REQUIRED = REQUIRED;

/** Blank defaults for Add Farmer. */
export const emptyFarmerForm: FarmerForm = {
  fullName: '',
  dateOfBirth: '',
  gender: '',
  phone: '',
  altPhone: '',
  nin: '',
  bvn: '',
  educationLevel: '',
  householdSize: '',
  dependents: '',
  address: '',
  state: '',
  lga: '',
  farmSizeAcres: '',
  cropType: '',
  secondaryCrops: [],
  soilType: '',
  yearsExperience: '',
  waterSource: '',
  irrigationAccess: false,
  landOwnership: '',
  gpsLat: '',
  gpsLng: '',
  landDocumentType: '',
};

// ------------------------------------------------------------ record yield
export const productionFormSchema = z.object({
  season: z.string().min(1, 'Season is required'),
  /** Dart had no validator; `submit` toasted the same wording. */
  crop: z.string().min(1, 'Please enter or select a crop'),
  /** Shown only when `crop === 'others'`. */
  customCrop: z.string(),
  cycleNumber: z
    .string()
    .min(1, 'Cycle number is required')
    .regex(/^\d+$/, 'Cycle number is required')
    .refine((v) => Number(v) >= 1, { message: 'Cycle number must be at least 1' }),
  expectedPlantingDate: z.string(),
  expectedHarvestDate: z.string(),
  expectedYieldTonnes: decimalOptional('Enter a valid expected yield'),
  actualYieldTonnes: decimalOptional('Enter a valid actual yield'),
  benchmarkYieldTonnes: decimalOptional('Enter a valid benchmark yield'),
  seedType: z
    .string()
    .max(LIMITS.seedType.max, 'Seed type must be at most 120 characters'),
  fertilizerUsed: z
    .string()
    .max(LIMITS.fertilizerUsed.max, 'Fertilizer must be at most 120 characters'),
  herbicideUsed: z.boolean(),
  postHarvestStorage: z
    .string()
    .max(
      LIMITS.postHarvestStorage.max,
      'Post-harvest storage must be at most 120 characters',
    ),
  estimatedFarmIncome: decimalOptional('Enter a valid amount'),
  harvestDate: z.string(),
  verificationNotes: z
    .string()
    .max(LIMITS.notes.max, 'Notes must be at most 500 characters'),
  notes: z.string().max(LIMITS.notes.max, 'Notes must be at most 500 characters'),
}).superRefine((value, ctx) => {
  if (value.crop === 'others' && value.customCrop.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customCrop'],
      message: 'Crop name is required',
    });
  }
});

export type ProductionForm = z.infer<typeof productionFormSchema>;

/** `allow(RegExp(r'^\d*\.?\d*'))` in Dart — optional, non-negative decimal. */
function decimalOptional(message: string) {
  return z
    .string()
    .refine(
      (v) => v.trim().length === 0 || (Number.isFinite(Number(v)) && Number(v) >= 0),
      { message },
    );
}

export const emptyProductionForm = (season: string, crop: string): ProductionForm => ({
  season,
  crop,
  customCrop: '',
  cycleNumber: '1',
  expectedPlantingDate: '',
  expectedHarvestDate: '',
  expectedYieldTonnes: '',
  actualYieldTonnes: '',
  benchmarkYieldTonnes: '',
  seedType: '',
  fertilizerUsed: '',
  herbicideUsed: false,
  postHarvestStorage: '',
  estimatedFarmIncome: '',
  harvestDate: '',
  verificationNotes: '',
  notes: '',
});

// ------------------------------------------------------- record repayment
export const repaymentFormSchema = z.object({
  financingRequestId: z.string().min(1, 'Please select a financing request'),
  amountPaid: z
    .string()
    .min(1, 'Amount is required')
    .regex(/^\d+$/, 'Amount is required')
    // Dart's submit guard: `amount <= 0` toasted this exact message.
    .refine((v) => Number(v) > 0, { message: 'Please enter a valid repayment amount' }),
  referenceNumber: z
    .string()
    .min(1, 'Reference number is required')
    .max(LIMITS.referenceNumber.max, 'Reference must be at most 100 characters'),
  paymentMethod: z.string().min(1, 'Please select a payment method'),
  contextFlag: z.string().min(1, 'Please select a context flag'),
  contextNotes: z
    .string()
    .min(1, 'This field is required')
    .max(LIMITS.notes.max, 'Notes must be at most 500 characters'),
  paymentDate: z.string().min(1, 'This field is required'),
  /**
   * FIXED — the Dart label said `(Optional)` but `submit` returned early with
   * 'Please upload a proof photo'. The field is labelled required on screen
   * and enforced here with the same message.
   */
  proofPhotoUrl: z.string().min(1, 'Please upload a proof photo'),
});

export type RepaymentForm = z.infer<typeof repaymentFormSchema>;

// --------------------------------------------------------- market access
export const marketAccessFormSchema = z.object({
  seasonYear: z.string(),
  buyerName: z
    .string()
    .min(1, 'Required')
    .max(LIMITS.buyerName.max, 'Buyer name must be at most 150 characters'),
  pricePerTon: z
    .string()
    .refine(
      (v) => v.trim().length === 0 || (/^\d+$/.test(v) && Number(v) >= 0),
      { message: 'Enter a valid price' },
    ),
  priceContext: z.string(),
  isConfirmed: z.boolean(),
  harvestWindow: z
    .string()
    .max(LIMITS.harvestWindow.max, 'Harvest window must be at most 120 characters'),
  notes: z.string().max(LIMITS.notes.max, 'Notes must be at most 500 characters'),
});

export type MarketAccessForm = z.infer<typeof marketAccessFormSchema>;

export const emptyMarketAccessForm: MarketAccessForm = {
  seasonYear: '',
  buyerName: '',
  pricePerTon: '',
  priceContext: '',
  isConfirmed: false,
  harvestWindow: '',
  notes: '',
};

// ------------------------------------------------------------- field note
export const fieldNoteFormSchema = z.object({
  /** Dart toasted 'Please select a note type'; same message, inline. */
  noteType: z.string().min(1, 'Please select a note type'),
  title: z
    .string()
    .max(LIMITS.fieldNoteTitle.max, 'Title must be at most 160 characters'),
  body: z
    .string()
    .min(1, 'Required')
    .max(LIMITS.fieldNoteBody.max, 'Body must be at most 2000 characters'),
  tagLabel: z
    .string()
    .max(LIMITS.tagLabel.max, 'Tag label must be at most 60 characters'),
  tagVariant: z.string(),
  eventDate: z.string(),
});

export type FieldNoteForm = z.infer<typeof fieldNoteFormSchema>;

// ------------------------------------------------------------ list filters
/**
 * FIXED — the Dart filter sheet used free-text fields for LGA, Tier and
 * Cooperative ID. `listQuery` validates `tier` against `A`–D` and
 * `cooperativeId` as a UUID, so anything else returned a 422 "Validation
 * failed" that the sheet surfaced as a generic toast. Tier is now a picker and
 * the cooperative filter is validated as a UUID before it is applied.
 */
export const farmerFilterSchema = z.object({
  lga: z.string(),
  tier: z.string(),
  cooperativeId: z
    .string()
    .refine(
      (v) =>
        v.trim().length === 0 ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim()),
      { message: 'Enter a valid cooperative ID' },
    ),
});

export type FarmerFilterForm = z.infer<typeof farmerFilterSchema>;

export const emptyFarmerFilterForm: FarmerFilterForm = {
  lga: '',
  tier: '',
  cooperativeId: '',
};
