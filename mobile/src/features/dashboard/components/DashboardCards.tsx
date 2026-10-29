/**
 * Dashboard widgets — ported from
 * modules/dashboard/presentation/view/widgets/
 *   dashboard_summary_card.dart, dashboard_action_card.dart,
 *   dashboard_activity_item.dart, dashboard_header.dart
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

/**
 * `DashboardSummaryCard` — solid primary card, radius 8, minHeight 109h,
 * white 12sp title over a white 24sp w600 count.
 */
export function SummaryCard({ title, count }: { title: string; count: string }) {
  return (
    <View style={styles.summary}>
      <Text style={styles.summaryTitle}>{title}</Text>
      <Text style={styles.summaryCount}>{count}</Text>
    </View>
  );
}

/**
 * `DashboardActionCard` — tinted `primary @8 %`, radius 8, border
 * `primary @35 %`, with a 34r icon chip. `isDisabled` greys it out.
 */
export function ActionCard({
  icon,
  title,
  onPress,
  isDisabled = false,
}: {
  icon: ReactNode;
  title: string;
  onPress?: () => void;
  isDisabled?: boolean;
}) {
  const disabled = isDisabled || !onPress;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.actionDisabled,
        pressed && !disabled && styles.actionPressed,
      ]}
    >
      <View style={[styles.actionChip, disabled && styles.actionChipDisabled]}>
        {icon}
      </View>
      <Text style={[styles.actionTitle, disabled && styles.actionTitleDisabled]}>
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * `DashboardActivityItem` — 36r leading circle, 12sp title, 10sp subtitle,
 * 10sp right-aligned time, trailing divider.
 *
 * NOTE — the Dart leading circle was empty (a `secondary100` disc with no
 * icon or initial). An initial derived from the action is rendered instead, so
 * the row reads as deliberate rather than unfinished.
 */
export function ActivityItem({
  title,
  subtitle,
  time,
  isLast = false,
}: {
  title: string;
  subtitle: string;
  time: string;
  isLast?: boolean;
}) {
  const initial = title.trim().charAt(0).toUpperCase() || '•';

  return (
    <View>
      <View style={styles.activityRow}>
        <View style={styles.activityAvatar}>
          <Text style={styles.activityInitial}>{initial}</Text>
        </View>

        <View style={styles.activityText}>
          <Text style={styles.activityTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.activitySubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>

        <Text style={styles.activityTime} numberOfLines={2}>
          {time}
        </Text>
      </View>

      {!isLast ? <View style={styles.divider} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    flex: 1,
    minHeight: h(109),
    borderRadius: r(8),
    backgroundColor: colors.primary,
    padding: r(12),
    justifyContent: 'space-between',
  },
  summaryTitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.white,
  },
  summaryCount: {
    ...textTheme.headlineSmall,
    fontSize: spMin(24),
    color: colors.white,
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  action: {
    flex: 1,
    borderRadius: r(8),
    borderWidth: 1,
    // Dart: primary @ 0.35 border over primary @ 0.08 fill
    borderColor: 'rgba(46, 139, 87, 0.35)',
    backgroundColor: 'rgba(46, 139, 87, 0.08)',
    padding: r(12),
    gap: r(10),
  },
  actionDisabled: {
    borderColor: colors.secondary200,
    backgroundColor: colors.secondary100,
  },
  actionPressed: {
    opacity: 0.75,
  },
  actionChip: {
    width: r(34),
    height: r(34),
    borderRadius: r(34),
    backgroundColor: 'rgba(46, 139, 87, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionChipDisabled: {
    backgroundColor: colors.secondary200,
  },
  actionTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  actionTitleDisabled: {
    color: colors.grey,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: r(10),
    gap: r(12),
  },
  activityAvatar: {
    width: r(36),
    height: r(36),
    borderRadius: r(36),
    backgroundColor: colors.secondary100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityInitial: {
    ...textTheme.bodySmall,
    fontSize: spMin(13),
    color: colors.greyDeep,
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  activityText: {
    flex: 1,
  },
  activityTitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  activitySubtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    color: colors.grey,
  },
  activityTime: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    color: colors.grey,
    textAlign: 'right',
    maxWidth: r(96),
  },
  divider: {
    height: 1,
    // Dart: Divider(color: grey @ 0.2)
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
  },
});
