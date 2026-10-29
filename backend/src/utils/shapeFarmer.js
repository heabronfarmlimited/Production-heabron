'use strict';

/**
 * shapeFarmer — convert a raw "farmers" row (possibly joined with
 * farm_profiles, cooperatives, credit_scores) into the response contract
 * the mobile client expects:
 *
 *   {
 *     ...original farmer fields,
 *     farm: {
 *       farmSizeAcres, cropType, secondaryCrops, soilType,
 *       irrigationAccess, waterSource, landOwnership, yearsExperience,
 *       gpsLat, gpsLng, landDocumentUrl, landDocumentType, farmPhotoUrls
 *     } | null,
 *     cooperative: { id, name, ... } | null,
 *     creditScore: { finalCreditScore, creditTier } | null,
 *
 *     // The original join arrays are preserved for backward-compatibility
 *     // with any consumer that was reading them directly.
 *     farm_profiles, cooperatives, credit_scores
 *   }
 *
 * The single-object `farm` field is the API contract; the array
 * `farm_profiles` from Supabase is kept for back-compat but should be
 * considered deprecated for client consumption.
 */

function pickFarmProfile(row) {
  // Supabase returns one-to-one joins as either an object or a 1-element array
  // depending on the relationship inference. Handle both.
  const fp = row?.farm_profiles;
  if (!fp) return null;
  if (Array.isArray(fp)) return fp[0] || null;
  return fp;
}

function pickCooperative(row) {
  const c = row?.cooperatives;
  if (!c) return null;
  if (Array.isArray(c)) return c[0] || null;
  return c;
}

function pickCreditScore(row) {
  const cs = row?.credit_scores;
  if (!cs) return null;
  if (Array.isArray(cs)) return cs[0] || null;
  return cs;
}

function shapeFarm(fp) {
  if (!fp) return null;
  return {
    farmSizeAcres: fp.farm_size_acres ?? null,
    cropType: fp.crop_type ?? null,
    secondaryCrops: fp.secondary_crops || [],
    soilType: fp.soil_type ?? null,
    irrigationAccess: fp.irrigation_access ?? false,
    waterSource: fp.water_source ?? null,
    landOwnership: fp.land_ownership ?? null,
    yearsExperience: fp.years_experience ?? 0,
    gpsLat: fp.gps_lat ?? null,
    gpsLng: fp.gps_lng ?? null,
    gpsPolygon: fp.gps_polygon ?? null,
    landDocumentUrl: fp.land_document_url ?? null,
    landDocumentType: fp.land_document_type ?? null,
    farmPhotoUrls: fp.farm_photo_urls || [],
  };
}

function shapeCreditScore(cs) {
  if (!cs) return null;
  return {
    finalCreditScore: cs.final_credit_score ?? null,
    creditTier: cs.credit_tier ?? null,
    productionScore: cs.production_score ?? null,
    repaymentScore: cs.repayment_score ?? null,
    isFirstCycle: cs.is_first_cycle ?? null,
    hasActiveDefault: cs.has_active_default ?? null,
    lastCalculatedAt: cs.last_calculated_at ?? null,
  };
}

/**
 * Apply the shape to a single farmer row. Returns a new object — does NOT
 * mutate the input. Safe to call with null/undefined (returns it unchanged).
 */
function shapeFarmer(row) {
  if (!row) return row;
  const farmProfile = pickFarmProfile(row);
  const cooperative = pickCooperative(row);
  const creditScore = pickCreditScore(row);

  return {
    ...row,
    farm: shapeFarm(farmProfile),
    cooperative,
    creditScore: shapeCreditScore(creditScore),
  };
}

/**
 * Convenience for arrays.
 */
function shapeFarmers(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(shapeFarmer);
}

/**
 * Mask the identity columns before a farmer row is handed to a LENDER.
 *
 * FIXED — `partner.controller.js` says, in a comment above the browse
 * endpoints: "Identity columns (NIN/BVN/phone) are returned the same masked
 * way the report screens already handle." Nothing was masked anywhere. All
 * three partner browse endpoints did `select('*')` on `farmers`, so every
 * lender with a login could page through the whole population and read, for
 * each farmer:
 *
 *   nin, bvn                   — national identity + bank verification numbers
 *   nin_verification_payload   — the stored provider response, which carries
 *                                the resident's photograph and home address
 *   id_image_url               — a signed URL to a photo of their ID document
 *   phone, alt_phone, address, date_of_birth
 *
 * A lender needs to know identity is *verified*, not what the identity is.
 * Keys are preserved (the dashboards read them) and only the values are
 * redacted, so the response shape does not change.
 */
const KEEP_LAST = 3;

function maskDigits(value) {
  const s = String(value ?? '');
  if (!s) return null;
  if (s.length <= KEEP_LAST) return '•'.repeat(s.length);
  return '•'.repeat(s.length - KEEP_LAST) + s.slice(-KEEP_LAST);
}

function maskFarmerIdentity(row) {
  if (!row) return row;
  const out = { ...row };
  if ('nin' in out) out.nin = out.nin ? maskDigits(out.nin) : null;
  if ('bvn' in out) out.bvn = out.bvn ? maskDigits(out.bvn) : null;
  if ('phone' in out) out.phone = out.phone ? maskDigits(out.phone) : null;
  if ('alt_phone' in out) out.alt_phone = out.alt_phone ? maskDigits(out.alt_phone) : null;
  // Not maskable in a useful way — withheld entirely.
  if ('nin_verification_payload' in out) out.nin_verification_payload = null;
  if ('id_image_url' in out) out.id_image_url = null;
  if ('address' in out) out.address = null;
  if ('date_of_birth' in out) out.date_of_birth = null;
  return out;
}

/** Shape + mask, for partner-facing farmer lists. */
function shapeFarmerForPartner(row) {
  return maskFarmerIdentity(shapeFarmer(row));
}

function shapeFarmersForPartner(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(shapeFarmerForPartner);
}

module.exports = {
  shapeFarmer,
  shapeFarmers,
  shapeFarm,
  maskFarmerIdentity,
  shapeFarmerForPartner,
  shapeFarmersForPartner,
};
