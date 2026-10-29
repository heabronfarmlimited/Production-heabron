/**
 * "Financing request" — ported from
 * .../view/financing/financing_request_view.dart (`financing_request_view`)
 *
 * Dart layout: a back button, 23 space, 'Financing request' (20sp w600), 8
 * space, the subtitle 'Submit a new financing request for a farmer in
 * <name>.' (14sp grey), 30 space, then either the empty-state box or the
 * farmer dropdown, Loan Amount, Season, Repayment Window, Loan Purpose, 60
 * space, the 'Submit request' button (h54) and 32 space.
 *
 * Four fixes:
 *
 *  1. It read `farmersCooperativeProvider.farmers`, a global the *detail*
 *     screen populated. Reached any other way — a deep link, or the dashboard
 *     — the dropdown was empty and the empty-state box claimed the cooperative
 *     had no farmers. This screen loads its own list from
 *     `GET /agent/cooperatives/:id/farmers`.
 *  2. The dropdown's label was `controller.selectedFarmer?.id` — a raw UUID
 *     once a farmer was picked. It shows the farmer's name.
 *  3. Options were `"${fullName}-${nin}"` strings resolved back with
 *     `firstWhere((f) => f.fullName == val.split('-').first)` and no `orElse`,
 *     so a hyphenated name threw a StateError and two farmers sharing a name
 *     resolved to whichever came first. The option *value* is the farmer id.
 *  4. 'Repayment Window (Days)' had no bounds; the validator is
 *     `min(30).max(540)`. See `financingRequestSchema`.
 *
 * Also removed: a commented-out `bottomSheet:` holding a duplicate submit
 * button, and the `60.verticalSpace` that existed only to clear it.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppDropdown } from '../../../components/AppDropdown';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { AppBackButton } from '../../../components/BaseAppBar';
import {
  FINANCING_SEASONS,
  REPAYMENT_WINDOW,
  type Option,
} from '../../../core/api/domainConstants';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { titleCase } from '../../../core/utils/format';
import { applyServerFieldErrors } from '../../../core/utils/serverFieldErrors';
import { NairaPrefix } from '../../auth/components/FieldIcons';
import type { Farmer } from '../../farmers/model/farmer';
import { useCooperative, useCooperativeFarmers } from '../hooks/useCooperatives';
import { useCreateFinancingRequest } from '../hooks/useFinancing';
import {
  emptyFinancingRequestForm,
  financingRequestSchema,
  type FinancingRequestForm,
} from '../model/validation';

/** Fields `createFinancingRequest` can reject by name. */
const SERVER_FIELDS = [
  'farmerId',
  'loanAmount',
  'season',
  'repaymentWindowDays',
  'purpose',
] as const;

export interface FinancingRequestScreenProps {
  cooperativeId: string;
}

