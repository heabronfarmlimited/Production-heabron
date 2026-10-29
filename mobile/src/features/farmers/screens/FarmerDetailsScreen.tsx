/**
 * Farmer details — ported from
 * modules/farmers/presentation/view/farmer_details_view.dart (938 LOC)
 *
 * Sections, in Dart order: avatar row with the score, 'Crop Types' chips,
 * 'Personal details', 'Farm information', 'Production', 'Repayment'. The
 * overflow menu opens the 'Farmer actions' sheet.
 *
 * Fixes:
 *  - The Dart screen rendered its title twice (the `AppSkeleton` app bar plus
 *    an in-body Row). Rendered once.
 *  - The Repayment card showed `creditScoreObj.productionScore` where
 *    `repaymentScore` belongs — a copy/paste bug, so the repayment score was
 *    never visible. It now reads `repaymentScore` from
 *    `GET /agent/farmers/:id/credit-score`.
 *  - Every farm field had an inline `farm.* ?? farmProfiles.first.*` fallback
 *    repeated eleven times. One `resolveFarm()` call replaces all of them.
 *  - The farmer arrived through route arguments, so a deep link or a restart
 *    showed a blank screen. The screen takes an id and fetches.
 *  - 'Delete Farmer' and its confirmation dialog were ~86 commented-out lines;
 *    both are restored.
 *  - Two new actions: manual NIN re-verify and 'Capture farm boundary', which
 *    existed in the repository layer with no UI.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { resolveCoopScoreColor, titleCase } from '../../../core/utils/format';
import { showError } from '../../../core/utils/toast';
import { ActionSheet } from '../components/ActionSheet';
import { EmptyState } from '../components/EmptyState';
import { ImageGalleryDialog } from '../components/ImageGallery';
import { DetailRow, InfoCard } from '../components/InfoCard';
import { OptionsRow } from '../components/OptionsRow';
import { DetailSectionHeader } from '../components/SectionTitle';
import { useFarmerExport } from '../hooks/useFarmerExport';
import { useDeleteFarmer, useVerifyFarmerNin } from '../hooks/useFarmerMutations';
import { useFarmer, useFarmerCreditScore } from '../hooks/useFarmers';
import { resolveCrops, resolveFarm, resolveFullAddress } from '../model/farmer';
import { farmersRoutes } from '../navigation';

import { useRouteParams } from './routeParams';

/** Dart rendered `'N/A'` for every missing value. */
const NA = 'N/A';

const text = (value?: string | null, transform = false): string => {
  if (!value || value.length === 0) return NA;
  return transform ? titleCase(value) : value;
};

export interface FarmerDetailsScreenProps {
  /** Optional override; normally read from the `/farmers/[id]` route param. */
  farmerId?: string;
}

