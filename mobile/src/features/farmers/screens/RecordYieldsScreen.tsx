/**
 * Record / Edit Yield — ported from
 * modules/farmers/presentation/view/record_yields_view.dart (620 LOC) and
 * record_yields_controller.dart (489 LOC)
 *
 * Three sections, in Dart order: the season / crop / cycle / dates / yields
 * block, 'Input Usage & Farm Income', and 'Yield Verification'.
 *
 * Fixes:
 *  - `submit` and `updateProduction` were ~110 duplicated lines each; one
 *    handler and two mutations replace both.
 *  - The Dart edit path skipped prefilling harvest photos entirely, with a
 *    7-line comment explaining that mapping URLs back to `File`s was "tricky".
 *    `useImageListField` holds URLs, so they prefill.
 *  - The crop dropdown had no validator and `submit` toasted instead; the
 *    schema covers it, including the `'others'` → Custom Crop Name rule.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppDropdown } from '../../../components/AppDropdown';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { DateField } from '../../../components/DateField';
import { defaultProductionSeason, type Option } from '../../../core/api/domainConstants';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { titleCase } from '../../../core/utils/format';
import { showError } from '../../../core/utils/toast';
import { Divider, FormSectionHeading } from '../components/SectionTitle';
import { UploadRow } from '../components/UploadCard';
import { useYieldFormUploads } from '../hooks/useFarmerFormUploads';
import { useFarmer } from '../hooks/useFarmers';
import {
  useCreateProduction,
  useProduction,
  useUpdateProduction,
} from '../hooks/useProductions';
import { OTHER_CROP_VALUE, resolveYieldCrops } from '../model/farmer';
import { numOrUndefined, intOrUndefined, orUndefined } from '../model/primitives';
import {
  DEFAULT_CYCLE_NUMBER,
  type ProductionFormInput,
} from '../model/productionYield';
import {
  emptyProductionForm,
  productionFormSchema,
  type ProductionForm,
} from '../model/validation';

import { useRouteParams } from './routeParams';

export interface RecordYieldsScreenProps {
  /** Optional overrides; normally the route param and the `productionId` query. */
  farmerId?: string;
  /** Present when editing an existing record. */
  productionId?: string;
}

