/**
 * The offline queue — what is waiting to sync, and what failed (v2 home
 * "pending / failed sync tiles that open retry").
 *
 * Before this, a queued farmer was visible only as a count on a banner over
 * the farmers list, and a record that kept FAILING looked exactly like one
 * merely waiting for a signal: the error went to a toast and was gone. An
 * agent could finish a day's onboarding believing eight farmers were
 * uploaded when three had been rejected hours earlier.
 *
 * So failures are now recorded against the entry (see `PendingFarmer`), shown
 * here with the reason, and retried individually — retrying the whole queue
 * to clear one bad record re-attempts everything else for no reason.
 */
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatDateAndTime } from '../../../core/utils/format';
import { EmptyState } from '../components/EmptyState';
import { InfoCard } from '../components/InfoCard';
import { useNetworkStatus, useOfflineFarmerQueue } from '../hooks/useOfflineFarmerQueue';
import { pendingFarmerName, type PendingFarmer } from '../model/pendingFarmer';

export function SyncQueueScreen() {
  const { pending, waiting, failed, isSyncing, syncAll, reload, discard } =
    useOfflineFarmerQueue();
  const { isConnected } = useNetworkStatus();

  const [pendingDiscard, setPendingDiscard] = useState<PendingFarmer | null>(null);

  const confirmDiscard = () => {
    const entry = pendingDiscard;
    if (!entry) return;
    setPendingDiscard(null);
    discard(entry.id);
  };

  return (
    <AppSkeleton
      appBarTitle="Sync Queue"
      appBarLeading={<AuthBackButton />}
      bottomBar={
        pending.length > 0 ? (
          <View style={styles.bottomBar}>
            <AppButton
              text={isConnected ? 'Sync all now' : 'Offline — cannot sync'}
              loading={isSyncing}
              disabled={!isConnected}
              onPress={() => void syncAll()}
              testID="sync-all"
            />
          </View>
        ) : undefined
      }
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        <View style={{ height: h(12) }} />

        {pending.length === 0 ? (
          <EmptyState
            text="Nothing waiting to sync"
            hint="Farmers onboarded without a connection are queued here and uploaded automatically once you are back online."
          />
        ) : null}

        {failed.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              {`Failed to sync (${failed.length})`}
            </Text>
            <Text style={styles.sectionHint}>
              These were sent and rejected. The reason is below each one — a
              retry will fail the same way until it is dealt with.
            </Text>
            <View style={{ height: h(12) }} />
            {failed.map((entry) => (
              <View key={entry.id}>
                <QueueCard
                  entry={entry}
                  isConnected={isConnected}
                  busy={isSyncing}
                  onRetry={() => void syncAll(entry.id)}
                  onDiscard={() => setPendingDiscard(entry)}
                />
                <View style={{ height: h(12) }} />
              </View>
            ))}
            <View style={{ height: h(12) }} />
          </>
        ) : null}

        {waiting.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              {`Waiting to sync (${waiting.length})`}
            </Text>
            <Text style={styles.sectionHint}>
              {isConnected
                ? 'These upload automatically. Tap sync if you would rather not wait.'
                : 'These upload automatically as soon as you are back online.'}
            </Text>
            <View style={{ height: h(12) }} />
            {waiting.map((entry) => (
              <View key={entry.id}>
                <QueueCard
                  entry={entry}
                  isConnected={isConnected}
                  busy={isSyncing}
                  onRetry={() => void syncAll(entry.id)}
                  onDiscard={() => setPendingDiscard(entry)}
                />
                <View style={{ height: h(12) }} />
              </View>
            ))}
          </>
        ) : null}

        <View style={{ height: h(24) }} />
      </ScrollView>

      <ConfirmSheet
        visible={pendingDiscard != null}
        title={`Discard ${pendingDiscard ? pendingFarmerName(pendingDiscard) : 'this record'}?`}
        message="The queued record is deleted from this device and never reaches the server. The farmer would have to be onboarded again from scratch."
        confirmText="Discard record"
        destructive
        onCancel={() => setPendingDiscard(null)}
        onConfirm={confirmDiscard}
      />
    </AppSkeleton>
  );
}

interface QueueCardProps {
  entry: PendingFarmer;
  isConnected: boolean;
  busy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}

function QueueCard({ entry, isConnected, busy, onRetry, onDiscard }: QueueCardProps) {
  const photoCount =
    entry.localFarmPhotoPaths.length +
    (entry.localFarmerPhotoPath ? 1 : 0) +
    (entry.localIdCardPhotoPath ? 1 : 0) +
    (entry.localLandDocumentPath ? 1 : 0);

  return (
    <InfoCard>
      <Text style={styles.name}>{pendingFarmerName(entry)}</Text>
      <Text style={styles.meta}>
        {`Queued ${formatDateAndTime(entry.queuedAt)}`}
        {photoCount > 0
          ? ` · ${photoCount} file${photoCount === 1 ? '' : 's'} to upload`
          : ''}
      </Text>

      {entry.lastError ? (
        <>
          <View style={{ height: h(8) }} />
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{entry.lastError}</Text>
            <Text style={styles.errorMeta}>
              {`${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}`}
              {entry.lastAttemptAt
                ? ` · last tried ${formatDateAndTime(entry.lastAttemptAt)}`
                : ''}
            </Text>
          </View>
        </>
      ) : null}

      <View style={{ height: h(12) }} />

      <View style={styles.actions}>
        <Pressable
          onPress={busy || !isConnected ? undefined : onRetry}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Retry ${pendingFarmerName(entry)}`}
          testID={`sync-retry-${entry.id}`}
        >
          <Text style={[styles.link, !isConnected || busy ? styles.linkDisabled : null]}>
            Retry now
          </Text>
        </Pressable>
        <View style={{ width: r(16) }} />
        <Pressable
          onPress={busy ? undefined : onDiscard}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Discard ${pendingFarmerName(entry)}`}
          testID={`sync-discard-${entry.id}`}
        >
          <Text style={styles.linkDanger}>Discard</Text>
        </Pressable>
      </View>
    </InfoCard>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...textTheme.titleMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  sectionHint: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
    lineHeight: spMin(17),
    marginTop: h(4),
  },
  name: {
    ...textTheme.bodyMedium,
    fontSize: spMin(15),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.black,
  },
  meta: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
  },
  errorBox: {
    backgroundColor: 'rgba(244, 67, 54, 0.08)',
    borderRadius: r(8),
    padding: r(10),
  },
  errorText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.red,
    lineHeight: spMin(17),
  },
  errorMeta: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.secondaryTextColor,
    marginTop: h(4),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  link: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.primary,
  },
  linkDisabled: {
    color: colors.grey,
  },
  linkDanger: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.red,
  },
  bottomBar: {
    paddingHorizontal: r(20),
    paddingBottom: h(12),
  },
});
