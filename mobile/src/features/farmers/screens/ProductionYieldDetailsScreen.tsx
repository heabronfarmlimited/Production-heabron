/**
 * Yield Details — ported from
 * modules/farmers/presentation/view/production_yield_details_view.dart (431 LOC)
 *
 * Six conditional cards, in Dart order: 'Basic Information', 'Yield & Dates',
 * 'Input Usage & Storage', 'Financials' (only with an income),
 * 'Verification' (only with a status) and 'Additional Notes' (only with notes).
 * Each row inside is itself conditional, exactly as in Dart.
 *
 * Fixes:
 *  - The record arrived through route arguments with a force-cast
 *    (`settings.arguments! as ProductionYield`), so a deep link or a restart
 *    crashed. The screen takes an id and fetches.
 *  - 'Delete Record' and its confirm sheet were commented out even though
 *    `DELETE /agent/productions/:id` exists. Both are restored.
 *  - A section whose every row was null still rendered as an empty bordered
 *    card; sections with no data are omitted.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppSkeleton } from '../../../components/AppSkeleton';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { textTheme } from '../../../core/theme/typography';
import { formatNaira, titleCase } from '../../../core/utils/format';
import { ActionSheet } from '../components/ActionSheet';
import { EmptyState } from '../components/EmptyState';
import { FullscreenImagePager } from '../components/ImageGallery';
import { InfoCard, SplitDetailRow } from '../components/InfoCard';
import { OptionsRow } from '../components/OptionsRow';
import { DetailSectionHeader } from '../components/SectionTitle';
import { useDeleteProduction, useProduction } from '../hooks/useProductions';
import { farmersRoutes } from '../navigation';

import { useRouteParams } from './routeParams';

export interface ProductionYieldDetailsScreenProps {
  /** Optional override; normally the `/productions/[id]` route param. */
  productionId?: string;
}

