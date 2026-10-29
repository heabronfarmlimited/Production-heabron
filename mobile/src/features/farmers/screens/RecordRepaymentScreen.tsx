/**
 * Record Repayment — ported from
 * modules/farmers/presentation/view/record_repayment_view.dart (406 LOC) and
 * record_repayment_controller.dart
 *
 * Fields in Dart order: the financing-request picker (with its three-way
 * fetching / empty / ready state), Amount Paid (₦), Reference Number, Payment
 * Method, Context Flag plus its explainer box, Context Notes, Payment Date and
 * Proof of Payment.
 *
 * Fixes:
 *  - The proof field was labelled `(Optional)` while `submit` returned early
 *    with 'Please upload a proof photo'. It is labelled required and enforced
 *    by `repaymentFormSchema` with the same message.
 *  - The Payment Method dropdown listed four raw snake_case values and showed
 *    them unformatted to the agent (`bank_transfer`). It uses
 *    `PAYMENT_METHODS` — all seven the validator accepts, with readable labels
 *    and the canonical value sent.
 *  - Context Flag did the same; it uses `CONTEXT_FLAGS`.
 *  - `init` bailed when `farmer.cooperativeId == null`, leaving a silently
 *    empty picker. The query needs only the farmer id.
 *  - The picker offered every financing request, including ones
 *    `repayments.controller.create` rejects with a 400 ("status is
 *    \"pending\""). Only `approved` / `disbursed` requests are offered, and
 *    the empty state distinguishes "no loans" from "no repayable loans".
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppDropdown } from '../../../components/AppDropdown';
import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { DateField } from '../../../components/DateField';
import {
  CONTEXT_FLAG_HELP,
  CONTEXT_FLAGS,
  DEFAULT_CONTEXT_FLAG,
  DEFAULT_PAYMENT_METHOD,
  PAYMENT_METHODS,
  type Option,
} from '../../../core/api/domainConstants';
import { useImageField } from '../../../core/hooks/useMediaPicker';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatNaira } from '../../../core/utils/format';
import { showError } from '../../../core/utils/toast';
import { NairaPrefix } from '../../auth/components/FieldIcons';
import { UploadCard } from '../components/UploadCard';
import { useFarmer } from '../hooks/useFarmers';
import {
  useCreateRepayment,
  useFarmerFinancingRequests,
} from '../hooks/useRepayments';
import { toDateOnly } from '../model/primitives';
import { uploadKinds } from '../model/uploadKinds';
import { repaymentFormSchema, type RepaymentForm } from '../model/validation';

import { useRouteParams } from './routeParams';

/** The Dart info box: bg #F0F9FF, border #BAE6FD, icon #0284C7, text #0369A1. */
const INFO_BG = '#F0F9FF';
const INFO_BORDER = '#BAE6FD';
const INFO_ICON = '#0284C7';
const INFO_TEXT = '#0369A1';

/** The Dart amber empty box: bg #FFF7ED, border #FED7AA, icon #EA580C, text #C2410C. */
const WARN_BG = '#FFF7ED';
const WARN_BORDER = '#FED7AA';
const WARN_ICON = '#EA580C';
const WARN_TEXT = '#C2410C';

/** Dart dropdown border. */
const FIELD_BORDER = '#D6DDEB';

export interface RecordRepaymentScreenProps {
  /**
   * Optional override. The live route is `/financing/[id]/repayment`, which
   * also carries `?farmerId=`; the segment alone cannot say whether it is a
   * farmer or a financing request, so the query value wins.
   */
  farmerId?: string;
}

