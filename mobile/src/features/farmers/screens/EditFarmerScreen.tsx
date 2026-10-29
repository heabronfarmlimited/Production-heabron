/**
 * Edit Farmer Profile — ported from
 * modules/farmers/presentation/view/edit_farmer_view.dart (798 LOC)
 *
 * Same 27 fields as Add Farmer, so the three shared sections are reused with
 * `compact` set (NIN/BVN, Soil Type/Years Experience and Water
 * Source/Irrigation side by side, as Dart laid them out). Heading 'Edit Farmer
 * Profile', subtitle 'Update the details below to modify the farmer profile.',
 * button 'Save Changes'.
 *
 * **This is the data-loss fix.** `EditFarmerController.init` prefilled only
 * ten of the 27 fields:
 *   - BVN's prefill was an unfinished commented-out line
 *     (`// bvnController.text = farmer. ?? '';`) on a *required* field, so
 *     every edit forced the agent to re-type it;
 *   - `selectedSoilType`, `secondaryCrops`, `yearsExperience`, `gpsLat`,
 *     `gpsLng` and `landDocumentType` were never prefilled at all, and
 *     `submit` sent `''` / `0` / `0.0` for each — overwriting the stored
 *     values on every save;
 *   - `farmSizeController` read `farmProfiles.first` only, so it was blank
 *     whenever the API returned the camelCase `farm` object instead;
 *   - gender was prefilled as a *title-cased label* (`'Male'`) and then
 *     lowercased on submit, which worked only for the three English labels.
 *
 * Every field is prefilled here from `resolveFarm()`, and `compact()` in the
 * model layer omits anything genuinely absent rather than sending a zero.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { h } from '../../../core/theme/responsive';
import { applyServerFieldErrors } from '../../../core/utils/serverFieldErrors';
import { showError } from '../../../core/utils/toast';
import { EmptyState } from '../components/EmptyState';
import {
  FarmProfileSection,
  FormHeader,
  PersonalInformationSection,
  UploadsSection,
} from '../components/FarmerFormSections';
import { useFarmerFormUploads } from '../hooks/useFarmerFormUploads';
import { useUpdateFarmer } from '../hooks/useFarmerMutations';
import { useFarmer } from '../hooks/useFarmers';
import { resolveFarm, type Farmer } from '../model/farmer';
import {
  emptyFarmerForm,
  farmerFormSchema,
  LAND_DOCUMENT_TYPE_REQUIRED,
  type FarmerForm,
} from '../model/validation';

import { buildFarmerFormInput, FARMER_SERVER_FIELDS } from './farmerFormInput';
import { useRouteParams } from './routeParams';

export interface EditFarmerScreenProps {
  /** Optional override; normally the `/farmers/[id]/edit` route param. */
  farmerId?: string;
}

