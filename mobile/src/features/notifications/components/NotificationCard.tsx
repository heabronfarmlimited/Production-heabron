/**
 * Notification card — ported from
 * modules/notifications/presentation/view/widget/notification_card.dart
 *
 * Used for the **Today** group. Dart: 16r padding, radius 16, background
 * `bgColor` when read and `primary @ 8%` when unread (the screen passes
 * `secondary100` as `bgColor`). A 42r rounded square (radius 12) holds the
 * bell. The title is 14sp, w600 when read and w700 when unread, followed by an
 * 8r primary dot while unread. The subtitle is 12sp grey and the time sits in
 * the trailing column at 12sp grey.
 *
 * `showAction` renders a 32r red close box; no caller sets it, so it defaults
 * off and is kept for parity.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { withAlpha } from '../utils/color';

import { BellIcon, CloseIcon } from './NotificationIcons';

export interface NotificationCardProps {
  title: string;
  subtitle: string;
  time: string;
  isRead?: boolean;
  onPress?: () => void;
  showAction?: boolean;
  bgColor?: string;
  iconBgColor?: string;
  iconColor?: string;
}

export function NotificationCard({
  title,
  subtitle,
  time,
  // Dart default is `true` — an unspecified notification renders as read.
  isRead = true,
  onPress,
  showAction = false,
  bgColor = colors.white,
  iconBgColor = colors.secondary100,
  iconColor = colors.primary,
}: NotificationCardProps) {
  const backgroundColor = isRead ? bgColor : withAlpha(colors.primary, 0.08);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ selected: !isRead }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: iconBgColor }]}>
        <BellIcon color={iconColor} size={20} />
      </View>

      <View style={styles.texts}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, isRead ? styles.titleRead : styles.titleUnread]}>
            {title}
          </Text>
          {!isRead ? <View style={styles.dot} /> : null}
        </View>

        <View style={styles.gap6} />

        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <View style={styles.trailing}>
        <Text style={styles.time}>{time}</Text>
        {showAction ? (
          <>
            <View style={styles.gap12} />
            <View style={styles.actionBox}>
              <CloseIcon color={colors.white} size={18} />
            </View>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: r(16),
    borderRadius: r(16),
  },
  pressed: {
    opacity: 0.8,
  },
  iconBox: {
    width: r(42),
    height: r(42),
    borderRadius: r(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    marginLeft: r(12),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    ...textTheme.bodyMedium,
    flex: 1,
    fontSize: spMin(14),
  },
  titleRead: {
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  titleUnread: {
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  dot: {
    width: r(8),
    height: r(8),
    borderRadius: r(8),
    marginLeft: r(8),
    backgroundColor: colors.primary,
  },
  gap6: {
    height: r(6),
  },
  gap12: {
    height: r(12),
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  trailing: {
    alignItems: 'flex-end',
    marginLeft: r(8),
  },
  time: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  actionBox: {
    width: r(32),
    height: r(32),
    borderRadius: r(10),
    backgroundColor: colors.failure,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
