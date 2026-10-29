/**
 * `CropTypeSelector` — ported from
 * .../view/widgets/crop_type_selector.dart
 *
 * Dart layout: label `'Crop type'` (14sp w600), 12 space, a Wrap of the
 * selected crops as deletable chips (primary@0.15 fill, primary 12sp w600
 * text, a 16r close icon), 12 space, then a Wrap of the remaining crops as
 * white `InputChip`s with a grey@0.3 border and grey 12sp w600 text.
 *
 * Three fixes:
 *
 *  1. The Dart widget seeded `selected` from `widget.selectedCrops` in
 *     `initState` only and then owned the list itself, so a later prop change
 *     was ignored — on the edit form the chips rendered before the cooperative
 *     loaded and never caught up. This is a controlled component: the form
 *     owns the value.
 *  2. `EditCooperativeView` wrapped it in `if (controller.selectedCrops.isNotEmpty)`,
 *     so a cooperative saved with zero crops could never have its first crop
 *     added. It always renders.
 *  3. The 18 crop labels were hardcoded in the widget *and* in the farmer
 *     forms. They come from `CROPS` in domainConstants now, which also means
 *     the stored value is the canonical lowercase one rather than the display
 *     label (`'Palm Oil'` was being written to `crops_supported`).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CROPS, labelFor } from '../../../core/api/domainConstants';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface CropTypeSelectorProps {
  /** API values, e.g. `['maize', 'palm_oil']`. */
  value: readonly string[];
  onChange: (crops: string[]) => void;
  /** Dart label. */
  title?: string;
  error?: string;
  enabled?: boolean;
}

export function CropTypeSelector({
  value,
  onChange,
  title = 'Crop type',
  error,
  enabled = true,
}: CropTypeSelectorProps) {
  const selected = value;
  const available = CROPS.filter((crop) => !selected.includes(crop.value));

  const toggle = (crop: string) => {
    if (!enabled) return;
    onChange(
      selected.includes(crop)
        ? selected.filter((c) => c !== crop)
        : [...selected, crop],
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <View style={{ height: h(12) }} />

      {selected.length > 0 ? (
        <View style={styles.wrap}>
          {selected.map((crop) => (
            <Pressable
              key={crop}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${labelFor(CROPS, crop)}`}
              onPress={() => toggle(crop)}
              style={[styles.chip, styles.chipSelected]}
            >
              <Text style={[styles.chipText, styles.chipTextSelected]}>
                {labelFor(CROPS, crop)}
              </Text>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {selected.length > 0 ? <View style={{ height: h(12) }} /> : null}

      <View style={styles.wrap}>
        {available.map((crop) => (
          <Pressable
            key={crop.value}
            accessibilityRole="button"
            accessibilityLabel={`Add ${crop.label}`}
            accessibilityState={{ disabled: !enabled }}
            disabled={!enabled}
            onPress={() => toggle(crop.value)}
            style={[styles.chip, styles.chipAvailable]}
          >
            <Text style={styles.chipText}>{crop.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.secondaryBlack600,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Dart: Wrap(spacing: 8, runSpacing: 8)
    gap: r(8),
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: r(100),
    paddingHorizontal: r(12),
    paddingVertical: r(7),
    borderWidth: 1,
  },
  chipSelected: {
    // Dart: AppColors.primary.withValues(alpha: 0.15), side: BorderSide.none
    backgroundColor: 'rgba(46, 139, 87, 0.15)',
    borderColor: 'transparent',
  },
  chipAvailable: {
    backgroundColor: colors.white,
    // Dart: AppColors.grey.withValues(alpha: 0.3)
    borderColor: 'rgba(107, 114, 128, 0.3)',
  },
  chipText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.grey,
  },
  chipTextSelected: {
    color: colors.primary,
  },
  close: {
    fontSize: spMin(11),
    color: colors.primary,
    marginLeft: r(6),
  },
  error: {
    ...textTheme.bodySmall,
    color: colors.failure,
    fontSize: spMin(12),
    marginTop: r(4),
  },
});