export function RecordRepaymentScreen(props: RecordRepaymentScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.farmerId ?? params.id ?? '';

  const { farmer } = useFarmer(farmerId);
  const { requests, allRequests, isLoading: isFetchingRequests } =
    useFarmerFinancingRequests(farmerId);

  const proof = useImageField(uploadKinds.transactionReceipt);
  const { recordAsync, isPending } = useCreateRepayment(farmerId);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RepaymentForm>({
    resolver: zodResolver(repaymentFormSchema),
    mode: 'onTouched',
    defaultValues: {
      financingRequestId: '',
      amountPaid: '',
      referenceNumber: '',
      paymentMethod: DEFAULT_PAYMENT_METHOD,
      contextFlag: DEFAULT_CONTEXT_FLAG,
      contextNotes: '',
      // Dart defaulted to today and capped the picker at `now`.
      paymentDate: toDateOnly(new Date()) ?? '',
      proofPhotoUrl: '',
    },
  });

  const values = watch();

  /**
   * Option text from Dart: `'${purpose ?? "Loan"} (₦${NumberFormat('#,##0')})'`.
   * The value is the request id, so the control is keyed by id while the label
   * stays human-readable — never a bare UUID.
   */
  const requestOptions: Option[] = useMemo(
    () =>
      requests.map((request) => ({
        label: `${request.purpose ?? 'Loan'} (${formatNaira(
          request.approvedAmount ?? request.loanAmount,
          { decimals: false },
        )})`,
        value: request.id,
      })),
    [requests],
  );

  // Dart preselected the first request; keep that, but only once options load.
  useEffect(() => {
    if (values.financingRequestId.length > 0) return;
    const first = requestOptions[0];
    if (first) setValue('financingRequestId', first.value);
  }, [requestOptions, setValue, values.financingRequestId]);

  // Keep the uploaded proof URL in the form so the schema can require it.
  useEffect(() => {
    const url = proof.url ?? '';
    if (values.proofPhotoUrl !== url) {
      setValue('proofPhotoUrl', url, { shouldValidate: values.proofPhotoUrl !== '' });
    }
  }, [proof.url, setValue, values.proofPhotoUrl]);

  const farmerName = farmer?.fullName ?? 'Farmer';

  const onSubmit = async (form: RepaymentForm) => {
    if (proof.uploading) {
      showError('Please wait for the proof photo to finish uploading.');
      return;
    }

    try {
      await recordAsync({
        financingRequestId: form.financingRequestId,
        farmerId,
        amountPaid: Number(form.amountPaid),
        paymentDate: form.paymentDate,
        paymentMethod: form.paymentMethod,
        referenceNumber: form.referenceNumber,
        proofPhotoUrl: form.proofPhotoUrl,
        contextFlag: form.contextFlag,
        contextNotes: form.contextNotes,
      });
      router.back();
    } catch (err) {
      showError(
        err instanceof Error ? err.message : 'Could not record this repayment.',
      );
    }
  };

  return (
    <AppSkeleton appBarTitle="Record Repayment" isBusy={isPending} scrollable>
      <View style={{ height: h(20) }} />

      <Text accessibilityRole="header" style={styles.title}>
        Record Repayment
      </Text>

      <View style={{ height: h(8) }} />

      <Text style={styles.subtitle}>
        {`Record a repayment against an active financing request for ${farmerName}.`}
      </Text>

      <View style={{ height: h(30) }} />

      {/* ------------------------------------- financing request picker */}
      <Text style={styles.fieldLabel}>Select Financing Request</Text>
      <View style={{ height: h(8) }} />

      {isFetchingRequests ? (
        <View style={styles.fetchingBox}>
          <AppLoading color={colors.primary} />
          <View style={{ width: r(16) }} />
          <Text style={styles.fetchingText}>
            Fetching active financing requests...
          </Text>
        </View>
      ) : requestOptions.length === 0 ? (
        <View style={styles.warnBox}>
          <Text accessible={false} style={styles.warnIcon}>
            ⚠
          </Text>
          <View style={{ width: r(12) }} />
          <Text style={styles.warnText}>
            {allRequests.length === 0
              ? 'No active financing requests found for this farmer.'
              : 'This farmer has financing requests, but none are approved or disbursed yet, so a repayment cannot be recorded.'}
          </Text>
        </View>
      ) : (
        <AppDropdown
          label="Select financing request"
          options={requestOptions}
          value={
            values.financingRequestId.length > 0 ? values.financingRequestId : null
          }
          error={errors.financingRequestId?.message}
          onChange={(next) =>
            setValue('financingRequestId', next, { shouldValidate: true })
          }
          testID="repayment-financing-request"
        />
      )}

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="amountPaid"
        render={({ field }) => (
          <AppTextField
            title="Amount Paid (₦)"
            hintText="Enter amount paid"
            prefix={<NairaPrefix />}
            keyboardType="number-pad"
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.amountPaid?.message}
            testID="repayment-amount"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="referenceNumber"
        render={({ field }) => (
          <AppTextField
            title="Reference Number"
            hintText="Enter payment reference or receipt number"
            autoCapitalize="characters"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.referenceNumber?.message}
            testID="repayment-reference"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <AppDropdown
        title="Payment Method"
        label="Select payment method"
        options={PAYMENT_METHODS}
        value={values.paymentMethod.length > 0 ? values.paymentMethod : null}
        error={errors.paymentMethod?.message}
        onChange={(next) => setValue('paymentMethod', next, { shouldValidate: true })}
        testID="repayment-method"
      />

      <View style={{ height: h(16) }} />

      <AppDropdown
        title="Context Flag"
        label="Select context flag"
        options={CONTEXT_FLAGS}
        value={values.contextFlag.length > 0 ? values.contextFlag : null}
        error={errors.contextFlag?.message}
        onChange={(next) => setValue('contextFlag', next, { shouldValidate: true })}
        testID="repayment-context-flag"
      />

      <View style={{ height: h(8) }} />

      <View style={styles.infoBox}>
        <Text accessible={false} style={styles.infoIcon}>
          ⓘ
        </Text>
        <View style={{ width: r(12) }} />
        <Text style={styles.infoText}>{CONTEXT_FLAG_HELP}</Text>
      </View>

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="contextNotes"
        render={({ field }) => (
          <AppTextField
            title="Context Notes"
            hintText="Enter any notes regarding external events or payment context"
            maxLines={3}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.contextNotes?.message}
            testID="repayment-context-notes"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="paymentDate"
        render={({ field }) => (
          <DateField
            title="Payment Date"
            hintText="Select payment date"
            value={field.value}
            onChange={field.onChange}
            error={errors.paymentDate?.message}
            minimumDate={new Date(2000, 0, 1)}
            // `paymentDate: Joi.date().iso().max('now')`
            maximumDate={new Date()}
            testID="repayment-date"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      {/*
        FIXED — Dart labelled this '(Optional)' and then refused to submit
        without it. `hasRequired` on the card title would be redundant with the
        word, so the label says so outright.
      */}
      <UploadCard
        title="Proof of Payment (Required)"
        subtitle="Tap to upload proof photo"
        previewUri={proof.previewUri}
        hasValue={proof.hasValue}
        uploading={proof.uploading}
        onPress={() => void proof.chooseFromLibrary()}
        onClear={proof.clear}
        error={errors.proofPhotoUrl?.message}
        testID="repayment-proof"
      />

      <View style={{ height: h(32) }} />

      <AppButton
        text="Record payment"
        height={54}
        loading={isPending}
        disabled={proof.uploading || requestOptions.length === 0}
        onPress={handleSubmit(onSubmit)}
        testID="repayment-submit"
      />

      <View style={{ height: h(24) }} />
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  title: {
    ...textTheme.headlineMedium,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  subtitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
  },
  fieldLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
  },
  fetchingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: r(16),
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    borderRadius: r(8),
  },
  fetchingText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
    flex: 1,
  },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: r(16),
    backgroundColor: WARN_BG,
    borderWidth: 1,
    borderColor: WARN_BORDER,
    borderRadius: r(8),
  },
  warnIcon: {
    fontSize: spMin(18),
    color: WARN_ICON,
  },
  warnText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: WARN_TEXT,
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: r(12),
    backgroundColor: INFO_BG,
    borderWidth: 1,
    borderColor: INFO_BORDER,
    borderRadius: r(8),
  },
  infoIcon: {
    fontSize: spMin(16),
    color: INFO_ICON,
  },
  infoText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: INFO_TEXT,
    lineHeight: spMin(12) * 1.4,
    flex: 1,
  },
});
