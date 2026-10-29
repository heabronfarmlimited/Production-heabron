/**
 * Notification tile — ported from
 * modules/notifications/presentation/view/widget/notification_tile.dart
 *
 * Used for the **Earlier** group. Dart: 10v/20h padding, no radius (the
 * `borderRadius` line is commented out in the original), transparent when read
 * and `Color.fromRGBO(242, 255, 246, 1)` when unread. A 42r rounded square
 * tinted `iconColor @ 12%` holds the bell. The title is 12sp, w400 when read
 * and w500 when unread; the subtitle and the trailing time are both 10sp grey.
 *
 * No unread dot on this variant — that is the card's.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin, w } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { withAlpha } from '../utils/color';

import { BellIcon } from './NotificationIcons';

/** Dart: `Color.fromRGBO(242, 255, 246, 1)` — the unread tile wash. */
const UNREAD_BG = '#F2FFF6';

export interface NotificationTileProps {
  title: string;
  subtitle: string;
  time: string;
  isRead?: boolean;
  onPress?: () => void;
  iconColor?: string;
}

export function NotificationTile({
  title,
  subtitle,
  time,
  isRead = true,
  onPress,
  iconColor = colors.primary,
}: NotificationTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ selected: !isRead }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: isRead ? colors.transparent : UNREAD_BG },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: withAlpha(iconColor, 0.12) }]}>
        <BellIcon color={iconColor} size={20} />
      </View>

      <View style={styles.texts}>
        <Text style={[styles.title, isRead ? styles.titleRead : styles.titleUnread]}>
          {title}
        </Text>
        <View style={styles.gap6} />
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <Text style={styles.time}>{time}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: r(10),
    paddingHorizontal: w(20),
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
  gap6: {
    height: r(6),
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(12),
  },
  titleRead: {
    fontFamily: fontWeights.regular,
    fontWeight: '400',
  },
  titleUnread: {
    fontFamily: fontWeights.medium,
    fontWeight: '500',
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
});
