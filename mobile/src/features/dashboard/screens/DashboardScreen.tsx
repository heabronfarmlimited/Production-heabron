/**
 * Dashboard (home tab) — ported from
 * modules/dashboard/presentation/view/dashnoard_view.dart
 *
 * Dart order: 22 space, header, 39 space, two summary cards side by side,
 * 24 space, 'Quick Actions' (12sp), 16 space, the 2x2 action grid, 28 space,
 * 'Recent Activity' (14sp) + 'View All' (10sp primary), 16 space, then up to
 * 10 activity rows or 'No recent activity'.
 *
 * FIXED — the Dart 'Add farmer' quick action called `onTabSelected(1)`, which
 * is the **Cooperatives** tab (farmers is index 2). It now opens the add-farmer
 * flow directly.
 *
 * NOTE — 'Log delivery' was `isDisabled: true` with no handler in Dart even
 * though `POST /agent/deliveries` exists. It is wired up here.
 */
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppSkeleton } from '../../../components/AppSkeleton';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatDateAndTime, titleCase } from '../../../core/utils/format';
import { ActionCard, ActivityItem, SummaryCard } from '../components/DashboardCards';
import { DashboardHeader } from '../components/DashboardHeader';
import { useDashboard } from '../hooks/useDashboard';

export function DashboardScreen() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refresh } = useDashboard();

  const activity = (data?.recentActivity ?? []).slice(0, 10);

  return (
    <AppSkeleton isBusy={isLoading} backgroundColor={colors.background}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refresh} />
        }
        contentContainerStyle={styles.content}
      >
        <View style={{ height: h(22) }} />

        <DashboardHeader />

        <View style={{ height: h(39) }} />

        <View style={styles.summaryRow}>
          <SummaryCard
            title="Cooperatives registered"
            count={String(data?.cooperatives ?? 0)}
          />
          <View style={{ width: r(16) }} />
          <SummaryCard
            title="Farmers registered"
            count={String(data?.farmers ?? 0)}
          />
        </View>

        <View style={{ height: h(24) }} />

        <Text style={styles.quickActionsLabel}>Quick Actions</Text>

        <View style={{ height: h(16) }} />

        <View style={styles.actionsGrid}>
          <View style={styles.actionsRow}>
            <ActionCard
              icon={<Text style={styles.actionGlyph}>🏢</Text>}
              title="Add cooperative"
              onPress={() => router.push(routes.cooperativeCreate)}
            />
            <View style={{ width: r(10) }} />
            <ActionCard
              icon={<Text style={styles.actionGlyph}>🧑‍🌾</Text>}
              title="Add farmer"
              onPress={() => router.push(routes.farmerAdd)}
            />
          </View>

          <View style={{ height: h(16) }} />

          <View style={styles.actionsRow}>
            <ActionCard
              icon={<Text style={styles.actionGlyph}>📤</Text>}
              title="Upload CSV"
              onPress={() => router.push(routes.farmerBulkUpload)}
            />
            <View style={{ width: r(10) }} />
            <ActionCard
              icon={<Text style={styles.actionGlyph}>🚚</Text>}
              title="Log delivery"
              onPress={() => router.push(routes.activitiesTab)}
            />
          </View>
        </View>

        <View style={{ height: h(28) }} />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <Text
            style={styles.viewAll}
            accessibilityRole="link"
            onPress={() => router.push(routes.activityLogs)}
          >
            View All
          </Text>
        </View>

        <View style={{ height: h(16) }} />

        {activity.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No recent activity</Text>
          </View>
        ) : (
          activity.map((item, index) => (
            <ActivityItem
              key={item.id || `${item.action}-${index}`}
              title={titleCase(item.action)}
              subtitle={item.ipAddress ?? 'N/A'}
              time={formatDateAndTime(item.createdAt)}
              isLast={index === activity.length - 1}
            />
          ))
        )}

        <View style={{ height: h(24) }} />
      </ScrollView>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: r(24),
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  quickActionsLabel: {
    ...textTheme.titleMedium,
    fontSize: spMin(12),
    fontFamily: fontWeights.regular,
    fontWeight: '400',
  },
  actionsGrid: {
    alignSelf: 'stretch',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  actionGlyph: {
    fontSize: spMin(20),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...textTheme.titleMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.regular,
    fontWeight: '400',
  },
  viewAll: {
    ...textTheme.bodyMedium,
    fontSize: spMin(10),
    color: colors.primary,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: r(32),
  },
  emptyText: {
    ...textTheme.bodyMedium,
    color: colors.grey,
  },
});