export function ProductionYieldDetailsScreen(
  props: ProductionYieldDetailsScreenProps = {},
) {
  const router = useRouter();
  const params = useRouteParams();
  const productionId = props.productionId ?? params.id ?? '';

  const { production, isLoading } = useProduction(productionId);
  const { remove, isPending: isDeleting } = useDeleteProduction();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [gallery, setGallery] = useState<{ urls: string[]; title: string } | null>(
    null,
  );

  if (isLoading && !production) {
    return (
      <AppSkeleton appBarTitle="Yield Details" isBusy>
        <View />
      </AppSkeleton>
    );
  }

  if (!production) {
    return (
      <AppSkeleton appBarTitle="Yield Details" scrollable>
        {/* Dart's guard read 'Invalid financing details data.'; the yield
            screen had none and would simply throw. */}
        <EmptyState text="This yield record could not be loaded." />
      </AppSkeleton>
    );
  }

  const openImages = (urls: string[], title: string) =>
    setGallery({ urls, title });

  // 'Input Usage & Storage' rendered as an empty card in Dart whenever all
  // three of its rows were null.
  const hasInputUsage =
    production.fertilizerUsed != null ||
    production.herbicideUsed != null ||
    production.postHarvestStorage != null ||
    production.seedType != null;

  const hasDates =
    production.expectedPlantingDate != null ||
    production.expectedHarvestDate != null ||
    production.harvestDate != null ||
    production.expectedYieldTonnes != null ||
    production.actualYieldTonnes != null ||
    production.benchmarkYieldTonnes != null;

  const hasVerification = production.verificationStatus != null;

  return (
    <>
      <AppSkeleton
        appBarTitle="Yield Details"
        appBarActions={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yield actions"
            hitSlop={8}
            onPress={() => setSheetOpen(true)}
            testID="yield-actions"
          >
            <Text style={styles.moreGlyph}>⋮</Text>
          </Pressable>
        }
        scrollable
      >
        <View style={{ height: h(24) }} />

        {/* ------------------------------------------- basic information */}
        <DetailSectionHeader title="Basic Information" />
        <InfoCard>
          <SplitDetailRow label="Season" value={production.season.toUpperCase()} />
          <SplitDetailRow label="Crop" value={production.crop} />
          <SplitDetailRow label="Cycle Number" value={`${production.cycleNumber}`} />
          {production.seedType ? (
            <SplitDetailRow label="Seed Type" value={production.seedType} />
          ) : null}
        </InfoCard>

        {/* ----------------------------------------------- yield & dates */}
        {hasDates ? (
          <>
            <View style={{ height: h(24) }} />
            <DetailSectionHeader title="Yield & Dates" />
            <InfoCard>
              {production.expectedPlantingDate ? (
                <SplitDetailRow
                  label="Expected Planting"
                  value={production.expectedPlantingDate.slice(0, 10)}
                />
              ) : null}
              {production.expectedHarvestDate ? (
                <SplitDetailRow
                  label="Expected Harvest"
                  value={production.expectedHarvestDate.slice(0, 10)}
                />
              ) : null}
              {production.harvestDate ? (
                <SplitDetailRow
                  label="Actual Harvest"
                  value={production.harvestDate.slice(0, 10)}
                />
              ) : null}
              {production.expectedYieldTonnes != null ? (
                <SplitDetailRow
                  label="Expected Yield"
                  value={`${production.expectedYieldTonnes} tons`}
                />
              ) : null}
              {production.actualYieldTonnes != null ? (
                <SplitDetailRow
                  label="Actual Yield"
                  value={`${production.actualYieldTonnes} tons`}
                />
              ) : null}
              {production.benchmarkYieldTonnes != null ? (
                <SplitDetailRow
                  label="Benchmark Yield"
                  value={`${production.benchmarkYieldTonnes} tons`}
                />
              ) : null}
              {/* Generated columns the Dart screen never rendered. */}
              {production.yieldAchievementRate != null ? (
                <SplitDetailRow
                  label="Achievement Rate"
                  value={`${Math.round(production.yieldAchievementRate * 100)}%`}
                />
              ) : null}
              {production.yieldVarianceTonnes != null ? (
                <SplitDetailRow
                  label="Variance"
                  value={`${production.yieldVarianceTonnes} tons`}
                />
              ) : null}
            </InfoCard>
          </>
        ) : null}

        {/* --------------------------------------- input usage & storage */}
        {hasInputUsage ? (
          <>
            <View style={{ height: h(24) }} />
            <DetailSectionHeader title="Input Usage & Storage" />
            <InfoCard>
              {production.fertilizerUsed ? (
                <SplitDetailRow
                  label="Fertilizer Used"
                  value={production.fertilizerUsed}
                />
              ) : null}
              {production.herbicideUsed != null ? (
                <SplitDetailRow
                  label="Herbicide Used"
                  value={production.herbicideUsed ? 'Yes' : 'No'}
                />
              ) : null}
              {production.postHarvestStorage ? (
                <SplitDetailRow
                  label="Post-Harvest Storage"
                  value={production.postHarvestStorage}
                />
              ) : null}
            </InfoCard>
          </>
        ) : null}

        {/* -------------------------------------------------- financials */}
        {production.estimatedFarmIncome != null ? (
          <>
            <View style={{ height: h(24) }} />
            <DetailSectionHeader title="Financials" />
            <InfoCard>
              <SplitDetailRow
                label="Estimated Farm Income"
                value={formatNaira(production.estimatedFarmIncome, {
                  decimals: false,
                })}
              />
            </InfoCard>
          </>
        ) : null}

        {/* ------------------------------------------------ verification */}
        {hasVerification ? (
          <>
            <View style={{ height: h(24) }} />
            <DetailSectionHeader title="Verification" />
            <InfoCard>
              <SplitDetailRow
                label="Status"
                value={titleCase(production.verificationStatus)}
              />
              {production.verificationNotes &&
              production.verificationNotes.length > 0 ? (
                <SplitDetailRow label="Notes" value={production.verificationNotes} />
              ) : null}
              {production.warehouseReceiptUrl ? (
                <SplitDetailRow
                  label="Warehouse Receipt"
                  value="View"
                  valueColor={colors.primary}
                  onPress={() =>
                    openImages(
                      [production.warehouseReceiptUrl ?? ''],
                      'Warehouse Receipt',
                    )
                  }
                />
              ) : null}
              {production.buyerReceiptUrl ? (
                <SplitDetailRow
                  label="Buyer Receipt"
                  value="View"
                  valueColor={colors.primary}
                  onPress={() =>
                    openImages([production.buyerReceiptUrl ?? ''], 'Buyer Receipt')
                  }
                />
              ) : null}
              {production.agentSignatureUrl ? (
                <SplitDetailRow
                  label="Agent Signature"
                  value="View"
                  valueColor={colors.primary}
                  onPress={() =>
                    openImages(
                      [production.agentSignatureUrl ?? ''],
                      'Agent Signature',
                    )
                  }
                />
              ) : null}
              {production.harvestPhotoUrls.length > 0 ? (
                <SplitDetailRow
                  label="Harvest Photos"
                  value={`${production.harvestPhotoUrls.length} image(s)`}
                  valueColor={colors.primary}
                  onPress={() =>
                    openImages(production.harvestPhotoUrls, 'Harvest Photos')
                  }
                />
              ) : null}
            </InfoCard>
          </>
        ) : null}

        {/* --------------------------------------------- additional notes */}
        {production.notes && production.notes.length > 0 ? (
          <>
            <View style={{ height: h(24) }} />
            <DetailSectionHeader title="Additional Notes" />
            <InfoCard>
              <Text style={styles.notes}>{production.notes}</Text>
            </InfoCard>
          </>
        ) : null}

        <View style={{ height: h(24) }} />
      </AppSkeleton>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Yield actions"
        subtitle="Choose an action to manage this record."
      >
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>✎</Text>}
          label="Edit Record"
          subtitle="Update this seasonal yield"
          onPress={() => {
            setSheetOpen(false);
            router.push(
              farmersRoutes.editYield(production.farmerId, production.id),
            );
          }}
        />
        {/* Re-enabled from the commented-out ListTile. */}
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>🗑</Text>}
          label="Delete Record"
          subtitle="Remove this production record"
          labelColor={colors.failure}
          iconColor={colors.failure}
          onPress={() => {
            setSheetOpen(false);
            setDeleteOpen(true);
          }}
          testID="yield-delete"
        />
      </ActionSheet>

      {/* Copy verbatim from the commented-out Dart sheet. */}
      <ConfirmSheet
        visible={deleteOpen}
        title="Delete Production"
        message="Are you sure you want to delete this production record?"
        confirmText="Delete"
        destructive
        loading={isDeleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() =>
          remove(
            { id: production.id, farmerId: production.farmerId },
            {
              onSuccess: () => {
                setDeleteOpen(false);
                router.back();
              },
            },
          )
        }
      />

      <FullscreenImagePager
        visible={gallery != null}
        urls={gallery?.urls ?? []}
        title={gallery?.title ?? 'Photo Preview'}
        onClose={() => setGallery(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  moreGlyph: {
    fontSize: spMin(22),
    paddingHorizontal: r(6),
  },
  notes: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.black,
  },
  rowGlyph: {
    fontSize: spMin(16),
  },
});