export function RecordYieldsScreen(props: RecordYieldsScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.id ?? '';
  const productionId = props.productionId ?? params.productionId;
  const isEditing = Boolean(productionId);

  const { farmer } = useFarmer(farmerId);
  const { production } = useProduction(productionId ?? '');

  const uploads = useYieldFormUploads({
    harvestPhotoUrls: production?.harvestPhotoUrls,
    warehouseReceiptUrl: production?.warehouseReceiptUrl,
    buyerReceiptUrl: production?.buyerReceiptUrl,
    agentSignatureUrl: production?.agentSignatureUrl,
  });

  const { createAsync, isPending: isCreating } = useCreateProduction();
  const { updateAsync, isPending: isUpdating } = useUpdateProduction(
    productionId ?? '',
  );

  /**
   * The crop list: every crop recorded against the farmer, plus `'others'`.
   * `resolveYieldCrops` falls back to the five crops the Dart controller
   * hardcoded when the farmer has none on file.
   */
  const cropOptions: Option[] = useMemo(
    () =>
      resolveYieldCrops(farmer).map((crop) => ({
        label: crop === OTHER_CROP_VALUE ? 'Others' : titleCase(crop),
        value: crop,
      })),
    [farmer],
  );

  const firstCrop = cropOptions[0]?.value ?? OTHER_CROP_VALUE;

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ProductionForm>({
    resolver: zodResolver(productionFormSchema),
    // Dart had no `autovalidateMode` on this form; validate on submit + touch.
    mode: 'onTouched',
    defaultValues: emptyProductionForm(defaultProductionSeason(), firstCrop),
  });

  // Seed the crop once the farmer's crops are known (Dart preselected the
  // first crop unless it was `'others'`).
  const seededCrop = useRef(false);
  useEffect(() => {
    if (seededCrop.current || isEditing || cropOptions.length === 0) return;
    seededCrop.current = true;
    setValue('crop', firstCrop);
  }, [cropOptions.length, firstCrop, isEditing, setValue]);

  // Prefill once when editing.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!production || prefilled.current) return;
    prefilled.current = true;
    const known = cropOptions.some((o) => o.value === production.crop);
    reset({
      season: production.season,
      crop: known ? production.crop : OTHER_CROP_VALUE,
      customCrop: known ? '' : production.crop,
      cycleNumber: `${production.cycleNumber}`,
      expectedPlantingDate: (production.expectedPlantingDate ?? '').slice(0, 10),
      expectedHarvestDate: (production.expectedHarvestDate ?? '').slice(0, 10),
      expectedYieldTonnes: production.expectedYieldTonnes?.toString() ?? '',
      actualYieldTonnes: production.actualYieldTonnes?.toString() ?? '',
      benchmarkYieldTonnes: production.benchmarkYieldTonnes?.toString() ?? '',
      seedType: production.seedType ?? '',
      fertilizerUsed: production.fertilizerUsed ?? '',
      herbicideUsed: production.herbicideUsed ?? false,
      postHarvestStorage: production.postHarvestStorage ?? '',
      estimatedFarmIncome: production.estimatedFarmIncome?.toString() ?? '',
      harvestDate: (production.harvestDate ?? '').slice(0, 10),
      verificationNotes: production.verificationNotes ?? '',
      notes: production.notes ?? '',
    });
  }, [production, cropOptions, reset]);

  const values = watch();
  const showCustomCrop = values.crop === OTHER_CROP_VALUE;
  const farmerName = farmer?.fullName ?? 'Farmer';

  const onSubmit = async (form: ProductionForm) => {
    if (uploads.uploading) {
      showError('Please wait for the uploads to finish.');
      return;
    }

    const crop = showCustomCrop ? form.customCrop.trim() : form.crop;
    if (crop.length === 0) {
      showError('Please enter or select a crop');
      return;
    }

    const input: ProductionFormInput = {
      farmerId,
      season: form.season,
      crop,
      cycleNumber: intOrUndefined(form.cycleNumber) ?? DEFAULT_CYCLE_NUMBER,
      expectedPlantingDate: orUndefined(form.expectedPlantingDate),
      expectedHarvestDate: orUndefined(form.expectedHarvestDate),
      expectedYieldTonnes: numOrUndefined(form.expectedYieldTonnes),
      actualYieldTonnes: numOrUndefined(form.actualYieldTonnes),
      benchmarkYieldTonnes: numOrUndefined(form.benchmarkYieldTonnes),
      notes: orUndefined(form.notes),
      harvestDate: orUndefined(form.harvestDate),
      harvestPhotoUrls: uploads.harvestPhotos.urls,
      warehouseReceiptUrl: uploads.warehouseReceipt.url,
      buyerReceiptUrl: uploads.buyerReceipt.url,
      agentSignatureUrl: uploads.agentSignature.url,
      verificationNotes: orUndefined(form.verificationNotes),
      seedType: orUndefined(form.seedType),
      fertilizerUsed: orUndefined(form.fertilizerUsed),
      herbicideUsed: form.herbicideUsed,
      postHarvestStorage: orUndefined(form.postHarvestStorage),
      estimatedFarmIncome: numOrUndefined(form.estimatedFarmIncome),
    };

    try {
      if (isEditing) {
        await updateAsync(input);
      } else {
        await createAsync(input);
      }
      router.back();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save this yield.');
    }
  };

  const isPending = isCreating || isUpdating;

  return (
    <AppSkeleton
      appBarTitle={isEditing ? 'Edit Yield' : 'Record Yield'}
      isBusy={isPending}
      scrollable
    >
      <View style={{ height: h(24) }} />

      <Text style={styles.intro}>
        {isEditing
          ? `Edit yield for ${farmerName}.`
          : `Record yield per year/season for ${farmerName}. This updates their credit profile score.`}
      </Text>

      <View style={{ height: h(30) }} />

      <Controller
        control={control}
        name="season"
        render={({ field }) => (
          <AppTextField
            title="Season (Required)"
            hintText="e.g. wet_2026"
            autoCapitalize="none"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.season?.message}
            testID="yield-season"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <AppDropdown
        title="Crop (Required)"
        label="Select crop"
        options={cropOptions}
        value={values.crop.length > 0 ? values.crop : null}
        error={errors.crop?.message}
        onChange={(next) => {
          setValue('crop', next, { shouldValidate: true });
          if (next !== OTHER_CROP_VALUE) setValue('customCrop', '');
        }}
        testID="yield-crop"
      />

      {showCustomCrop ? (
        <>
          <View style={{ height: h(12) }} />
          <Controller
            control={control}
            name="customCrop"
            render={({ field }) => (
              <AppTextField
                title="Custom Crop Name"
                hintText="Enter crop name"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.customCrop?.message}
                testID="yield-custom-crop"
              />
            )}
          />
        </>
      ) : null}

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="cycleNumber"
        render={({ field }) => (
          <AppTextField
            title="Cycle Number"
            hintText="Enter cycle number"
            keyboardType="number-pad"
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.cycleNumber?.message}
            testID="yield-cycle"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="expectedPlantingDate"
        render={({ field }) => (
          <DateField
            title="Expected Planting Date (Optional)"
            hintText="Select planting date"
            value={field.value}
            onChange={field.onChange}
            error={errors.expectedPlantingDate?.message}
            minimumDate={new Date(2000, 0, 1)}
            maximumDate={new Date(2100, 0, 1)}
            clearable
            testID="yield-planting-date"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="expectedHarvestDate"
        render={({ field }) => (
          <DateField
            title="Expected Harvest Date (Optional)"
            hintText="Select harvest date"
            value={field.value}
            onChange={field.onChange}
            error={errors.expectedHarvestDate?.message}
            minimumDate={new Date(2000, 0, 1)}
            maximumDate={new Date(2100, 0, 1)}
            clearable
            testID="yield-expected-harvest-date"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <DecimalField
        control={control}
        name="expectedYieldTonnes"
        title="Expected Yield (Tonnes) (Optional)"
        hint="e.g. 8.0"
        error={errors.expectedYieldTonnes?.message}
      />

      <View style={{ height: h(16) }} />

      <DecimalField
        control={control}
        name="actualYieldTonnes"
        title="Actual Yield (Tonnes) (Optional)"
        hint="e.g. 7.2"
        error={errors.actualYieldTonnes?.message}
      />

      <View style={{ height: h(16) }} />

      <DecimalField
        control={control}
        name="benchmarkYieldTonnes"
        title="Benchmark Yield (Tonnes) (Optional)"
        hint="e.g. 9.0"
        error={errors.benchmarkYieldTonnes?.message}
      />

      <View style={{ height: h(32) }} />
      <Divider />
      <View style={{ height: h(16) }} />

      <FormSectionHeading title="Input Usage & Farm Income" />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="seedType"
        render={({ field }) => (
          <AppTextField
            title="Seed Type"
            hintText="e.g. Improved TME 419"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.seedType?.message}
            testID="yield-seed-type"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="fertilizerUsed"
        render={({ field }) => (
          <AppTextField
            title="Fertilizer Used"
            hintText="e.g. NPK 15-15-15"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.fertilizerUsed?.message}
            testID="yield-fertilizer"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="herbicideUsed"
        render={({ field }) => (
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Herbicide Used?</Text>
            <Switch
              accessibilityLabel="Herbicide Used?"
              value={field.value}
              onValueChange={field.onChange}
              trackColor={{ true: colors.primary, false: colors.secondary200 }}
              thumbColor={colors.white}
              testID="yield-herbicide"
            />
          </View>
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="postHarvestStorage"
        render={({ field }) => (
          <AppTextField
            title="Post-Harvest Storage"
            hintText="e.g. Cooperative warehouse"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.postHarvestStorage?.message}
            testID="yield-storage"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="estimatedFarmIncome"
        render={({ field }) => (
          <AppTextField
            title="Estimated Farm Income (₦)"
            hintText="e.g. 168000"
            keyboardType="number-pad"
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.estimatedFarmIncome?.message}
            testID="yield-income"
          />
        )}
      />

      <View style={{ height: h(32) }} />
      <Divider />
      <View style={{ height: h(16) }} />

      <FormSectionHeading title="Yield Verification" />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="harvestDate"
        render={({ field }) => (
          <DateField
            title="Harvest Date"
            hintText="Select harvest date"
            value={field.value}
            onChange={field.onChange}
            error={errors.harvestDate?.message}
            minimumDate={new Date(2000, 0, 1)}
            maximumDate={new Date(2100, 0, 1)}
            testID="yield-harvest-date"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="verificationNotes"
        render={({ field }) => (
          <AppTextField
            title="Verification Notes"
            hintText="e.g. Counted at warehouse"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.verificationNotes?.message}
            testID="yield-verification-notes"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <UploadRow
        title="Harvest Photos"
        hasFile={uploads.harvestPhotos.count > 0}
        fileCount={uploads.harvestPhotos.count}
        uploading={uploads.harvestPhotos.uploading}
        onPress={() => void uploads.harvestPhotos.add()}
        testID="yield-harvest-photos"
      />

      <View style={{ height: h(8) }} />

      <UploadRow
        title="Warehouse Receipt"
        hasFile={uploads.warehouseReceipt.hasValue}
        uploading={uploads.warehouseReceipt.uploading}
        onPress={() => void uploads.warehouseReceipt.chooseFromLibrary()}
        testID="yield-warehouse-receipt"
      />

      <View style={{ height: h(8) }} />

      <UploadRow
        title="Buyer Receipt"
        hasFile={uploads.buyerReceipt.hasValue}
        uploading={uploads.buyerReceipt.uploading}
        onPress={() => void uploads.buyerReceipt.chooseFromLibrary()}
        testID="yield-buyer-receipt"
      />

      <View style={{ height: h(8) }} />

      <UploadRow
        title="Agent Signature"
        hasFile={uploads.agentSignature.hasValue}
        uploading={uploads.agentSignature.uploading}
        onPress={() => void uploads.agentSignature.chooseFromLibrary()}
        testID="yield-agent-signature"
      />

      <View style={{ height: h(32) }} />

      <AppButton
        text={isEditing ? 'Update yield' : 'Record yield'}
        height={54}
        loading={isPending}
        disabled={uploads.uploading}
        onPress={handleSubmit(onSubmit)}
        testID="yield-submit"
      />

      <View style={{ height: h(24) }} />
    </AppSkeleton>
  );
}

/** The three `allow(RegExp(r'^\d*\.?\d*'))` decimal fields. */
function DecimalField({
  control,
  name,
  title,
  hint,
  error,
}: {
  control: ReturnType<typeof useForm<ProductionForm>>['control'];
  name: 'expectedYieldTonnes' | 'actualYieldTonnes' | 'benchmarkYieldTonnes';
  title: string;
  hint: string;
  error?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <AppTextField
          title={title}
          hintText={hint}
          keyboardType="decimal-pad"
          value={field.value}
          onChangeText={(t) => field.onChange(t.replace(/[^0-9.]/g, ''))}
          onBlur={field.onBlur}
          error={error}
          testID={`yield-${name}`}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  intro: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    flex: 1,
    marginRight: r(12),
  },
});
