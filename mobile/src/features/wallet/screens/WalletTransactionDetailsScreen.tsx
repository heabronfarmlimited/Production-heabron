/**
 * Transaction details — ported from
 * modules/wallet/presentation/view/wallet_transaction_details_view.dart
 *
 * Six sections in Dart order:
 *   1. amount hero       — 64r tinted circle, the signed amount at 32sp w700
 *                          in the status colour, then the status chip
 *   2. 'Transaction Info'    Type / Description / Source / Payment Method
 *   3. 'Reference & Recipient' Ref. Number / Internal Ref. / Recipient Name
 *   4. 'Dates'               Created At / Confirmed At
 *   5. 'Proof / Receipt'     horizontal gallery, only when an image exists
 *   6. 'Linked Records'      Financing / Repayment / Farmer id, only when set
 *
 * Section headers are 13sp w700 with letterSpacing 0.4; each card is white,
 * radius 16, with a `grey @ 20%` border.
 *
 * FIXED — the Dart screen read the whole `WalletTransaction` out of route
 * arguments and rendered 'Invalid transaction data.' whenever it was missing,
 * so the route could not be deep-linked or restored. This screen takes the id
 * and fetches `GET /agent/wallet/transactions/:id`.
 */
import { useLocalSearchParams } from 'expo-router';
import type { ReactNode} from 'react';
import { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin, w } from '../../../core/theme/responsive';
import { fontWeights, textTheme, withNaira } from '../../../core/theme/typography';
import { formatNaira } from '../../../core/utils/format';
import { DetailRow } from '../components/DetailRow';
import { StatusChip } from '../components/StatusChip';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrokenImageIcon,
  CloseIcon,
} from '../components/WalletIcons';
import { useWalletTransaction } from '../hooks/useWallet';
import {
  isCredit,
  transactionImages,
  type WalletTransaction,
} from '../model/walletTransaction';
import { withAlpha } from '../utils/color';
import {
  EMPTY_VALUE,
  formatDateTimeDot,
  sentenceCase,
  upperWords,
} from '../utils/format';

export interface WalletTransactionDetailsScreenProps {
  /** Supplied by the route; falls back to the `id` search param. */
  id?: string;
}

export function WalletTransactionDetailsScreen({
  id: idProp,
}: WalletTransactionDetailsScreenProps = {}) {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = idProp ?? params.id ?? '';

  const { transaction, isLoading } = useWalletTransaction(id);

  return (
    <AppSkeleton
      isBusy={isLoading && transaction == null}
      appBarLeading={<AuthBackButton />}
      appBarTitleWidget={<Text style={styles.appBarTitle}>Transaction Details</Text>}
      bodyPadding={styles.bodyPadding}
    >
      {transaction ? (
        <Details transaction={transaction} />
      ) : isLoading ? null : (
        <View style={styles.missing}>
          {/* Dart rendered this literal when the route argument was absent. */}
          <Text style={styles.missingText}>Invalid transaction data.</Text>
        </View>
      )}
    </AppSkeleton>
  );
}

function Details({ transaction }: { transaction: WalletTransaction }) {
  const credit = isCredit(transaction);
  const accent = credit ? colors.success : colors.failure;
  const prefix = credit ? '+' : '-';

  const images = transactionImages(transaction);
  const hasLinked =
    transaction.relatedFinancingId != null ||
    transaction.relatedRepaymentId != null ||
    transaction.relatedFarmerId != null;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* 1 — amount hero */}
      <View style={styles.hero}>
        <View style={[styles.heroCircle, { backgroundColor: withAlpha(accent, 0.12) }]}>
          {credit ? (
            <ArrowDownIcon color={accent} size={30} />
          ) : (
            <ArrowUpIcon color={accent} size={30} />
          )}
        </View>
        <View style={{ height: h(14) }} />
        <Text style={[styles.heroAmount, { color: accent }]}>
          {`${prefix}${formatNaira(transaction.amount)}`}
        </Text>
        <View style={{ height: h(8) }} />
        <StatusChip status={transaction.status ?? ''} palette="transaction" />
      </View>

      <View style={{ height: h(28) }} />

      {/* 2 — transaction info */}
      <SectionHeader title="Transaction Info" />
      <Card>
        <DetailRow
          label="Type"
          value={credit ? 'Credit (Incoming)' : 'Debit (Outgoing)'}
          valueColor={accent}
        />
        <DetailRow label="Description" value={sentenceCase(transaction.description)} />
        <DetailRow label="Source" value={upperWords(transaction.source)} />
        <DetailRow
          label="Payment Method"
          value={upperWords(transaction.paymentMethod)}
          isLast
        />
      </Card>

      <View style={{ height: h(20) }} />

      {/* 3 — reference & recipient */}
      <SectionHeader title="Reference & Recipient" />
      <Card>
        <DetailRow
          label="Ref. Number"
          value={transaction.referenceNumber ?? EMPTY_VALUE}
        />
        <DetailRow label="Internal Ref." value={transaction.reference ?? EMPTY_VALUE} />
        <DetailRow
          label="Recipient Name"
          value={transaction.recipientName ?? EMPTY_VALUE}
          isLast
        />
      </Card>

      <View style={{ height: h(20) }} />

      {/* 4 — dates */}
      <SectionHeader title="Dates" />
      <Card>
        <DetailRow label="Created At" value={formatDateTimeDot(transaction.createdAt)} />
        <DetailRow
          label="Confirmed At"
          value={formatDateTimeDot(transaction.confirmedAt)}
          isLast
        />
      </Card>

      <View style={{ height: h(20) }} />

      {/* 5 — proof / receipt */}
      {images.length > 0 ? (
        <>
          <SectionHeader title="Proof / Receipt" />
          <ImageGallery urls={images} />
          <View style={{ height: h(20) }} />
        </>
      ) : null}

      {/* 6 — linked records */}
      {hasLinked ? (
        <>
          <SectionHeader title="Linked Records" />
          <Card>
            {transaction.relatedFinancingId ? (
              <DetailRow
                label="Financing ID"
                value={transaction.relatedFinancingId}
                mono
                isLast={
                  transaction.relatedRepaymentId == null &&
                  transaction.relatedFarmerId == null
                }
              />
            ) : null}
            {transaction.relatedRepaymentId ? (
              <DetailRow
                label="Repayment ID"
                value={transaction.relatedRepaymentId}
                mono
                isLast={transaction.relatedFarmerId == null}
              />
            ) : null}
            {transaction.relatedFarmerId ? (
              <DetailRow
                label="Farmer ID"
                value={transaction.relatedFarmerId}
                mono
                isLast
              />
            ) : null}
          </Card>
          <View style={{ height: h(20) }} />
        </>
      ) : null}

      <View style={{ height: h(32) }} />
    </ScrollView>
  );
}

