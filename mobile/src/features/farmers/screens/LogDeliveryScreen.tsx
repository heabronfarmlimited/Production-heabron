/**
 * Log a produce delivery — one of the five records in the v2 Update Record
 * hub.
 *
 * No Flutter equivalent, and no screen in this app until now either: the
 * delivery schema, the request body builder, the API call and the
 * `useCreateDelivery` mutation all existed and were all unreachable. The
 * home screen's "Log delivery" action opened the Activities tab, which only
 * LISTS deliveries — so an agent could read deliveries the system had no way
 * of recording. Deliveries are what the repayment score's timeliness is
 * measured against, which made the gap worse than cosmetic.
 *
 * The crop choices come from the farmer's own farms (every crop across every
 * farm, primary first) rather than a fixed list, so a delivery cannot be
 * logged against a crop this farmer does not grow by a slip of the finger.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppDropdown } from '../../../components/AppDropdown';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { DateField } from '../../../components/DateField';
import { SkeletonCard } from '../../../components/Skeleton';
import { QUALITY_GRADES } from '../../../core/api/domainConstants';
import { useImageListField } from '../../../core/hooks/useMediaPicker';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import { useCreateDelivery } from '../../activities/hooks/useActivities';
import {
  deliverySchema,
  type DeliveryForm,
} from '../../activities/model/delivery';
import { NairaPrefix } from '../../auth/components/FieldIcons';
import { UploadCard } from '../components/UploadCard';
import { useFarmer } from '../hooks/useFarmers';
import { resolveYieldCrops } from '../model/farmer';
import { uploadKinds } from '../model/uploadKinds';

import { useRouteParams } from './routeParams';

export interface LogDeliveryScreenProps {
  farmerId?: string;
}

export function LogDeliveryScreen({ farmerId: farmerIdProp }: LogDeliveryScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = farmerIdProp ?? params.id ?? '';

  const { farmer, isLoading } = useFarmer(farmerId);
  const { logDelivery, isPending } = useCreateDelivery();

  // The warehouse receipt bucket, not a delivery-specific one: the backend's
  // BUCKETS map has no 'delivery_proof' kind, and inventing a name here would
  // 400 on upload. A warehouse receipt is what this proof usually is.
  const proof = useImageListField(uploadKinds.warehouseReceipt);

  const cropOptions = useMemo(
    () => resolveYieldCrops(farmer).map((crop) => ({ label: crop, value: crop })),
    [farmer],
  );

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DeliveryForm>({
    resolver: zodResolver(deliverySchema),
    mode: 'onTouched',
    defaultValues: {
      farmerId,
      crop: '',
      quantityKg: '',
      pricePerKg: '',
      dateDelivered: '',
      buyerName: '',
      warehouse: '',
      receiptNumber: '',
      notes: '',
    },
  });

  const crop = watch('crop');
  const qualityGrade = watch('qualityGrade');
  const dateDelivered = watch('dateDelivered');

  const onSubmit = (form: DeliveryForm) => {
    logDelivery(
      {
        ...form,
        // The cooperative is derived from the farmer rather than asked for:
        // the server accepts it optionally and the agent has no reason to
        // retype something already on the record.
        cooperativeId: farmer?.cooperativeId ?? farmer?.cooperative?.id ?? undefined,
        proofPhotoUrls: proof.urls,
      },
      {
        onSuccess: () => {
          showSuccess('Delivery logged');
          router.back();
        },
        onError: (err) => showApiError(err, 'Could not log the delivery'),
      },
    );
  };

  return (
    <AppSkeleton
      appBarTitle="Log Delivery"
      appBarLeading={<AuthBackButton />}
      firstLoad={isLoading && !farmer ? <SkeletonCard rows={5} /> : null}
      scrollable
      bottomBar={
        <View style={styles.bottomBar}>
          <AppButton
            text="Save Delivery"
            loading={isPending}
            disabled={proof.uploading}
            onPress={handleSubmit(onSubmit)}
            testID="delivery-save"
          />
        </View>
      }
    >
      <View style={{ height: h(16) }} />

      {farmer ? (
        <>
          <Text style={styles.farmerName}>{farmer.fullName}</Text>
          <Text style={styles.farmerMeta}>
            {farmer.cooperative?.name ?? 'No cooperative'}
          </Text>
          <View style={{ height: h(20) }} />
        </>
      ) : null}

      <AppDropdown
        title="Crop"
        label="Select crop"
        options={cropOptions}
        value={crop}
        error={errors.crop?.message}
        onChange={(value) => setValue('crop', value, { shouldValidate: true })}
        testID="delivery-crop"
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="quantityKg"
        render={({ field }) => (
          <AppTextField
            title="Quantity delivered (kg)"
            hintText="0"
            keyboardType="decimal-pad"
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/[^0-9.]/g, ''))}
            onBlur={field.onBlur}
            error={errors.quantityKg?.message}
            testID="delivery-quantity"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <AppDropdown
        title="Quality grade (optional)"
        label="Select grade"
        options={QUALITY_GRADES}
        value={qualityGrade ?? ''}
        error={errors.qualityGrade?.message}
        onChange={(value) =>
          setValue('qualityGrade', value as DeliveryForm['qualityGrade'], {
            shouldValidate: true,
          })
        }
        testID="delivery-grade"
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="pricePerKg"
        render={({ field }) => (
          <AppTextField
            title="Price per kg (optional)"
            hintText="0.00"
            keyboardType="decimal-pad"
            prefix={<NairaPrefix />}
            value={field.value ?? ''}
            onChangeText={(t) => field.onChange(t.replace(/[^0-9.]/g, ''))}
            onBlur={field.onBlur}
            error={errors.pricePerKg?.message}
            testID="delivery-price"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      {/*
        A future delivery date is rejected server-side
        (`date().iso().max('now')`), so the picker will not offer one — a 422
        on a date the agent could not have known was invalid is a poor way to
        find that out.
      */}
      <DateField
        title="Date delivered (optional)"
        hintText="Select the delivery date"
        value={dateDelivered ?? ''}
        maximumDate={new Date()}
        clearable
        onChange={(value) => setValue('dateDelivered', value, { shouldValidate: true })}
        error={errors.dateDelivered?.message}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="buyerName"
        render={({ field }) => (
          <AppTextField
            title="Buyer (optional)"
            hintText="Who took delivery"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.buyerName?.message}
            testID="delivery-buyer"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="warehouse"
        render={({ field }) => (
          <AppTextField
            title="Warehouse (optional)"
            hintText="Where the produce was received"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.warehouse?.message}
            testID="delivery-warehouse"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="receiptNumber"
        render={({ field }) => (
          <AppTextField
            title="Receipt number (optional)"
            hintText="As printed on the receipt"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.receiptNumber?.message}
            testID="delivery-receipt"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <UploadCard
        title="Proof of delivery"
        subtitle={
          proof.urls.length > 0
            ? `${proof.urls.length} photo${proof.urls.length === 1 ? '' : 's'} attached`
            : 'Receipt or weighbridge slip (optional)'
        }
        hasValue={proof.urls.length > 0}
        uploading={proof.uploading}
        onPress={() => void proof.add()}
        onClear={proof.urls.length > 0 ? () => proof.removeAt(proof.urls.length - 1) : undefined}
        testID="delivery-proof"
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <AppTextField
            title="Notes (optional)"
            hintText="Anything worth recording about this delivery"
            maxLines={4}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.notes?.message}
            testID="delivery-notes"
          />
        )}
      />

      <View style={{ height: h(30) }} />
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  farmerName: {
    ...textTheme.titleMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  farmerMeta: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
  },
  bottomBar: {
    paddingHorizontal: r(20),
    paddingBottom: h(12),
  },
});
