/**
 * Market Access — ported from
 * modules/farmers/presentation/view/market_access_view.dart
 *
 * A card per record: the buyer name with a 'Confirmed' pill when confirmed, a
 * season-year and price-per-ton row, `'Harvest Window: …'`, the notes, and edit
 * / delete actions. 'Add Record' at the bottom. Empty: 'No market access
 * records found.'
 *
 * Fixes:
 *  - The title rendered twice (AppSkeleton + an in-body Row).
 *  - The delete button was commented out while `onDelete` stayed a *required*
 *    prop wired to a live `deleteRecord` — dead code guarding a working
 *    endpoint. It is restored behind a confirm sheet.
 *  - The list refreshed only because each navigation `.then()` called
 *    `fetchMarketAccess()`; the mutation invalidates the query instead.
 */
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { labelFor, PRICE_CONTEXTS } from '../../../core/api/domainConstants';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatNaira } from '../../../core/utils/format';
import { EmptyState } from '../components/EmptyState';
import {
  useDeleteMarketAccess,
  useMarketAccessRecords,
} from '../hooks/useMarketAccess';
import type { MarketAccess } from '../model/marketAccess';
import { farmersRoutes } from '../navigation';

import { useRouteParams } from './routeParams';

export interface MarketAccessScreenProps {
  /** Optional override; normally the `/farmers/[id]/market-access` route param. */
  farmerId?: string;
}

export function MarketAccessScreen(props: MarketAccessScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.id ?? '';

  const { records, isLoading, isRefetching, refresh } =
    useMarketAccessRecords(farmerId);
  const { remove, isPending: isDeleting } = useDeleteMarketAccess(farmerId);

  const [pendingDelete, setPendingDelete] = useState<MarketAccess | null>(null);

  return (
    <>
      <AppSkeleton
        appBarTitle="Market Access"
        isBusy={isLoading && records.length === 0}
        bottomBar={
          <View style={styles.bottomBar}>
            <AppButton
              text="Add Record"
              onPress={() => router.push(farmersRoutes.marketAccessAdd(farmerId))}
              testID="market-access-add"
            />
          </View>
        }
      >
        <View style={{ height: h(24) }} />

        <FlashList
          data={records}
          keyExtractor={(item) => item.id}
          estimatedItemSize={160}
          ItemSeparatorComponent={() => <View style={{ height: h(12) }} />}
          renderItem={({ item }) => (
            <MarketAccessCard
              record={item}
              onEdit={() =>
                router.push(farmersRoutes.marketAccessEdit(farmerId, item.id))
              }
              onDelete={() => setPendingDelete(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            !isLoading ? <EmptyState text="No market access records found." /> : null
          }
        />
      </AppSkeleton>

      {/* Copy verbatim from the commented-out Dart sheet. */}
      <ConfirmSheet
        visible={pendingDelete != null}
        title="Delete Record"
        message="Are you sure you want to delete this record?"
        confirmText="Delete"
        destructive
        loading={isDeleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          remove(target.id, { onSuccess: () => setPendingDelete(null) });
        }}
      />
    </>
  );
}

/** `_MarketAccessCard` */
function MarketAccessCard({
  record,
  onEdit,
  onDelete,
}: {
  record: MarketAccess;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.buyer} numberOfLines={1}>
          {record.buyerName}
        </Text>
        {record.isConfirmed ? (
          <View style={styles.confirmedPill}>
            <Text style={styles.confirmedText}>Confirmed</Text>
          </View>
        ) : null}
      </View>

      <View style={{ height: h(8) }} />

      <View style={styles.metaRow}>
        {record.seasonYear != null ? (
          <View style={styles.metaItem}>
            <Text accessible={false} style={styles.metaGlyph}>
              📅
            </Text>
            <Text style={styles.metaText}>{record.seasonYear}</Text>
          </View>
        ) : null}

        {record.pricePerTon != null ? (
          <View style={styles.metaItem}>
            <Text accessible={false} style={styles.metaGlyph}>
              💰
            </Text>
            <Text style={styles.metaText}>
              {`${formatNaira(record.pricePerTon, { decimals: false })}/ton`}
            </Text>
          </View>
        ) : null}

        {/* `price_context` was stored but never shown on the Dart card. */}
        {record.priceContext ? (
          <View style={styles.metaItem}>
            <Text style={styles.metaText}>
              {labelFor(PRICE_CONTEXTS, record.priceContext)}
            </Text>
          </View>
        ) : null}
      </View>

      {record.harvestWindow && record.harvestWindow.length > 0 ? (
        <>
          <View style={{ height: h(8) }} />
          <Text style={styles.metaText}>
            {`Harvest Window: ${record.harvestWindow}`}
          </Text>
        </>
      ) : null}

      {record.notes && record.notes.length > 0 ? (
        <>
          <View style={{ height: h(8) }} />
          <Text style={styles.notes}>{record.notes}</Text>
        </>
      ) : null}

      <View style={{ height: h(12) }} />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${record.buyerName}`}
          hitSlop={8}
          onPress={onEdit}
        >
          <Text style={styles.editGlyph}>✎</Text>
        </Pressable>

        <View style={{ width: r(16) }} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${record.buyerName}`}
          hitSlop={8}
          onPress={onDelete}
        >
          <Text style={styles.deleteGlyph}>🗑</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: r(16),
    backgroundColor: colors.white,
    borderRadius: r(16),
    borderWidth: 1,
    // AppColors.grey @ 20%
    borderColor: 'rgba(107, 114, 128, 0.2)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  buyer: {
    ...textTheme.titleMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    flex: 1,
    marginRight: r(8),
  },
  confirmedPill: {
    paddingHorizontal: r(8),
    paddingVertical: r(4),
    borderRadius: r(16),
    // AppColors.success @ 10%
    backgroundColor: 'rgba(30, 173, 96, 0.1)',
  },
  confirmedText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.success,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: r(16),
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(4),
  },
  metaGlyph: {
    fontSize: spMin(12),
  },
  metaText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
  },
  notes: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  editGlyph: {
    fontSize: spMin(18),
    color: colors.primary,
  },
  deleteGlyph: {
    fontSize: spMin(16),
  },
  bottomBar: {
    paddingHorizontal: r(16),
    paddingVertical: r(16),
    backgroundColor: colors.background,
  },
});
