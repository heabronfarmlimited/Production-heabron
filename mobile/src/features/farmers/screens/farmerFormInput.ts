/**
 * Turns the farmer form's string fields into the typed `FarmerFormInput` the
 * API layer takes. Shared by Add and Edit so the two screens cannot drift —
 * which is precisely how the Dart edit screen ended up sending `''` and `0`
 * for fields it had never prefilled.
 */
import type { FarmerFormInput } from '../model/farmer';
import { intOrUndefined, numOrUndefined, orUndefined } from '../model/primitives';
import type { FarmerForm } from '../model/validation';

export interface BuildFarmerInput {
  form: FarmerForm;
  cooperativeId: string;
  farmerPhotoUrl?: string | null;
  idImageUrl?: string | null;
  landDocumentUrl?: string | null;
  farmPhotoUrls?: string[];
}

export function buildFarmerFormInput({
  form,
  cooperativeId,
  farmerPhotoUrl,
  idImageUrl,
  landDocumentUrl,
  farmPhotoUrls = [],
}: BuildFarmerInput): FarmerFormInput {
  return {
    cooperativeId,
    fullName: form.fullName,
    dateOfBirth: form.dateOfBirth,
    gender: form.gender,
    phone: form.phone,
    altPhone: orUndefined(form.altPhone),
    address: form.address,
    state: form.state,
    lga: form.lga,
    // The schema guarantees these parse; `?? ` keeps the types honest.
    householdSize: intOrUndefined(form.householdSize) ?? 1,
    dependents: intOrUndefined(form.dependents) ?? 0,
    educationLevel: form.educationLevel,
    nin: form.nin,
    bvn: form.bvn,
    idImageUrl,
    farmerPhotoUrl,
    farm: {
      farmSizeAcres: numOrUndefined(form.farmSizeAcres),
      cropType: orUndefined(form.cropType),
      // `[]` is meaningful: it clears the list. Only `undefined` is omitted.
      secondaryCrops: form.secondaryCrops,
      soilType: orUndefined(form.soilType),
      irrigationAccess: form.irrigationAccess,
      waterSource: orUndefined(form.waterSource),
      landOwnership: orUndefined(form.landOwnership),
      yearsExperience: intOrUndefined(form.yearsExperience),
      // Blank coordinates are omitted, not sent as 0.0.
      gpsLat: numOrUndefined(form.gpsLat),
      gpsLng: numOrUndefined(form.gpsLng),
      landDocumentUrl: orUndefined(landDocumentUrl),
      landDocumentType: orUndefined(form.landDocumentType),
      farmPhotoUrls: farmPhotoUrls.length > 0 ? farmPhotoUrls : undefined,
    },
  };
}

/**
 * The form paths a 422 can name, for `applyServerFieldErrors`. The backend
 * reports nested failures as `farm.soilType` etc., which have no form path, so
 * only the flat fields are mapped; anything else falls through to a toast.
 */
export const FARMER_SERVER_FIELDS = [
  'fullName',
  'dateOfBirth',
  'gender',
  'phone',
  'altPhone',
  'address',
  'state',
  'lga',
  'householdSize',
  'dependents',
  'educationLevel',
  'nin',
  'bvn',
] as const;
