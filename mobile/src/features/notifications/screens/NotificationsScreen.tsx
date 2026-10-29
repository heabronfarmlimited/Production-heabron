/**
 * Notifications — ported from
 * modules/notifications/presentation/view/notifications_view.dart
 *
 * Layout from Dart: 20 space, `AuthBackButton`, then a header row holding
 * 'Notifications' (24sp w700), the unread-count pill (primary, radius 20,
 * 10h/4v padding, 12sp w700 white) when the count is above zero, a spacer and
 * 'Clear All' (14sp w600 failure) when the list is non-empty. Below that,
 * 'Mark all as read' (14sp w600 primary) appears only while something is
 * unread. The list is split into 'Today' (card variant) and 'Earlier' (tile
 * variant), each section header 16sp w600 with 28 above and 16 below, and each
 * item separated by 12.
 *
 * Empty: 'No notifications yet.' at 14sp in `secondary400`.
 *
 * FIXED — the Dart list was a `SingleChildScrollView` inside a
 * `NotificationListener` that paged at the exact `maxScrollExtent`, which
 * never fires reliably on iOS rubber-banding. This is a FlashList with a
 * flattened section model, so paging triggers on approach and both sections
 * stay virtualised.
 */
import { FlashList } from '@shopify/flash-list';
import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin, w } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatRelativeTime } from '../../../core/utils/format';
import { NotificationCard } from '../components/NotificationCard';
import { NotificationTile } from '../components/NotificationTile';
import {
  useClearAll,
  useMarkAllRead,
  useMarkRead,
} from '../hooks/useNotificationMutations';
import { useNotifications } from '../hooks/useNotifications';
import type { NotificationItem } from '../model/notificationItem';

/** One flattened list entry — a section header or a notification. */
type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'card'; key: string; item: NotificationItem }
  | { kind: 'tile'; key: string; item: NotificationItem };

export function NotificationsScreen() {
  const {
    items,
    today,
    earlier,
    unreadCount,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    loadMore,
    refreshAll,
  } = useNotifications();

  const { markAsRead } = useMarkRead();
  const { markAllAsRead } = useMarkAllRead();
  const { clearAllNotifications, isPending: isClearing } = useClearAll();

  const [confirmingClear, setConfirmingClear] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];

    if (today.length > 0) {
      out.push({ kind: 'header', key: 'header-today', label: 'Today' });
      today.forEach((item, index) =>
        out.push({ kind: 'card', key: item.id || `today-${index}`, item }),
      );
    }

    if (earlier.length > 0) {
      out.push({ kind: 'header', key: 'header-earlier', label: 'Earlier' });
      earlier.forEach((item, index) =>
        out.push({ kind: 'tile', key: item.id || `earlier-${index}`, item }),
      );
    }

    return out;
  }, [today, earlier]);

  /**
   * NOTE — the Dart screen wiped every notification on a single tap of
   * 'Clear All'. `DELETE /agent/notifications` is irreversible, so it is
   * confirmed here first.
   */
  const onClearAll = () => {
    if (confirmingClear) return;
    setConfirmingClear(true);
    Alert.alert(
      'Clear All',
      'This removes every notification and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setConfirmingClear(false) },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            setConfirmingClear(false);
            clearAllNotifications();
          },
        },
      ],
      { onDismiss: () => setConfirmingClear(false) },
    );
  };

  return (
    <AppSkeleton
      isBusy={(isLoading && items.length === 0) || isClearing}
      bodyPadding={styles.bodyPadding}
    >
      <View style={{ height: h(20) }} />

      <View style={styles.gutter}>
        <View style={styles.backRow}>
          <AuthBackButton />
        </View>

        <View style={styles.headerRow}>
          <Text style={styles.heading}>Notifications</Text>

          {unreadCount > 0 ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{unreadCount}</Text>
            </View>
          ) : null}

          <View style={styles.spacer} />

          {items.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear all notifications"
              onPress={onClearAll}
              hitSlop={6}
            >
              <Text style={styles.clearAll}>Clear All</Text>
            </Pressable>
          ) : null}
        </View>

        {unreadCount > 0 ? (
          <>
            <View style={{ height: h(24) }} />
            <Pressable
              accessibilityRole="button"
              onPress={markAllAsRead}
              hitSlop={6}
              style={styles.markAllWrap}
            >
              <Text style={styles.markAll}>Mark all as read</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      <View style={styles.listWrap}>
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          estimatedItemSize={r(84)}
          getItemType={(row) => row.kind}
          contentContainerStyle={styles.listContent}
          renderItem={({ item: row }) => {
            if (row.kind === 'header') {
              return (
                <View>
                  {/* Dart put 28 above and 16 below both section headers. */}
                  <View style={{ height: h(28) }} />
                  <Text style={styles.sectionHeader}>{row.label}</Text>
                  <View style={{ height: h(16) }} />
                </View>
              );
            }

            if (row.kind === 'card') {
              return (
                <View style={styles.cardSpacing}>
                  <NotificationCard
                    title={row.item.title}
                    subtitle={row.item.message}
                    time={formatRelativeTime(row.item.createdAt)}
                    isRead={row.item.isRead}
                    onPress={() => markAsRead(row.item)}
                    bgColor={colors.secondary100}
                  />
                </View>
              );
            }

            return (
              <View style={styles.cardSpacing}>
                <NotificationTile
                  title={row.item.title}
                  subtitle={row.item.message}
                  time={formatRelativeTime(row.item.createdAt)}
                  isRead={row.item.isRead}
                  onPress={() => markAsRead(row.item)}
                />
              </View>
            );
          }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refreshAll}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            isLoading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No notifications yet.</Text>
              </View>
            )
          }
          ListFooterComponent={
            hasNextPage || isFetchingNextPage ? (
              <View style={styles.footer}>
                <AppLoading color={colors.primary} />
              </View>
            ) : (
              <View style={{ height: h(24) }} />
            )
          }
        />
      </View>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  bodyPadding: {
    paddingHorizontal: 0,
  },
  gutter: {
    paddingHorizontal: r(16),
  },
  backRow: {
    alignSelf: 'flex-start',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heading: {
    ...textTheme.headlineMedium,
    fontSize: spMin(24),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  pill: {
    marginLeft: r(8),
    paddingHorizontal: w(10),
    paddingVertical: h(4),
    borderRadius: r(20),
    backgroundColor: colors.primary,
  },
  pillText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
    color: colors.white,
  },
  spacer: {
    flex: 1,
  },
  clearAll: {
    ...textTheme.bodySmall,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.failure,
  },
  markAllWrap: {
    alignSelf: 'flex-start',
  },
  markAll: {
    ...textTheme.bodySmall,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
  },
  listWrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: r(16),
  },
  sectionHeader: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  cardSpacing: {
    marginBottom: r(12),
  },
  empty: {
    paddingTop: h(100),
    alignItems: 'center',
  },
  emptyText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.secondary400,
  },
  footer: {
    paddingVertical: r(16),
    alignItems: 'center',
  },
});
