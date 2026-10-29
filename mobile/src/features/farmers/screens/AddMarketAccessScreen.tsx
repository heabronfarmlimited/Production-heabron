/**
 * Add / Edit Market Access — ported from
 * modules/farmers/presentation/view/add_market_access_view.dart
 *
 * Fields in Dart order: Season Year, Buyer Name *, Price per Ton (₦), Price
 * Context, Confirmed Buyer?, Harvest Window, Notes. Button 'Save Record' /
 * 'Update Record'.
 *
 * Fixes:
 *  - `isEditing` set the app-bar title to 'Edit Market Access' / 'Add Market
 *    Access' but the in-body title to 'Edit Market Access' / **'Market
 *    Access'** — inconsistent. There is one title now, and it reads
 *    'Add Market Access' when adding.
 *  - 'Price Context' sent `label.toLowerCase().replaceAll('-','_')`, which
 *    happened to produce the right value for all four labels but broke the
 *    moment a label changed. It sends `PRICE_CONTEXTS` values.
 *  - `addMarketAccess` / `updateMarketAccess` had no `finally`, so on success
 *    the screen stayed stuck in its loading state.
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
import {
  PRICE_CONTEXTS,
  seasonYearOptions,
} from '../../../core/api/domainConstants';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { showError } from '../../../core/utils/toast';
import { NairaPrefix } from '../../auth/components/FieldIcons';
import {
  useCreateMarketAccess,
  useMarketAccessRecords,
  useUpdateMarketAccess,
} from '../hooks/useMarketAccess';
import { intOrUndefined, numOrUndefined, orUndefined } from '../model/primitives';
import {
  emptyMarketAccessForm,
  marketAccessFormSchema,
  type MarketAccessForm,
} from '../model/validation';

import { useRouteParams } from './routeParams';

export interface AddMarketAccessScreenProps {
  /** Optional overrides; normally the route param and the `recordId` query. */
  farmerId?: string;
  /** Present when editing. */
  recordId?: string;
}

export function AddMarketAccessScreen(props: AddMarketAccessScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.id ?? '';
  const recordId = props.recordId ?? params.recordId;
  const isEditing = Boolean(recordId);

  // The list is already cached when arriving from Market Access; reading the
  // record from it avoids a by-id endpoint the backend does not expose.
  const { records } = useMarketAccessRecords(farmerId);
  const record = useMemo(
    () => records.find((r) => r.id === recordId) ?? null,
    [records, recordId],
  );

  const { createAsync, isPending: isCreating } = useCreateMarketAccess(farmerId);
  const { updateAsync, isPending: isUpdating } = useUpdateMarketAccess(
    farmerId,
    recordId ?? '',
  );

  const yearOptions = useMemo(() => seasonYearOptions(), []);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<MarketAccessForm>({
    resolver: zodResolver(marketAccessFormSchema),
    mode: 'onTouched',
    defaultValues: emptyMarketAccessForm,
  });

  const prefilled = useRef(false);
  useEffect(() => {
    if (!record || prefilled.current) return;
    prefilled.current = true;
    reset({
      seasonYear: record.seasonYear?.toString() ?? '',
      buyerName: record.buyerName,
      pricePerTon: record.pricePerTon?.toString() ?? '',
      priceContext: record.priceContext ?? '',
      isConfirmed: record.isConfirmed ?? false,
      harvestWindow: record.harvestWindow ?? '',
      notes: record.notes ?? '',
    });
  }, [record, reset]);

  const values = watch();
  const isPending = isCreating || isUpdating;

  const onSubmit = async (form: MarketAccessForm) => {
    const input = {
      farmerId,
      seasonYear: intOrUndefined(form.seasonYear),
      buyerName: form.buyerName,
      pricePerTon: numOrUndefined(form.pricePerTon),
      priceContext: orUndefined(form.priceContext),
      isConfirmed: form.isConfirmed,
      harvestWindow: orUndefined(form.harvestWindow),
      notes: orUndefined(form.notes),
    };

    try {
      if (isEditing) {
        await updateAsync(input);
      } else {
        await createAsync(input);
      }
      router.back();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save this record.');
    }
  };

  const title = isEditing ? 'Edit Market Access' : 'Add Market Access';

  return (
    <AppSkeleton appBarTitle={title} isBusy={isPending} scrollable>
      <View style={{ height: h(24) }} />

      <AppDropdown
        title="Season Year"
        label="Select year"
        options={yearOptions}
        value={values.seasonYear.length > 0 ? values.seasonYear : null}
        error={errors.seasonYear?.message}
        onChange={(next) => setValue('seasonYear', next, { shouldValidate: true })}
        testID="market-access-season-year"
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="buyerName"
        render={({ field }) => (
          <AppTextField
            title="Buyer Name *"
            hintText="Enter buyer name"
            autoCapitalize="words"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.buyerName?.message}
            testID="market-access-buyer"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="pricePerTon"
        render={({ field }) => (
          <AppTextField
            title="Price per Ton (₦)"
            hintText="e.g. 68000"
            prefix={<NairaPrefix />}
            keyboardType="number-pad"
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.pricePerTon?.message}
            testID="market-access-price"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <AppDropdown
        title="Price Context"
        label="Select context"
        options={PRICE_CONTEXTS}
        value={values.priceContext.length > 0 ? values.priceContext : null}
        error={errors.priceContext?.message}
        onChange={(next) => setValue('priceContext', next, { shouldValidate: true })}
        testID="market-access-context"
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="isConfirmed"
        render={({ field }) => (
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Confirmed Buyer?</Text>
            <Switch
              accessibilityLabel="Confirmed Buyer?"
              value={field.value}
              onValueChange={field.onChange}
              trackColor={{ true: colors.primary, false: colors.secondary200 }}
              thumbColor={colors.white}
              testID="market-access-confirmed"
            />
          </View>
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="harvestWindow"
        render={({ field }) => (
          <AppTextField
            title="Harvest Window"
            hintText="e.g. Nov 2025"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.harvestWindow?.message}
            testID="market-access-harvest-window"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <AppTextField
            title="Notes"
            hintText="Any additional notes"
            maxLines={3}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.notes?.message}
            testID="market-access-notes"
          />
        )}
      />

      <View style={{ height: h(32) }} />

      <AppButton
        text={isEditing ? 'Update Record' : 'Save Record'}
        loading={isPending}
        onPress={handleSubmit(onSubmit)}
        testID="market-access-submit"
      />

      <View style={{ height: h(24) }} />
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
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
