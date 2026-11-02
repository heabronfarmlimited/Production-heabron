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
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppDropdown } from '../../../components/AppDropdown';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { AppError } from '../../../core/api/AppError';
import { routes } from '../../../core/navigation/routes';
import { h } from '../../../core/theme/responsive';
import { newClientRequestId } from '../../../core/utils/clientRequestId';
import { applyServerFieldErrors } from '../../../core/utils/serverFieldErrors';
import { showError, showSuccess } from '../../../core/utils/toast';
import { useCooperative } from '../../cooperatives/hooks/useCooperatives';
import {
  FarmProfileSection,
  FormHeader,
  PersonalInformationSection,
  UploadsSection,
} from '../components/FarmerFormSections';
import { InheritedFieldsCard } from '../components/InheritedFieldsCard';
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

  /**
   * CONSENT GATE (data consent specification, section 4): a farmer profile
   * cannot be submitted until Flow B is complete, and the cooperative must
   * already have Flow A. The server refuses the create without a consent id;
   * this is how the agent obtains one.
   *
   * Set by the consent route when it returns.
   */
  const consentId = params.consentId;

  const { options: cooperativeOptions, isLoading: loadingCooperatives } =
    useCooperativeOptions(!cooperativeId);

  /**
   * One idempotency key per form session (v2 "duplicate-safe client UUID").
   *
   * Held in a ref so it survives the consent round trip and every re-render:
   * the whole point is that a retry carries the SAME key, so a double tap, or
   * the offline queue re-sending a request whose response was lost, returns
   * the farmer that already exists instead of creating a second record with
   * the same name and NIN.
   */
  const clientRequestId = useRef(newClientRequestId());

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

  /**
   * A submission that failed for a reason the agent cannot fix, holding the
   * body so it can be queued rather than retyped.
   */
  const [failedSubmission, setFailedSubmission] = useState<{
    input: ReturnType<typeof buildFarmerFormInput>;
    message: string;
  } | null>(null);

  const queueFailedSubmission = () => {
    const held = failedSubmission;
    if (!held) return;
    setFailedSubmission(null);
    pendingFarmerStore.add(
      buildPendingFarmer({
        // The already-uploaded URLs are inside the body, so the sync step
        // re-sends it without re-uploading anything.
        body: toFarmerBody(held.input),
      }),
    );
    queue.reload();
    showSuccess(
      'Saved on this device. It will be sent again automatically, and you can retry it yourself from Sync Queue.',
    );
    router.back();
  };

  /**
   * Fields inherited from the cooperative (v2 user flow).
   *
   * Registration number, address, state, LGA and primary crop belong to the
   * cooperative. Before this they were retyped per member, which is how
   * members of one cooperative ended up recorded in three different LGAs —
   * and the LGA feeds the yield benchmark lookup and the report id, so a
   * typo there changes both the score and the document.
   *
   * State and LGA are copied into the form and locked; the farmer's own home
   * address stays theirs to fill in. The cooperative's primary crop is only a
   * DEFAULT for the first farm's crop, not a lock: a member may grow
   * something else, and several farms with different crops is explicitly
   * supported.
   */
  const { data: inherited, isLoading: loadingInherited } = useCooperative(
    selectedCooperativeId,
  );

  useEffect(() => {
    if (!inherited) return;
    if (inherited.state) setValue('state', inherited.state, { shouldValidate: true });
    if (inherited.lga) setValue('lga', inherited.lga, { shouldValidate: true });
  }, [inherited, setValue]);

  // A default, applied once and only while the field is still empty, so it
  // never overwrites a crop the agent has chosen.
  const cropDefaulted = useRef(false);
  useEffect(() => {
    if (cropDefaulted.current) return;
    const coopCrop = inherited?.primaryCrop?.trim();
    if (!coopCrop || values.cropType.trim().length > 0) return;
    cropDefaulted.current = true;
    setValue('cropType', coopCrop, { shouldValidate: false });
  }, [inherited?.primaryCrop, values.cropType, setValue]);

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
      clientRequestId: clientRequestId.current,
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

    if (!consentId) {
      // Offline captures are queued above and carry their consent when they
      // sync; an online submit needs it now.
      router.push({
        pathname: routes.consent,
        params: { entityType: 'farmer', cooperativeId: selectedCooperativeId },
      });
      return;
    }

    try {
      await createAsync({ ...input, consentId });
      router.back();
    } catch (err) {
      /**
       * "Upload succeeded but registration failed" — one of the exception
       * flows in section 7 of the user flow.
       *
       * The photos and documents are already in storage at this point and
       * their URLs are held in `uploads.*.url`, which survives because this
       * screen stays mounted. So a retry reuses them and uploads nothing
       * again — but the agent had no way of knowing that, and on a field
       * connection the sensible-looking move was to abandon the form rather
       * than risk re-uploading four photos. Saying so is the fix.
       *
       * A field-level rejection (422, or the 409 for a duplicate) is the
       * agent's to correct, so the form stays put with the field marked. A
       * transient failure is not theirs to correct, so the record is offered
       * to the local queue instead of being lost — it carries the uploaded
       * URLs, so syncing it later re-sends the body without re-uploading.
       */
      const error = AppError.from(err);
      const marked = applyServerFieldErrors(err, setError, FARMER_SERVER_FIELDS);

      if (marked) return;

      const isTransient =
        error.status === undefined || error.status === 0 || error.status >= 500;

      if (isTransient) {
        setFailedSubmission({ input, message: error.message });
        return;
      }

      showError(
        uploads.hasUploads
          ? `${error.message} Your photos and documents are already uploaded — fix the problem above and submit again without re-attaching them.`
          : error.message,
      );
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

      {selectedCooperativeId ? (
        <>
          <InheritedFieldsCard
            cooperativeName={inherited?.name}
            registrationNumber={inherited?.registrationNumber}
            address={inherited?.address}
            state={inherited?.state}
            lga={inherited?.lga}
            primaryCrop={inherited?.primaryCrop}
            loading={loadingInherited}
          />
          <View style={{ height: h(24) }} />
        </>
      ) : null}

      <PersonalInformationSection
        control={control}
        errors={errors}
        setValue={setValue}
        values={values}
        // Locked only when the state and LGA actually arrived from the
        // cooperative. If the fetch failed, the agent must still be able to
        // fill them in rather than face two dropdowns they cannot touch.
        stateLgaLocked={Boolean(inherited?.state && inherited?.lga)}
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

      {/*
        A registration that failed for a reason the agent cannot fix. The
        alternative — a toast and a full form of field data they must retype
        — is how a day's onboarding gets lost on a weak connection.
      */}
      <ConfirmSheet
        visible={failedSubmission != null}
        title="Could not reach the server"
        message={`${failedSubmission?.message ?? ''} Save this farmer on your device instead? Your photos and documents are already uploaded, so sending it again will not re-upload them.`}
        cancelText="Keep editing"
        confirmText="Save on device"
        onCancel={() => setFailedSubmission(null)}
        onConfirm={queueFailedSubmission}
      />
    </AppSkeleton>
  );
}