export function FarmerDetailsScreen(props: FarmerDetailsScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.id ?? '';

  const { farmer, isLoading, error } = useFarmer(farmerId);
  const { score } = useFarmerCreditScore(farmerId);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const { verify, isPending: isVerifying } = useVerifyFarmerNin(farmerId);
  /**
   * NOTE — the Dart caller passed no `financingHistory`, so the export
   * service's five hardcoded financing rows and its entirely invented
   * repayments table rendered in every PDF. This fetches the real yields,
   * financing requests and repayments first; a section with no rows renders
   * its empty state.
   */
  const { exportFarmer, isPending: isExporting } = useFarmerExport();
  const { remove, isPending: isDeleting } = useDeleteFarmer();

  if (isLoading && !farmer) {
    return (
      <AppSkeleton appBarTitle="Farmer Details" isBusy>
        <View />
      </AppSkeleton>
    );
  }

  if (!farmer) {
    return (
      <AppSkeleton appBarTitle="Farmer Details" scrollable>
        <EmptyState
          text="This farmer could not be loaded."
          hint={error ? 'Pull down to try again.' : undefined}
        />
      </AppSkeleton>
    );
  }

  const farm = resolveFarm(farmer);
  const crops = resolveCrops(farmer);
  const fullAddress = resolveFullAddress(farmer);
  const creditScore = farmer.creditScore ?? 0;
  const farmPhotos = farm?.farmPhotoUrls ?? [];

  const openLandDocument = async () => {
    const url = farm?.landDocumentUrl;
    if (!url) return;
    const opened = await Linking.openURL(url).then(
      () => true,
      () => false,
    );
    if (!opened) showError('Could not launch document URL');
  };

  const ninStatus = farmer.ninVerificationStatus;
  const ninVerified = (ninStatus ?? '').toLowerCase() === 'verified';

  return (
    <>
      <AppSkeleton
        appBarTitle="Farmer Details"
        backgroundColor={colors.background}
        // The PDF gathers yields, financing and repayments before rendering.
        isBusy={isExporting}
        busyText="Preparing export…"
        appBarActions={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Farmer actions"
            hitSlop={8}
            onPress={() => setSheetOpen(true)}
            testID="farmer-actions"
          >
            <Text style={styles.moreGlyph}>⋮</Text>
          </Pressable>
        }
        scrollable
      >
        <View style={{ height: h(24) }} />

        {/* ------------------------------------------------- avatar row */}
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            {farmer.farmerPhotoUrl ? (
              <Image
                source={{ uri: farmer.farmerPhotoUrl }}
                style={styles.avatarImage}
                resizeMode="cover"
                accessible={false}
              />
            ) : (
              <Text accessible={false} style={styles.avatarGlyph}>
                👤
              </Text>
            )}
          </View>

          <View style={styles.headerText}>
            <Text style={styles.name}>
              {farmer.fullName ? titleCase(farmer.fullName) : 'Unknown Farmer'}
            </Text>
            <View style={{ height: h(6) }} />
            <Text style={styles.address} numberOfLines={2}>
              {titleCase(fullAddress)}
            </Text>
          </View>

          <View style={styles.scoreBlock}>
            <Text style={styles.scoreLabel}>Score</Text>
            <View style={{ height: h(4) }} />
            <Text style={[styles.scoreValue, { color: resolveCoopScoreColor(creditScore) }]}>
              {creditScore}
            </Text>
          </View>
        </View>

        <View style={{ height: h(26) }} />

        {/* ------------------------------------------------- crop types */}
        <Text style={styles.cropHeading}>Crop Types</Text>
        <View style={{ height: h(12) }} />

        {crops.length > 0 ? (
          <View style={styles.chips}>
            {crops.map((crop) => (
              <View key={crop} style={styles.chip}>
                <Text style={styles.chipText}>{titleCase(crop)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.noCrops}>No crops specified</Text>
        )}

        <View style={{ height: h(28) }} />

        {/* -------------------------------------------- personal details */}
        <DetailSectionHeader title="Personal details" />
        <InfoCard>
          <DetailRow label="Phone" value={text(farmer.phone)} />
          {farmer.altPhone ? (
            <DetailRow label="Alt Phone" value={farmer.altPhone} />
          ) : null}
          <DetailRow label="Gender" value={text(farmer.gender, true)} />
          <DetailRow label="Date of Birth" value={text(farmer.dateOfBirth)} />
          <DetailRow label="NIN" value={text(farmer.nin)} />
          <DetailRow
            label="NIN Status"
            value={ninStatus ? titleCase(ninStatus) : 'Pending'}
            valueColor={ninVerified ? colors.primary : colors.secondary400}
          />
          {/*
            NEW — manual re-verify. `POST /agent/farmers/:id/verify-nin` and its
            repository method existed in Flutter with no UI at all, so a
            `mismatch` or `failed` farmer could never be re-checked from the app.
          */}
          {farmer.nin ? (
            <View style={styles.verifyRow}>
              {isVerifying ? (
                <AppLoading color={colors.primary} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Re-verify NIN"
                  onPress={() => verify()}
                  testID="farmer-verify-nin"
                >
                  <Text style={styles.verifyLink}>
                    {ninVerified ? 'Re-verify NIN' : 'Verify NIN now'}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null}
          <DetailRow label="BVN" value={text(farmer.bvn)} />
          <DetailRow label="Education" value={text(farmer.educationLevel, true)} />
          <DetailRow
            label="Household Size"
            value={farmer.householdSize?.toString() ?? NA}
          />
          <DetailRow label="Dependents" value={farmer.dependents?.toString() ?? NA} />
          <DetailRow label="Credit Tier" value={text(farmer.creditTier)} />
        </InfoCard>

        <View style={{ height: h(24) }} />

        {/* ------------------------------------------- farm information */}
        <DetailSectionHeader title="Farm information" />
        <InfoCard>
          <DetailRow
            label="Cooperative"
            value={text(farmer.cooperative?.name, true)}
          />
          <DetailRow
            label="Farm Size"
            value={farm?.farmSizeAcres != null ? `${farm.farmSizeAcres} acres` : NA}
          />
          <DetailRow label="Soil Type" value={text(farm?.soilType, true)} />
          <DetailRow label="Land Ownership" value={text(farm?.landOwnership, true)} />
          <DetailRow label="Water Source" value={text(farm?.waterSource, true)} />
          <DetailRow
            label="Years Experience"
            value={farm?.yearsExperience != null ? `${farm.yearsExperience} years` : NA}
          />
          <DetailRow
            label="Irrigation Access"
            value={
              farm?.irrigationAccess == null ? NA : farm.irrigationAccess ? 'Yes' : 'No'
            }
          />
          <DetailRow
            label="GPS Coordinates"
            value={
              farm?.gpsLat != null && farm.gpsLng != null
                ? `${farm.gpsLat}, ${farm.gpsLng}`
                : NA
            }
          />
          {/* NEW — mapped boundary, now that the polygon can be captured. */}
          <DetailRow
            label="Boundary Points"
            value={
              farm && farm.gpsPolygon.length > 0
                ? `${farm.gpsPolygon.length} points`
                : 'Not mapped'
            }
            valueColor={colors.primary}
            onPress={() => router.push(farmersRoutes.captureBoundary(farmer.id))}
            testID="farmer-open-boundary"
          />
          <DetailRow
            label="Land Document Type"
            value={text(farm?.landDocumentType, true)}
          />
          <DetailRow
            label="Land Document"
            value={farm?.landDocumentUrl ? 'View Document' : NA}
            valueColor={farm?.landDocumentUrl ? colors.primary : undefined}
            onPress={farm?.landDocumentUrl ? () => void openLandDocument() : undefined}
          />
          <DetailRow
            label="Farm Images"
            value={farmPhotos.length > 0 ? `${farmPhotos.length} image(s)` : NA}
            valueColor={farmPhotos.length > 0 ? colors.primary : undefined}
            onPress={farmPhotos.length > 0 ? () => setGalleryOpen(true) : undefined}
          />
        </InfoCard>

        <View style={{ height: h(24) }} />

        {/* ----------------------------------------------- production */}
        <DetailSectionHeader title="Production" />
        <InfoCard>
          <DetailRow
            label="Previous yield quantity"
            value={`${score?.productionScore ?? 0}`}
          />
          <DetailRow
            label=""
            value="View yields"
            isAction
            valueColor={colors.primary}
            onPress={() => router.push(farmersRoutes.productionYields(farmer.id))}
          />
        </InfoCard>

        <View style={{ height: h(24) }} />

        {/* ------------------------------------------------ repayment */}
        <DetailSectionHeader title="Repayment" />
        <InfoCard>
          {/* FIXED — Dart read `productionScore` here. */}
          <DetailRow label="Score" value={`${score?.repaymentScore ?? 0}`} />
          <DetailRow
            label=""
            value="Record repayment"
            isAction
            valueColor={colors.primary}
            onPress={() => router.push(farmersRoutes.recordRepayment(farmer.id))}
          />
        </InfoCard>

        <View style={{ height: h(24) }} />
      </AppSkeleton>

      {/* ------------------------------------------------- action sheet */}
      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Farmer actions"
        subtitle="Choose an action to manage this farmer."
      >
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>↗</Text>}
          label="Export Data"
          subtitle="Download or share farmer records"
          onPress={() => {
            setSheetOpen(false);
            void exportFarmer(farmer);
          }}
        />
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>🌾</Text>}
          label="Production Yields"
          subtitle="View seasonal yields"
          onPress={() => {
            setSheetOpen(false);
            router.push(farmersRoutes.productionYields(farmer.id));
          }}
        />
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>🏪</Text>}
          label="Market Access"
          subtitle="View offtake history"
          onPress={() => {
            setSheetOpen(false);
            router.push(farmersRoutes.marketAccess(farmer.id));
          }}
        />
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>📝</Text>}
          label="Field Notes"
          subtitle="View timeline & observations"
          onPress={() => {
            setSheetOpen(false);
            router.push(farmersRoutes.fieldNotes(farmer.id));
          }}
        />
        {/* NEW — the boundary-capture screen. */}
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>📐</Text>}
          label="Capture Farm Boundary"
          subtitle="Walk the farm to measure its size"
          onPress={() => {
            setSheetOpen(false);
            router.push(farmersRoutes.captureBoundary(farmer.id));
          }}
        />
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>✎</Text>}
          label="Edit Farmer Profile"
          subtitle="Update farmer details"
          onPress={() => {
            setSheetOpen(false);
            router.push(farmersRoutes.edit(farmer.id));
          }}
        />
        {/* Re-enabled from ~86 commented-out lines. */}
        <OptionsRow
          icon={<Text style={styles.rowGlyph}>🗑</Text>}
          label="Delete Farmer"
          subtitle="Remove this farmer permanently"
          labelColor={colors.failure}
          iconColor={colors.failure}
          onPress={() => {
            setSheetOpen(false);
            setDeleteOpen(true);
          }}
          testID="farmer-delete"
        />
      </ActionSheet>

      {/*
        Message verbatim from the commented-out Dart dialog. The farmer's name
        must be typed to confirm, since the delete cascades to every production,
        market-access and field-note record.
      */}
      <ConfirmSheet
        visible={deleteOpen}
        title="Delete Farmer"
        message={`Are you sure you want to permanently delete ${
          farmer.fullName ?? 'this farmer'
        }? This action cannot be undone and all associated records will be lost.`}
        confirmText="Delete"
        destructive
        confirmationPrompt="Type the farmer's name to confirm"
        confirmationPlaceholder={farmer.fullName ?? ''}
        expectedConfirmation={farmer.fullName ?? ''}
        loading={isDeleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() =>
          remove(
            { id: farmer.id, cooperativeId: farmer.cooperativeId },
            {
              onSuccess: () => {
                setDeleteOpen(false);
                router.back();
              },
            },
          )
        }
      />

      <ImageGalleryDialog
        visible={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        urls={farmPhotos}
      />
    </>
  );
}

const styles = StyleSheet.create({
  moreGlyph: {
    fontSize: spMin(22),
    paddingHorizontal: r(6),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: r(68),
    height: r(68),
    borderRadius: r(68),
    backgroundColor: colors.secondary100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarGlyph: {
    fontSize: spMin(28),
  },
  headerText: {
    flex: 1,
    marginLeft: r(16),
  },
  name: {
    ...textTheme.headlineSmall,
    fontSize: spMin(16),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  address: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
  },
  scoreBlock: {
    alignItems: 'flex-end',
    marginLeft: r(8),
  },
  scoreLabel: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  scoreValue: {
    ...textTheme.headlineSmall,
    fontSize: spMin(16),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  cropHeading: {
    ...textTheme.bodyMedium,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: r(8),
  },
  chip: {
    paddingVertical: r(10),
    paddingHorizontal: r(14),
    borderRadius: r(12),
    // AppColors.primary @ 12%
    backgroundColor: 'rgba(46, 139, 87, 0.12)',
  },
  chipText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.primary,
  },
  noCrops: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  verifyRow: {
    alignItems: 'flex-end',
    paddingVertical: r(6),
  },
  verifyLink: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  rowGlyph: {
    fontSize: spMin(16),
  },
});
