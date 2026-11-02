/**
 * Update Record hub (v2 user flow).
 *
 * One place to add any of the five records an agent captures against a
 * farmer, instead of five entry points scattered across the farmer detail
 * screen's action list. The hub exists because the actions it collects are
 * the ones done repeatedly in the field — the detail screen is for reading a
 * farmer, this is for recording against one.
 *
 * Each row says what the record is FOR, not just what it is called. An agent
 * deciding between "Produce Delivery" and "Production / Yield" needs to know
 * that one is the harvest and the other is what reached the buyer, because
 * the credit score reads them differently: yield against the land drives the
 * production score, deliveries are what repayment timeliness is measured
 * against.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { SkeletonCard } from '../../../components/Skeleton';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { InfoCard } from '../components/InfoCard';
import { useFarmer } from '../hooks/useFarmers';
import { farmersRoutes } from '../navigation';

import { useRouteParams } from './routeParams';

export interface UpdateRecordScreenProps {
  farmerId?: string;
}

interface RecordOption {
  key: string;
  title: string;
  description: string;
  glyph: string;
  /** `routes.*` returns expo-router's own Href, which is not just a string. */
  route: ReturnType<typeof farmersRoutes.recordYields>;
}

export function UpdateRecordScreen({ farmerId: farmerIdProp }: UpdateRecordScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = farmerIdProp ?? params.id ?? '';

  const { farmer, isLoading } = useFarmer(farmerId);

  const options: RecordOption[] = [
    {
      key: 'yield',
      title: 'Production / Yield',
      description:
        'What the farmer harvested this season. Divided by their land, this is the production half of the credit score.',
      glyph: '🌾',
      route: farmersRoutes.recordYields(farmerId),
    },
    {
      key: 'delivery',
      title: 'Produce Delivery',
      description:
        'What actually reached the buyer or warehouse, with the receipt. Repayment timeliness is measured against these.',
      glyph: '🚚',
      route: farmersRoutes.logDelivery(farmerId),
    },
    {
      key: 'repayment',
      title: 'Repayment',
      description:
        'A payment made against an active loan. The repayment half of the credit score is built from these.',
      glyph: '💵',
      route: farmersRoutes.recordRepayment(farmerId),
    },
    {
      key: 'market',
      title: 'Market Access',
      description:
        'A buyer, a price and whether the sale is confirmed. Evidence that the harvest has somewhere to go.',
      glyph: '🏪',
      route: farmersRoutes.marketAccessAdd(farmerId),
    },
    {
      key: 'note',
      title: 'Field Note',
      description:
        'Anything observed on the visit that the other four records have no place for.',
      glyph: '📝',
      route: farmersRoutes.fieldNoteAdd(farmerId),
    },
  ];

  return (
    <AppSkeleton
      appBarTitle="Update Record"
      appBarLeading={<AuthBackButton />}
      firstLoad={isLoading && !farmer ? <SkeletonCard rows={5} /> : null}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ height: h(12) }} />

        {farmer ? (
          <>
            <Text style={styles.farmerName}>{farmer.fullName}</Text>
            <Text style={styles.farmerMeta}>
              {farmer.cooperative?.name ?? 'No cooperative'}
            </Text>
            <View style={{ height: h(18) }} />
          </>
        ) : null}

        {options.map((option) => (
          <View key={option.key}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={option.title}
              onPress={() => router.push(option.route)}
              testID={`update-record-${option.key}`}
            >
              <InfoCard>
                <View style={styles.row}>
                  <Text style={styles.glyph}>{option.glyph}</Text>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{option.title}</Text>
                    <Text style={styles.rowDescription}>{option.description}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </View>
              </InfoCard>
            </Pressable>
            <View style={{ height: h(12) }} />
          </View>
        ))}

        <View style={{ height: h(24) }} />
      </ScrollView>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  farmerName: {
    ...textTheme.titleMedium,
    fontSize: spMin(18),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  farmerMeta: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(12),
  },
  glyph: {
    fontSize: spMin(22),
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(15),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.black,
  },
  rowDescription: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
    lineHeight: spMin(17),
    marginTop: h(2),
  },
  chevron: {
    ...textTheme.bodyLarge,
    fontSize: spMin(22),
    color: colors.grey,
  },
});
