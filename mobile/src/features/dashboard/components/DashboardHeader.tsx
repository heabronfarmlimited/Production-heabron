/**
 * Dashboard greeting row — ported from
 * modules/dashboard/presentation/view/widgets/dashboard_header.dart
 *
 * Dart: 'Hello, {fullName.split(" ")[0]}' (20sp w600), subtitle
 * 'Here’s your overview' (12sp grey), and two icon buttons on the right —
 * a notifications bell with a `Badge`, and a person icon to the profile.
 *
 * FIXED — two things:
 *  1. The Dart header did `user.fullName.split(" ")[0]` on a possibly-null
 *     user, which throws on an empty name. Guarded here.
 *  2. The `Badge` was rendered with no `label`, so the unread count never
 *     showed. It now reads the real count from the notifications module.
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { useUser } from '../../auth/model/authStore';
import { useUnreadCount } from '../../notifications/hooks/useUnreadCount';

export function DashboardHeader() {
  const router = useRouter();
  const user = useUser();
  const { count: unread } = useUnreadCount();

  // Guarded: an empty or missing name must not throw.
  const firstName = (user?.fullName ?? '').trim().split(/\s+/)[0] ?? '';

  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.greeting} numberOfLines={1}>
          {firstName ? `Hello, ${firstName}` : 'Hello'}
        </Text>
        <Text style={styles.subtitle}>Here’s your overview</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
          }
          onPress={() => router.push(routes.notifications)}
          hitSlop={8}
          style={styles.iconButton}
        >
          <Text style={styles.glyph}>🔔</Text>
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unread > 99 ? '99+' : String(unread)}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profile"
          onPress={() => router.push(routes.profile)}
          hitSlop={8}
          style={styles.iconButton}
        >
          <Text style={styles.glyph}>👤</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  text: {
    flex: 1,
  },
  greeting: {
    ...textTheme.titleMedium,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(4),
  },
  iconButton: {
    width: r(40),
    height: r(40),
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: spMin(20),
  },
  badge: {
    position: 'absolute',
    top: r(4),
    right: r(2),
    minWidth: r(16),
    height: r(16),
    borderRadius: r(16),
    backgroundColor: colors.failure,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: r(3),
  },
  badgeText: {
    color: colors.white,
    fontSize: spMin(9),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
});
