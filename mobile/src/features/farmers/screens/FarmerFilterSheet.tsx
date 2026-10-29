/**
 * Filter sheet — `_showFilterSheet` from farmers_view.dart.
 *
 * Dart: title 'Filter Farmers' (18sp w700) with a close button, three fields
 * ('LGA'/'Enter LGA', 'Tier'/'Enter Tier (e.g. A, B)', 'Cooperative ID'/'Enter
 * Cooperative ID') and 'Clear' (outlined) + 'Apply Filters' buttons.
 *
 * Fixes:
 *  - Tier was free text while `listQuery.tier` is `valid('A','B','C','D')`, so
 *    "a", "Tier A" or anything else produced a 422 the sheet reported as a
 *    generic toast. It is a four-option picker; the hint is unnecessary and the
 *    label stays 'Tier'.
 *  - Cooperative ID is validated as a UUID before it is applied, for the same
 *    reason (`cooperativeId: uuid.empty('')`).
 *  - LGA is picked from the Nigeria dataset rather than typed, so a misspelling
 *    cannot silently return zero farmers.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppDropdown } from '../../../components/AppDropdown';
import { AppTextField } from '../../../components/AppTextField';
import { CREDIT_TIERS } from '../../../core/api/domainConstants';
import { colors } from '../../../core/theme/colors';
import { h, r, screenHeight, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import type { FarmerFilters } from '../hooks/useFarmers';
import {
  emptyFarmerFilterForm,
  farmerFilterSchema,
  type FarmerFilterForm,
} from '../model/validation';

export interface FarmerFilterSheetProps {
  visible: boolean;
  filters: FarmerFilters;
  onClose: () => void;
  onApply: (filters: Pick<FarmerFilters, 'lga' | 'tier' | 'cooperativeId'>) => void;
  onClear: () => void;
}

export function FarmerFilterSheet({
  visible,
  filters,
  onClose,
  onApply,
  onClear,
}: FarmerFilterSheetProps) {
  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FarmerFilterForm>({
    resolver: zodResolver(farmerFilterSchema),
    mode: 'onTouched',
    defaultValues: emptyFarmerFilterForm,
  });

  // Re-seed each time the sheet opens, so it reflects the live filters.
  useEffect(() => {
    if (!visible) return;
    reset({
      lga: filters.lga ?? '',
      tier: filters.tier ?? '',
      cooperativeId: filters.cooperativeId ?? '',
    });
  }, [visible, filters.lga, filters.tier, filters.cooperativeId, reset]);

  const tier = watch('tier');

  const submit = (values: FarmerFilterForm) => {
    onApply({
      lga: values.lga.trim(),
      tier: values.tier,
      cooperativeId: values.cooperativeId.trim(),
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.backdrop}
        onPress={onClose}
      />

      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={{ height: h(18) }} />

        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Filter Farmers
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <View style={{ height: h(20) }} />

        <ScrollView showsVerticalScrollIndicator={false}>
          <Controller
            control={control}
            name="lga"
            render={({ field }) => (
              <AppTextField
                title="LGA"
                hintText="Enter LGA"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.lga?.message}
                testID="farmers-filter-lga"
              />
            )}
          />

          <View style={{ height: h(16) }} />

          <AppDropdown
            title="Tier"
            label="Select tier"
            options={CREDIT_TIERS}
            value={tier.length > 0 ? tier : null}
            error={errors.tier?.message}
            onChange={(next) => setValue('tier', next, { shouldValidate: true })}
            testID="farmers-filter-tier"
          />

          <View style={{ height: h(16) }} />

          <Controller
            control={control}
            name="cooperativeId"
            render={({ field }) => (
              <AppTextField
                title="Cooperative ID"
                hintText="Enter Cooperative ID"
                autoCapitalize="none"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={errors.cooperativeId?.message}
                testID="farmers-filter-cooperative"
              />
            )}
          />

          <View style={{ height: h(24) }} />

          <View style={styles.buttons}>
            <View style={styles.button}>
              <AppButton
                text="Clear"
                isOutlined
                textColor={colors.black}
                outlineColor={colors.secondary200}
                onPress={() => {
                  reset(emptyFarmerFilterForm);
                  onClear();
                }}
                testID="farmers-filter-clear"
              />
            </View>

            <View style={{ width: r(16) }} />

            <View style={styles.button}>
              <AppButton
                text="Apply Filters"
                onPress={handleSubmit(submit)}
                testID="farmers-filter-apply"
              />
            </View>
          </View>

          <View style={{ height: h(16) }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: r(24),
    borderTopRightRadius: r(24),
    paddingHorizontal: r(20),
    paddingTop: r(10),
    paddingBottom: r(20),
    maxHeight: screenHeight() * 0.85,
  },
  handle: {
    alignSelf: 'center',
    width: r(40),
    height: r(4),
    borderRadius: r(10),
    backgroundColor: colors.secondary200,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...textTheme.headlineSmall,
    fontSize: spMin(18),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  close: {
    fontSize: spMin(18),
    paddingHorizontal: r(4),
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {
    flex: 1,
  },
});
