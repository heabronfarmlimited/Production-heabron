/**
 * `CropTypeSelector` — ported from
 * modules/cooperatives/presentation/view/widgets/crop_type_selector.dart
 *
 * Selected crops render as removable chips; the remaining crops render as
 * tappable outline chips. Label `'Crop type'`, as in Dart.
 *
 * Three fixes:
 *  1. The Dart widget seeded its state from `widget.selectedCrops` in
 *     `initState` only, so a later prop change (an edit form prefilling after
 *     an async fetch) was ignored and the chips stayed empty. This component is
 *     controlled — there is no internal copy to go stale.
 *  2. It had no cap. `validators/domain.js` is
 *     `secondaryCrops: array().items(string).max(7)`, so an eighth crop was a
 *     422. The cap is enforced here and the counter shows it.
 *  3. The values sent are `domainConstants.CROPS[].value` (lowercase
 *     snake_case), never the display label.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  CROPS,
  labelFor,
  MAX_SECONDARY_CROPS,
  type Option,
} from '../../../core/api/domainConstants';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface CropTypeSelectorProps {
  /** API values, not labels. */
  value: string[];
  onChange: (crops: string[]) => void;
  /** Dart label. */
  title?: string;
  /** Defaults to `MAX_SECONDARY_CROPS` (7). */
  max?: number;
  /** Crops to leave out — e.g. the already-chosen primary crop. */
  exclude?: readonly string[];
  options?: readonly Option[];
  error?: string;
  enabled?: boolean;
}

export function CropTypeSelector({
  value,
  onChange,
  title = 'Crop type',
  max = MAX_SECONDARY_CROPS,
  exclude = [],
  options = CROPS,
  error,
  enabled = true,
}: CropTypeSelectorProps) {
  const available = useMemo(
    () =>
      options.filter(
        (option) => !value.includes(option.value) && !exclude.includes(option.value),
      ),
    [options, value, exclude],
  );

  const atCap = value.length >= max;

  const toggle = (crop: string) => {
    if (value.includes(crop)) {
      onChange(value.filter((c) => c !== crop));
      return;
    }
    if (value.length >= max) return;
    onChange([...value, crop]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.counter, atCap && styles.counterAtCap]}>
          {value.length}/{max}
        </Text>
      </View>

      <View style={{ height: h(12) }} />

      {value.length > 0 ? (
        <View style={styles.wrap}>
          {value.map((crop) => (
            <Pressable
              key={crop}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${labelFor(options, crop)}`}
              disabled={!enabled}
              onPress={() => toggle(crop)}
              style={styles.selectedChip}
            >
              <Text style={styles.selectedChipText}>{labelFor(options, crop)}</Text>
              <Text accessible={false} style={styles.remove}>
                {' ✕'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {value.length > 0 ? <View style={{ height: h(12) }} /> : null}

      <View style={styles.wrap}>
        {available.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={`Add ${option.label}`}
            accessibilityState={{ disabled: !enabled || atCap }}
            disabled={!enabled || atCap}
            onPress={() => toggle(option.value)}
            style={[styles.availableChip, atCap && styles.availableChipDisabled]}
          >
            <Text style={styles.availableChipText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : atCap ? (
        <Text style={styles.hint}>
          {`You can select at most ${max} crops.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.secondaryBlack600,
  },
  counter: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  counterAtCap: {
    color: colors.orange700,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: r(8),
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: r(12),
    paddingVertical: r(8),
    borderRadius: r(100),
    // AppColors.primary @ 15%
    backgroundColor: 'rgba(46, 139, 87, 0.15)',
  },
  selectedChipText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
  },
  remove: {
    fontSize: spMin(12),
    color: colors.primary,
  },
  availableChip: {
    paddingHorizontal: r(12),
    paddingVertical: r(8),
    borderRadius: r(100),
    backgroundColor: colors.white,
    borderWidth: 1,
    // AppColors.grey @ 30%
    borderColor: 'rgba(107, 114, 128, 0.3)',
  },
  availableChipDisabled: {
    opacity: 0.4,
  },
  availableChipText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.grey,
  },
  error: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.failure,
    marginTop: r(8),
  },
  hint: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
    marginTop: r(8),
  },
});