export function EditFarmerScreen(props: EditFarmerScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.id ?? '';

  const { farmer, isLoading } = useFarmer(farmerId);
  const { updateAsync, isPending } = useUpdateFarmer(farmerId);

  const farm = resolveFarm(farmer);

  const uploads = useFarmerFormUploads({
    farmerPhotoUrl: farmer?.farmerPhotoUrl,
    idImageUrl: farmer?.idImageUrl,
    landDocumentUrl: farm?.landDocumentUrl,
    farmPhotoUrls: farm?.farmPhotoUrls,
  });

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<FarmerForm>({
    resolver: zodResolver(farmerFormSchema),
    mode: 'onTouched',
    defaultValues: emptyFarmerForm,
  });

  // Prefill once, when the farmer first arrives. Re-seeding on every render of
  // a background refetch would discard the agent's in-progress edits.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!farmer || prefilled.current) return;
    prefilled.current = true;
    reset(toFarmerForm(farmer));
  }, [farmer, reset]);

  const values = watch();

  if (isLoading && !farmer) {
    return (
      <AppSkeleton appBarTitle="Edit Farmer Profile" isBusy>
        <View />
      </AppSkeleton>
    );
  }

  if (!farmer) {
    return (
      <AppSkeleton appBarTitle="Edit Farmer Profile" scrollable>
        <EmptyState text="No farmer data to edit" />
      </AppSkeleton>
    );
  }

  const onSubmit = async (form: FarmerForm) => {
    if (uploads.uploading) {
      showError('Please wait for the uploads to finish.');
      return;
    }

    // Dart's edit condition: `landDocument != null || landDocumentUrl != null`.
    if (uploads.landDocument.hasValue && form.landDocumentType.trim().length === 0) {
      setError('landDocumentType', {
        type: 'manual',
        message: LAND_DOCUMENT_TYPE_REQUIRED,
      });
      return;
    }

    const input = buildFarmerFormInput({
      form,
      // `cooperativeId` is not editable here, as in Dart.
      cooperativeId: farmer.cooperativeId ?? '',
      farmerPhotoUrl: uploads.farmerPhoto.url,
      idImageUrl: uploads.idCard.url,
      landDocumentUrl: uploads.landDocument.url,
      farmPhotoUrls: uploads.farmPhotos.urls,
    });

    try {
      await updateAsync(input);
      router.back();
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, FARMER_SERVER_FIELDS)) {
        showError(
          err instanceof Error ? err.message : 'Could not update this farmer.',
        );
      }
    }
  };

  return (
    <AppSkeleton isBusy={isPending} scrollable>
      <View style={{ height: h(20) }} />

      <FormHeader
        title="Edit Farmer Profile"
        subtitle="Update the details below to modify the farmer profile."
      />

      <View style={{ height: h(30) }} />

      <PersonalInformationSection
        control={control}
        errors={errors}
        setValue={setValue}
        values={values}
        compact
      />

      <View style={{ height: h(30) }} />

      <FarmProfileSection
        control={control}
        errors={errors}
        setValue={setValue}
        values={values}
        compact
      />

      <View style={{ height: h(30) }} />

      <UploadsSection
        control={control}
        errors={errors}
        farmerPhoto={uploads.farmerPhoto}
        idCard={uploads.idCard}
        landDocument={uploads.landDocument}
        farmPhotos={uploads.farmPhotos}
        landDocumentType={values.landDocumentType}
      />

      <View style={{ height: h(40) }} />

      <AppButton
        text="Save Changes"
        loading={isPending}
        disabled={uploads.uploading}
        onPress={handleSubmit(onSubmit)}
        testID="farmer-save"
      />

      <View style={{ height: h(30) }} />
    </AppSkeleton>
  );
}

/**
 * Prefills **every** form field from the farmer.
 *
 * `gender`, `soilType`, `waterSource`, `landOwnership` and the crops are
 * stored as API values, and the dropdowns take API values, so they map
 * straight across — no label round trip.
 */
function toFarmerForm(farmer: Farmer): FarmerForm {
  const farm = resolveFarm(farmer);

  return {
    fullName: farmer.fullName ?? '',
    // `date_of_birth` can be a full timestamp; DateField wants `yyyy-MM-dd`.
    dateOfBirth: (farmer.dateOfBirth ?? '').slice(0, 10),
    gender: (farmer.gender ?? '').toLowerCase(),
    phone: farmer.phone ?? '',
    altPhone: farmer.altPhone ?? '',
    nin: farmer.nin ?? '',
    // FIXED — this prefill was commented out in Dart.
    bvn: farmer.bvn ?? '',
    educationLevel: farmer.educationLevel ?? '',
    householdSize: farmer.householdSize?.toString() ?? '',
    dependents: farmer.dependents?.toString() ?? '',
    address: farmer.address ?? '',
    // FIXED — Dart left State/LGA blank with a comment admitting it.
    state: farmer.state ?? '',
    lga: farmer.lga ?? '',

    farmSizeAcres: farm?.farmSizeAcres?.toString() ?? '',
    cropType: (farm?.cropType ?? '').toLowerCase(),
    // FIXED — never prefilled in Dart, then overwritten with [].
    secondaryCrops: (farm?.secondaryCrops ?? []).map((crop) => crop.toLowerCase()),
    // FIXED — never prefilled, then overwritten with ''.
    soilType: (farm?.soilType ?? '').toLowerCase(),
    // FIXED — never prefilled, then overwritten with 0.
    yearsExperience: farm?.yearsExperience?.toString() ?? '',
    waterSource: (farm?.waterSource ?? '').toLowerCase(),
    irrigationAccess: farm?.irrigationAccess ?? false,
    landOwnership: (farm?.landOwnership ?? '').toLowerCase(),
    // FIXED — never prefilled, then overwritten with 0.0.
    gpsLat: farm?.gpsLat != null ? String(farm.gpsLat) : '',
    gpsLng: farm?.gpsLng != null ? String(farm.gpsLng) : '',
    // FIXED — never prefilled, then overwritten with ''.
    landDocumentType: farm?.landDocumentType ?? '',
  };
}
