/**
 * Dashboard (home tab) — ported from
 * modules/dashboard/presentation/view/dashnoard_view.dart, then rebuilt for
 * the v2 user flow.
 *
 * v2 changes:
 *
 *  - Six tiles instead of two summary cards. Three say what has been
 *    recorded (cooperatives, farmers, land); three say what needs doing
 *    (farmers with no farm area, records waiting to sync, records that
 *    failed). The second group is the point of the screen — the old
 *    dashboard could show a healthy pair of counts while three onboarded
 *    farmers sat unsynced and two had been rejected hours earlier.
 *  - Six quick actions instead of four, with "Log delivery" finally opening
 *    a delivery form. It used to open the Activities tab, which only LISTS
 *    deliveries; `POST /agent/deliveries` had no screen at all.
 *  - Recent Activity removed, as the flow specifies. It filled the screen
 *    below the fold with rows whose subtitle was the agent's own IP address,
 *    and the full log is still a tap away under the bell or Activity Logs.
 *  - Online / Offline moved into the header, so it is visible before an
 *    agent starts a form rather than after the save has been queued.
 *
 * FIXED (pre-v2, kept) — the Dart 'Add farmer' quick action called
 * `onTabSelected(1)`, which is the Cooperatives tab; farmers is index 2.
 */ import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppSkeleton } from '../../../components/AppSkeleton';
import { SkeletonTiles } from '../../../components/Skeleton';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import {
  useNetworkStatus,
  useOfflineFarmerQueue,
} from '../../farmers/hooks/useOfflineFarmerQueue';
import { ActionCard, StatTile } from '../components/DashboardCards';
import { DashboardHeader } from '../components/DashboardHeader';
import { useDashboard } from '../hooks/useDashboard';

export function DashboardScreen() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refresh } = useDashboard();
  const { pending, waiting, failed } = useOfflineFarmerQueue();
  const { isConnected } = useNetworkStatus();

  const land = data?.land ?? null;
  // Both gaps count as "needs a farm area": no farm record at all, and farm
  // records with no acreage. Either way the farmer cannot be scored.
  const needArea = land ? land.farmersWithoutArea + land.farmersWithoutFarms : 0;

  return (
    <AppSkeleton backgroundColor={colors.background}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} />}
        contentContainerStyle={styles.content}
      >
        <View style={{ height: h(22) }} />

        <DashboardHeader />

        <View style={{ height: h(28) }} />

        {/*
          ── What has been recorded, and what needs doing ───────────

          Only the TILES wait: the greeting comes from the auth store and
          the quick actions work before any request has returned, so
          blocking the whole screen (which `isBusy` did) hid a usable header
          and six working buttons behind a spinner.
        */}
        {isLoading && !data ? (
          <SkeletonTiles rows={2} perRow={3} />
        ) : (
          <>
            <View style={styles.tileRow}>
              <StatTile
                label="Cooperatives"
                value={String(data?.cooperatives ?? 0)}
                onPress={() => router.push(routes.cooperativesTab)}
                testID="tile-cooperatives"
              />
              <View style={{ width: r(10) }} />
              <StatTile
                label="Farmers"
                value={String(data?.farmers ?? 0)}
                onPress={() => router.push(routes.farmersTab)}
                testID="tile-farmers"
              />
              <View style={{ width: r(10) }} />
              <StatTile
                label="Acres recorded"
                value={land ? String(land.totalLandAcres) : '—'}
                caption={
                  land && land.farmCount > 0
                    ? `${land.farmCount} farm${land.farmCount === 1 ? '' : 's'}`
                    : undefined
                }
                testID="tile-land"
              />
            </View>

            <View style={{ height: h(10) }} />

            <View style={styles.tileRow}>
              {/*
            A farmer with a farm record but no acreage cannot be
            credit-scored — land is the denominator of the production score.
            It is work outstanding, not a statistic, so it is a tile rather
            than a number buried on a report.
          */}
              <StatTile
                label="Need farm area"
                value={
                  land ? String(land.farmersWithoutArea + land.farmersWithoutFarms) : '—'
                }
                caption={needArea > 0 ? 'Cannot be scored' : undefined}
                tone={needArea > 0 ? 'attention' : 'neutral'}
                onPress={() => router.push(routes.farmersTab)}
                testID="tile-need-area"
              />
              <View style={{ width: r(10) }} />
              <StatTile
                label="Waiting to sync"
                value={String(waiting.length)}
                caption={
                  waiting.length > 0 ? (isConnected ? 'Syncing' : 'Offline') : undefined
                }
                tone={waiting.length > 0 ? 'attention' : 'neutral'}
                onPress={() => router.push(routes.syncQueue)}
                testID="tile-waiting"
              />
              <View style={{ width: r(10) }} />
              <StatTile
                label="Failed to sync"
                value={String(failed.length)}
                caption={failed.length > 0 ? 'Tap to retry' : undefined}
                tone={failed.length > 0 ? 'problem' : 'neutral'}
                onPress={() => router.push(routes.syncQueue)}
                testID="tile-failed"
              />
            </View>
          </>
        )}

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
            {/*
              Both of these need a farmer chosen first, so they open the
              farmers list rather than a form with an empty subject. The
              Update Record hub then sits on the farmer.
            */}
            <ActionCard
              icon={<Text style={styles.actionGlyph}>🌾</Text>}
              title="Update record"
              onPress={() => router.push(routes.farmersTab)}
            />
            <View style={{ width: r(10) }} />
            <ActionCard
              icon={<Text style={styles.actionGlyph}>🚚</Text>}
              title="Log delivery"
              onPress={() => router.push(routes.farmersTab)}
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
              icon={<Text style={styles.actionGlyph}>🔄</Text>}
              title={pending.length > 0 ? `Sync (${pending.length})` : 'Sync records'}
              onPress={() => router.push(routes.syncQueue)}
            />
          </View>
        </View>

        <View style={{ height: h(24) }} />
      </ScrollView>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: r(24),
  },
  tileRow: {
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
});