export function FinancingRequestScreen({
  cooperativeId,
}: FinancingRequestScreenProps) {
  const router = useRouter();

  const { data: cooperative } = useCooperative(cooperativeId);
  const {
    items: farmers,
    isLoading: loadingFarmers,
    hasNextPage,
    loadMore,
  } = useCooperativeFarmers(cooperativeId);

  const { mutate: submitRequest, isPending } =
    useCreateFinancingRequest(cooperativeId);

  /**
   * A dropdown must offer every farmer, not just the first page, so this pages
   * through to the end. A cooperative holds tens of farmers, not thousands —
   * `usePaginatedList` caps `pageSize` at the validator's 100 — so this
   * settles in one or two extra requests.
   */
  useEffect(() => {
    if (hasNextPage) loadMore();
  }, [hasNextPage, loadMore]);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FinancingRequestForm>({
    resolver: zodResolver(financingRequestSchema),
    mode: 'onTouched',
    defaultValues: emptyFinancingRequestForm(),
  });

  /**
   * The dropdown option value is the farmer id; the label is the name, with
   * the last four NIN digits appended only when two farmers share a name —
   * which is what the Dart `"${fullName}-${nin}"` key was reaching for, except
   * it put the whole NIN in front of every agent and used it as the identity.
   */
  const farmerOptions = useMemo<Option[]>(() => {
    const nameCounts = farmers.reduce<Record<string, number>>((acc, f) => {
      const key = (f.fullName ?? '').trim().toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return farmers.map((farmer: Farmer) => {
      const name = farmer.fullName ? titleCase(farmer.fullName) : 'Unknown Farmer';
      const key = (farmer.fullName ?? '').trim().toLowerCase();
      const ambiguous = (nameCounts[key] ?? 0) > 1;
      const suffix =
        ambiguous && farmer.nin ? ` — NIN ••••${farmer.nin.slice(-4)}` : '';
      return { label: `${name}${suffix}`, value: farmer.id };
    });
  }, [farmers]);

  const onSubmit = (values: FinancingRequestForm) => {
    submitRequest(values, {
      onSuccess: () => router.back(),
      onError: (err) => applyServerFieldErrors(err, setError, SERVER_FIELDS),
    });
  };

  const hasFarmers = farmers.length > 0;

  return (
    <AppSkeleton scrollable>
      <AppBackButton />

      <View style={{ height: h(23) }} />

      <Text style={styles.title}>Financing request</Text>

      <View style={{ height: h(8) }} />

      <Text style={styles.subtitle}>
        {`Submit a new financing request for a farmer in ${
          cooperative?.name ?? 'this cooperative'
        }.`}
      </Text>

      <View style={{ height: h(30) }} />

      {/*
        The Dart screen rendered this box whenever its global farmer list was
        empty — including while a fetch was in flight — so the most common
        sight was a cooperative being told it had no farmers. It waits for the
        request to settle.
      */}
      {!hasFarmers && !loadingFarmers ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            No farmers found in this cooperative. Please onboard farmers first
            before submitting financing requests.
          </Text>
        </View>
      ) : (
        <Controller
          control={control}
          name="farmerId"
          render={({ field }) => (
            <AppDropdown
              title="Select Farmer"
              label={loadingFarmers ? 'Loading farmers…' : 'Select Farmer'}
              options={farmerOptions}
              value={field.value}
              onChange={field.onChange}
              enabled={hasFarmers}
              error={errors.farmerId?.message}
              searchable
              testID="financing-farmer"
            />
          )}
        />
      )}

      <View style={{ height: h(20) }} />

      <Controller
        control={control}
        name="loanAmount"
        render={({ field }) => (
          <AppTextField
            title="Loan Amount (₦)"
            hintText="e.g. 50000"
            keyboardType="number-pad"
            prefix={<NairaPrefix />}
            value={field.value}
            // Dart: FilteringTextInputFormatter.digitsOnly
            onChangeText={(text) => field.onChange(text.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.loanAmount?.message}
            testID="financing-amount"
          />
        )}
      />

      <View style={{ height: h(20) }} />

      <Controller
        control={control}
        name="season"
        render={({ field }) => (
          <AppDropdown
            title="Season"
            label="Wet"
            options={FINANCING_SEASONS}
            value={field.value}
            onChange={field.onChange}
            error={errors.season?.message}
            testID="financing-season"
          />
        )}
      />

      <View style={{ height: h(20) }} />

      <Controller
        control={control}
        name="repaymentWindowDays"
        render={({ field }) => (
          <AppTextField
            title="Repayment Window (Days)"
            hintText={String(REPAYMENT_WINDOW.default)}
            keyboardType="number-pad"
            value={field.value}
            onChangeText={(text) => field.onChange(text.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.repaymentWindowDays?.message}
            counterText={`Between ${REPAYMENT_WINDOW.min} and ${REPAYMENT_WINDOW.max} days`}
            testID="financing-window"
          />
        )}
      />

      <View style={{ height: h(20) }} />

      <Controller
        control={control}
        name="purpose"
        render={({ field }) => (
          <AppTextField
            title="Loan Purpose"
            hintText="What is it being used for? (e.g. Fertilizer, Seeds)"
            minLines={3}
            maxLines={5}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.purpose?.message}
            testID="financing-purpose"
          />
        )}
      />

      <View style={{ height: h(32) }} />

      <AppButton
        text="Submit request"
        height={54}
        loading={isPending}
        disabled={!hasFarmers}
        onPress={handleSubmit(onSubmit)}
        testID="financing-submit"
      />

      <View style={{ height: h(32) }} />
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
  emptyBox: {
    padding: r(16),
    backgroundColor: colors.primaryLight,
    borderRadius: r(12),
  },
  emptyText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.secondaryDeep,
  },
});