/** `_SectionHeader` — 13sp w700, letterSpacing 0.4, then 12 space. */
function SectionHeader({ title }: { title: string }) {
  return (
    <>
      <Text style={styles.sectionHeader}>{title}</Text>
      <View style={{ height: h(12) }} />
    </>
  );
}

/** `_buildCard` — white, radius 16, `grey @ 20%` border. */
function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

/**
 * `_ImageGallery` — a 180h horizontal strip of 200w thumbnails (radius 12)
 * with 12 between, each opening a fullscreen viewer. Mirrors the Dart
 * `loadingBuilder` / `errorBuilder`: a `secondary200` box holding a spinner
 * while loading and a `broken_image_outlined` glyph on failure.
 */
function ImageGallery({ urls }: { urls: string[] }) {
  const [viewing, setViewing] = useState<string | null>(null);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.gallery}
        contentContainerStyle={styles.galleryContent}
      >
        {urls.map((url, index) => (
          <Pressable
            key={`${url}-${index}`}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Open attachment ${index + 1}`}
            onPress={() => setViewing(url)}
            style={index > 0 ? styles.thumbSpacing : undefined}
          >
            <GalleryThumb url={url} />
          </Pressable>
        ))}
      </ScrollView>

      <Modal
        visible={viewing != null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <View style={styles.viewerBackdrop}>
          {viewing ? (
            <Image
              source={{ uri: viewing }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close image"
            onPress={() => setViewing(null)}
            hitSlop={8}
            style={styles.viewerClose}
          >
            <CloseIcon color={colors.white} size={20} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

function GalleryThumb({ url }: { url: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  if (state === 'error') {
    return (
      <View style={styles.thumbFallback}>
        <BrokenImageIcon color={colors.grey} size={36} />
      </View>
    );
  }

  return (
    <View style={styles.thumbWrap}>
      <Image
        source={{ uri: url }}
        style={styles.thumb}
        resizeMode="cover"
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
      />
      {state === 'loading' ? (
        <View style={styles.thumbOverlay}>
          <AppLoading color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  bodyPadding: {
    paddingHorizontal: 0,
  },
  scrollContent: {
    paddingHorizontal: r(16),
    paddingBottom: r(24),
  },
  appBarTitle: {
    ...textTheme.headlineMedium,
    fontSize: spMin(18),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingText: {
    ...textTheme.bodyMedium,
    color: colors.grey,
  },
  hero: {
    alignItems: 'center',
  },
  heroCircle: {
    width: r(64),
    height: r(64),
    borderRadius: r(64),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAmount: {
    ...withNaira(textTheme.headlineLarge),
    fontSize: spMin(32),
    fontWeight: '700',
  },
  sectionHeader: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
    color: colors.black,
    letterSpacing: 0.4,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.white,
    borderRadius: r(16),
    borderWidth: 1,
    borderColor: withAlpha(colors.grey, 0.2),
  },
  gallery: {
    height: h(180),
  },
  galleryContent: {
    alignItems: 'center',
  },
  thumbSpacing: {
    marginLeft: r(12),
  },
  thumbWrap: {
    width: w(200),
    height: h(180),
    borderRadius: r(12),
    overflow: 'hidden',
    backgroundColor: colors.secondary200,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary200,
  },
  thumbFallback: {
    width: w(200),
    height: h(180),
    borderRadius: r(12),
    backgroundColor: colors.secondary200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerBackdrop: {
    flex: 1,
    // Dart used a transparent Dialog over the scrim; the scrim is explicit here.
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    padding: r(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
    borderRadius: r(16),
  },
  viewerClose: {
    position: 'absolute',
    top: r(24),
    right: r(24),
    width: r(32),
    height: r(32),
    borderRadius: r(32),
    // Dart: Colors.black54
    backgroundColor: 'rgba(0, 0, 0, 0.54)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
