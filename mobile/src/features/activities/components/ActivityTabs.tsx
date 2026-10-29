/**
 * Tab bar — ports the Flutter `TabBar` in activities_view.dart.
 *
 * Dart: `padding: EdgeInsets.zero`, `dividerColor: Colors.grey.shade200`,
 * `indicatorColor: AppColors.primary`, `indicatorSize: TabBarIndicatorSize.tab`
 * (so the indicator spans the whole tab, not just the label),
 * `labelColor: AppColors.primary`, `unselectedLabelColor: AppColors.grey`, and
 * each label at 12sp w400.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { textTheme } from '../../../core/theme/typography';

/** Dart `Colors.grey.shade200` — the divider under the tab row. */
const DIVIDER = '#EEEEEE';

export interface ActivityTabsProps<T extends string> {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
}

export function ActivityTabs<T extends string>({
  tabs,
  value,
  onChange,
}: ActivityTabsProps<T>) {
  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab)}
            style={styles.tab}
          >
            <Text style={[styles.label, selected ? styles.labelActive : null]}>
              {tab}
            </Text>
            <View
              style={[styles.indicator, selected ? styles.indicatorActive : null]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    ...textTheme.bodyMedium,
    fontSize: spMin(12),
    color: colors.grey,
    paddingVertical: h(12),
  },
  indicator: {
    height: r(2),
    alignSelf: 'stretch',
    backgroundColor: colors.transparent,
  },
  indicatorActive: {
    backgroundColor: colors.primary,
  },
  labelActive: {
    color: colors.primary,
  },
});
