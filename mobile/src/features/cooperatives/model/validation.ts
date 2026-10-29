/**
 * Form schemas for the cooperatives module — replaces the
 * `form_builder_validators` chains plus the submit-time `ToastService` guards
 * in CreateCooperativeController, EditCooperativeController and
 * FinancingRequestController.
 *
 * Error messages are the Dart `errorText` strings verbatim. Where the Dart
 * code validated at submit time with a toast instead of on the field, the
 * toast's wording is reused so the copy is unchanged but the message lands on
 * the offending input.
 *
 * Numeric and GPS fields are held as strings because they are backed by text
 * inputs; `toCooperativeBody` / `toFinancingRequestBody` do the conversion.
 */
import { z } from 'zod';

import type {
  FINANCING_SEASONS} from '../../../core/api/domainConstants';
import {
  LIMITS,
  REPAYMENT_WINDOW,
} from '../../../core/api/domainConstants';
import { isValidCoordinate } from '../../../core/hooks/useLocation';

// ------------------------------------------------------------------ helpers
/**
 * A signed decimal, with full precision.
 *
 * FIXED — the Dart forms filtered input through
 * `FilteringTextInputFormatter.allow(RegExp(r'^\d+\.?\d{0,2}'))`, which has
 * two consequences that made the GPS fields unusable in practice:
 *   1. no leading `-`, so no southern latitude and no western longitude could
 *      ever be typed (most of Nigeria is fine, but the field crashes for any
 *      coordinate outside the first quadrant), and
 *   2. at most two decimal places, roughly a 1 km error at the equator —
 *      useless for a farm boundary. "Get My Location" wrote full precision
 *      straight to the controller, bypassing the formatter, so a fetched
 *      coordinate and a typed one disagreed by up to a kilometre.
 */
const SIGNED_DECIMAL = /^-?(\d+\.?\d*|\.\d+)$/;

/** Unsigned decimal — land size cannot be negative (`Joi.number().min(0)`). */
const UNSIGNED_DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

const toNumber = (value: string): number => Number(value.trim());

// ------------------------------------------------------------- cooperative
/**
 * Shared by `CreateCooperativeScreen` and `EditCooperativeScreen` — the Dart
 * screens had identical fields and validators, differing only in their
 * heading and button copy.
 */
export const cooperativeFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Cooperative name is required')
      // `Joi.string().min(2).max(150).required()`
      .min(LIMITS.cooperativeName.min, 'Cooperative name must be at least 2 characters')
      .max(LIMITS.cooperativeName.max, 'Cooperative name must be at most 150 characters'),

    registrationNumber: z
      .string()
      .trim()
      .min(1, 'Registration number is required')
      .max(
        LIMITS.registrationNumber.max,
        'Registration number must be at most 60 characters',
      ),

    /**
     * The Dart form rendered dead `Text('Select State')` / `Text('Select LGA')`
     * labels above the dropdown and validated both at submit time with
     * `ToastService.showError('Please select a state')` then `'Please select an
     * LGA'`. Same copy, now attached to the control.
     */
    state: z.string().min(1, 'Please select a state'),
    lga: z.string().min(1, 'Please select an LGA'),

    address: z
      .string()
      .trim()
      .min(1, 'Address is required')
      .max(LIMITS.address.max, 'Address must be at most 500 characters'),

    /** `cropsSupported: Joi.array().items(Joi.string()).default([])` — optional. */
    cropsSupported: z.array(z.string()),

    estimatedLandSize: z
      .string()
      .trim()
      .min(1, 'Estimated land size is required')
      .regex(UNSIGNED_DECIMAL, 'Enter a valid land size in acres')
      .refine((v) => Number.isFinite(toNumber(v)), 'Enter a valid land size in acres')
      .refine((v) => toNumber(v) >= 0, 'Land size cannot be negative'),

    gpsLat: z
      .string()
      .trim()
      .min(1, 'Latitude is required')
      .regex(SIGNED_DECIMAL, 'Enter a valid latitude')
      .refine(
        (v) =>
          toNumber(v) >= LIMITS.latitude.min && toNumber(v) <= LIMITS.latitude.max,
        'Latitude must be between -90 and 90',
      ),

    gpsLng: z
      .string()
      .trim()
      .min(1, 'Longitude is required')
      .regex(SIGNED_DECIMAL, 'Enter a valid longitude')
      .refine(
        (v) =>
          toNumber(v) >= LIMITS.longitude.min && toNumber(v) <= LIMITS.longitude.max,
        'Longitude must be between -180 and 180',
      ),

    /** Uploaded by `useImageField('avatar')` before submit; may be empty. */
    logoUrl: z.string(),

    /**
     * Carried through an edit so a boundary mapped elsewhere survives. No UI
     * in this module writes it — see `toCooperativeBody`.
     */
    gpsPolygon: z.array(z.object({ lat: z.number(), lng: z.number() })),
  })
  /** The pair is checked once more against the validator's own bounds. */
  .superRefine((form, ctx) => {
    const lat = toNumber(form.gpsLat);
    const lng = toNumber(form.gpsLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    if (!isValidCoordinate(lat, lng)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gpsLat'],
        message: 'Enter a valid GPS coordinate',
      });
    }
  });

export type CooperativeForm = z.infer<typeof cooperativeFormSchema>;

// --------------------------------------------------------------- financing
type SeasonValue = (typeof FINANCING_SEASONS)[number]['value'];

/** `season: Joi.string().valid('wet','dry','all_year').required()`. */
const SEASON_VALUES = ['wet', 'dry', 'all_year'] as const satisfies readonly SeasonValue[];

export const financingRequestSchema = z.object({
  /**
   * The Dart dropdown keyed on `"${fullName}-${nin}"` and resolved the
   * selection with `firstWhere((f) => f.fullName == val.split('-').first)` —
   * no `orElse`, so a name containing a hyphen threw, and two farmers with the
   * same name resolved to whichever came first. The id is the form value now.
   */
  farmerId: z.string().min(1, 'Please select a farmer'),

  loanAmount: z
    .string()
    .trim()
    .min(1, 'Please enter a valid loan amount')
    .regex(UNSIGNED_DECIMAL, 'Please enter a valid loan amount')
    // `loanAmount: Joi.number().positive().required()`
    .refine((v) => toNumber(v) > 0, 'Please enter a valid loan amount'),

  season: z.enum(SEASON_VALUES),

  /**
   * FIXED — `repaymentWindowDays` is
   * `Joi.number().integer().min(30).max(540).default(180)`. The Dart field was
   * a bare `required()` with no bounds, so "1" or "9999" passed the form and
   * came back a 422.
   */
  repaymentWindowDays: z
    .string()
    .trim()
    .min(1, 'Repayment window is required')
    .regex(/^\d+$/, 'Enter the repayment window in whole days')
    .refine(
      (v) =>
        toNumber(v) >= REPAYMENT_WINDOW.min && toNumber(v) <= REPAYMENT_WINDOW.max,
      `Repayment window must be between ${REPAYMENT_WINDOW.min} and ${REPAYMENT_WINDOW.max} days`,
    ),

  purpose: z
    .string()
    .trim()
    .min(1, 'Please enter the loan purpose')
    .max(LIMITS.purpose.max, 'Loan purpose must be at most 500 characters'),
});

export type FinancingRequestForm = z.infer<typeof financingRequestSchema>;

/** Defaults matching the Dart controller's initial controller values. */
export const emptyFinancingRequestForm = (): FinancingRequestForm => ({
  farmerId: '',
  loanAmount: '',
  season: 'wet',
  repaymentWindowDays: String(REPAYMENT_WINDOW.default),
  purpose: '',
});
