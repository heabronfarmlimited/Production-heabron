/**
 * Activity-log row — ports `DashboardActivityItem`, the widget
 * `RecentActivityLogsView` rendered for each entry.
 *
 * Dart: a 10r vertical-padding row holding a 36r `secondary100` circle, 12
 * gap, the title at 12sp w400 `secondaryBlack600`, 4 space, the subtitle at
 * 10sp grey, a trailing time at 10sp grey, then a 1px `grey @ 20%` divider
 * below.
 *
 * NOTE — the leading circle is **empty** in the original: the widget declares
 * a `Container` with a colour and no child. The audit lists it as a genuine
 * stub. It is reproduced as-is rather than filled with an icon chosen from the
 * `action` string, which would be inventing meaning the data does not carry.
 * Flagged in the build report.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { textTheme } from '../../../core/theme/typography';
import { withAlpha } from '../utils/color';

export interface ActivityLogItemProps {
  title: string;
  subtitle: string;
  time: string;
}

export function ActivityLogItem({ title, subtitle, time }: ActivityLogItemProps) {
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.avatar} />

        <View style={styles.texts}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.gap4} />
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <Text style={styles.time}>{time}</Text>
      </View>

      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: r(10),
  },
  avatar: {
    width: r(36),
    height: r(36),
    borderRadius: r(36),
    backgroundColor: colors.secondary100,
  },
  texts: {
    flex: 1,
    marginLeft: r(12),
  },
  gap4: {
    height: r(4),
  },
  title: {
    ...textTheme.bodyLarge,
    fontSize: spMin(12),
    color: colors.secondaryBlack600,
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    color: colors.grey,
  },
  time: {
    ...textTheme.bodySmall,
    marginLeft: r(8),
    fontSize: spMin(10),
    color: colors.grey,
  },
  divider: {
    height: 1,
    backgroundColor: withAlpha(colors.grey, 0.2),
  },
});
