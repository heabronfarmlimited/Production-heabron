/**
 * Onboard Farmer — ported from
 * modules/farmers/presentation/view/add_farmer_view.dart (720 LOC)
 *
 * Heading 'Onboard Farmer', subtitle 'Fill in the details below to onboard a
 * new farmer to the cooperative.', the three shared sections, then the
 * 'Onboard Farmer' button.
 *
 * Fixes:
 *  - The cooperative id came from route arguments via a force-cast, so any
 *    entry path other than a cooperative's details page threw. A picker is
 *    shown when no id is supplied.
 *  - `dependents` was `min(1)`; the backend allows 0.
 *  - Gender / state / LGA failures were toasts after submit; they are inline.
 *  - The offline path queued the farmer *and* persisted local file URIs, which
 *    is kept — but the queue now drains automatically on reconnect.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppDropdown } from '../../../components/AppDropdown';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { h } from '../../../core/theme/responsive';
import { applyServerFieldErrors } from '../../../core/utils/serverFieldErrors';
import { showError, showSuccess } from '../../../core/utils/toast';
import {
  FarmProfileSection,
  FormHeader,
  PersonalInformationSection,
  UploadsSection,
} from '../components/FarmerFormSections';
import { useCooperativeOptions } from '../hooks/useCooperativeOptions';
import { useFarmerFormUploads } from '../hooks/useFarmerFormUploads';
import { useCreateFarmer } from '../hooks/useFarmerMutations';
import { isOnline, useOfflineFarmerQueue } from '../hooks/useOfflineFarmerQueue';
import { toFarmerBody } from '../model/farmer';
import { buildPendingFarmer, pendingFarmerStore } from '../model/pendingFarmer';
import {
  emptyFarmerForm,
  farmerFormSchema,
  LAND_DOCUMENT_TYPE_REQUIRED,
  type FarmerForm,
} from '../model/validation';

import { buildFarmerFormInput, FARMER_SERVER_FIELDS } from './farmerFormInput';
import { useRouteParams } from './routeParams';

export interface AddFarmerScreenProps {
  /** Supplied when the screen is opened from a cooperative. */
  cooperativeId?: string;
}

export function AddFarmerScreen(props: AddFarmerScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  // Dart force-cast this from route arguments; it is an optional query param.
  const cooperativeId = props.cooperativeId ?? params.cooperativeId;

  const [selectedCooperativeId, setSelectedCooperativeId] = useState(
    cooperativeId ?? '',
  );

  const { options: cooperativeOptions, isLoading: loadingCooperatives } =
    useCooperativeOptions(!cooperativeId);

  const uploads = useFarmerFormUploads();
  const { createAsync, isPending } = useCreateFarmer();
  const queue = useOfflineFarmerQueue();

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FarmerForm>({
    resolver: zodResolver(farmerFormSchema),
    // Dart: AutovalidateMode.onUserInteraction
    mode: 'onTouched',
    defaultValues: emptyFarmerForm,
  });

  const values = watch();

  const onSubmit = async (form: FarmerForm) => {
    if (!selectedCooperativeId) {
      showError('Please select a cooperative');
      return;
    }

    if (uploads.uploading) {
      showError('Please wait for the uploads to finish.');
      return;
    }

    // The Dart condition was `landDocument != null`, checked by the form.
    if (uploads.landDocument.hasValue && form.landDocumentType.trim().length === 0) {
      setError('landDocumentType', {
        type: 'manual',
        message: LAND_DOCUMENT_TYPE_REQUIRED,
      });
      return;
    }

    const input = buildFarmerFormInput({
      form,
      cooperativeId: selectedCooperativeId,
      farmerPhotoUrl: uploads.farmerPhoto.url,
      idImageUrl: uploads.idCard.url,
      landDocumentUrl: uploads.landDocument.url,
      farmPhotoUrls: uploads.farmPhotos.urls,
    });

    // -------------------------------------------------- offline path
    if (!(await isOnline())) {
      pendingFarmerStore.add(
        buildPendingFarmer({
          body: toFarmerBody(input),
          farmerPhotoUri: uploads.farmerPhoto.previewUri,
          idCardUri: uploads.idCard.previewUri,
          landDocumentUri: uploads.landDocument.previewUri,
          farmPhotoUris: uploads.farmPhotos.pending.map((p) => p.uri),
        }),
      );
      queue.reload();
      showSuccess(
        'You are offline. Farmer has been saved locally and will be uploaded when you have a connection.',
      );
      router.back();
      return;
    }

    try {
      await createAsync(input);
      router.back();
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, FARMER_SERVER_FIELDS)) {
        showError(
          err instanceof Error ? err.message : 'Could not onboard this farmer.',
        );
      }
    }
  };

  return (
    <AppSkeleton isBusy={isPending} scrollable>
      <View style={{ height: h(20) }} />

      <FormHeader
        title="Onboard Farmer"
        subtitle="Fill in the details below to onboard a new farmer to the cooperative."
      />

      <View style={{ height: h(30) }} />

      {/* Shown only when the screen was not opened from a cooperative. */}
      {cooperativeId ? null : (
        <>
          <AppDropdown
            title="Cooperative"
            label={loadingCooperatives ? 'Loading cooperatives…' : 'Select Cooperative'}
            options={cooperativeOptions}
            value={selectedCooperativeId.length > 0 ? selectedCooperativeId : null}
            onChange={setSelectedCooperativeId}
            searchable
            testID="farmer-cooperative"
          />
          <View style={{ height: h(30) }} />
        </>
      )}

      <PersonalInformationSection
        control={control}
        errors={errors}
        setValue={setValue}
        values={values}
      />

      <View style={{ height: h(30) }} />

      <FarmProfileSection
        control={control}
        errors={errors}
        setValue={setValue}
        values={values}
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
        text="Onboard Farmer"
        loading={isPending}
        disabled={uploads.uploading}
        onPress={handleSubmit(onSubmit)}
        testID="farmer-submit"
      />

      <View style={{ height: h(30) }} />
    </AppSkeleton>
  );
}
