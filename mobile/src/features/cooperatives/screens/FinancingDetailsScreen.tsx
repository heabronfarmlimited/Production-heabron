/**
 * "Financing Details" — ported from
 * .../view/financing/financing_details_view.dart (`financing_details_view`)
 *
 * The nine sections, in Dart order: the header (avatar, farmer name,
 * cooperative name, a conditional 'Cycle N' badge), 'Financing Status',
 * 'Loan Information', 'Repayment', 'Disbursement', 'Partner Decision'
 * (rendered only when `partnerDecision` is set), 'Admin Review',
 * 'Tier & Credit Info' and 'Timeline'. Every absent value renders as the
 * em-dash the Dart formatters produced.
 *
 * FIXED — the Dart screen was handed the list row through route arguments
 * (`args['item']`), so it could only show the columns the *list* query
 * selected and never reflected an admin decision made after the list loaded.
 * It takes an id and reads `GET /agent/financing-requests/:id`, which embeds
 * the full cooperative, farmer and repayment records. The
 * `'Invalid financing details data.'` guard is kept for a missing record.
 *
 * NOTE — `disbursementAccountDetails` and `disbursementProofUrls` are parsed
 * but not rendered, matching the Dart screen. They are the admin's manual
 * transfer evidence; whether a field agent should see them is a product
 * decision, so the audit's section list is followed rather than guessed at.
 */
import { format, parseISO } from 'date-fns';
import { StyleSheet, Text, View } from 'react-native';

import { AppSkeleton } from '../../../components/AppSkeleton';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatNaira, titleCase } from '../../../core/utils/format';
import { PersonAvatarPlaceholder } from '../../auth/components/FieldIcons';
import {
  DetailRow,
  DetailSection,
  SectionHeader,
} from '../components/DetailSection';
import { EmptyState } from '../components/EmptyState';
import { statusTint } from '../components/statusTint';
import { TierCard } from '../components/TierCard';
import { useFinancingRequest } from '../hooks/useFinancing';
import { outstandingAmount, type FinancingHistoryItem } from '../model/financing';

/** Dart fell back to an em-dash for every unset value. */
const DASH = '—';

/** `NumberFormat('#,##0', 'en_NG')` prefixed with the Naira sign. */
const currency = (value?: number | null): string =>
  value != null ? formatNaira(value, { decimals: false }) : DASH;

/** `DateFormat('dd MMM, yyyy')`, local time. */
const fmtDate = (iso?: string | null): string => {
  const d = toDate(iso);
  return d ? format(d, 'dd MMM, yyyy') : DASH;
};

/** `DateFormat('dd MMM, yyyy • hh:mm a')`, local time. */
const fmtDateTime = (iso?: string | null): string => {
  const d = toDate(iso);
  return d ? format(d, "dd MMM, yyyy • hh:mm a") : DASH;
};

function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

const orDash = (value?: string | null, transform = (v: string) => v): string =>
  value && value.trim().length > 0 ? transform(value) : DASH;

export interface FinancingDetailsScreenProps {
  id: string;
}

export function FinancingDetailsScreen({ id }: FinancingDetailsScreenProps) {
  const { data: item, isLoading, isError } = useFinancingRequest(id);

  if (isLoading && !item) {
    return <AppSkeleton isBusy appBarTitle="Financing Details" />;
  }

  if (isError || !item) {
    return (
      <AppSkeleton appBarTitle="Financing Details">
        <EmptyState text="Invalid financing details data." />
      </AppSkeleton>
    );
  }

  return (
    <AppSkeleton appBarTitle="Financing Details" scrollable>
      <FinancingDetailsBody item={item} />
    </AppSkeleton>
  );
}

function FinancingDetailsBody({ item }: { item: FinancingHistoryItem }) {
  const tint = statusTint(item.status);

  const farmerName = item.farmer?.fullName ?? item.farmerName ?? 'Unknown Farmer';
  const farmerTier = item.farmer?.creditTier ?? DASH;
  const coopName = item.cooperative?.name ?? item.cooperativeName ?? DASH;
  const coopTier = item.cooperative?.cooperativeTier ?? DASH;
  const coopScore = item.cooperative?.averageCreditScore ?? null;

  return (
    <View>
      {/* ── 1. Header ──────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <PersonAvatarPlaceholder size={56} />

        <View style={{ width: r(16) }} />

        <View style={styles.headerText}>
          <Text style={styles.farmerName} numberOfLines={2}>
            {titleCase(farmerName)}
          </Text>
          <View style={{ height: h(4) }} />
          <Text style={styles.coopName} numberOfLines={1}>
            {coopName === DASH ? DASH : titleCase(coopName)}
          </Text>
        </View>

        {item.cycleNumber != null ? (
          <View style={styles.cycleBadge}>
            <Text style={styles.cycleText}>{`Cycle ${item.cycleNumber}`}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ height: h(24) }} />

      {/* ── 2. Status ──────────────────────────────────────────── */}
      <DetailSection
        label="Financing Status"
        value={item.status ? titleCase(item.status) : DASH}
        valueColor={tint.color}
        bgColor={tint.backgroundColor}
        borderColor="transparent"
      />

      <View style={{ height: h(20) }} />

      {/* ── 3. Loan information ────────────────────────────────── */}
      <SectionHeader title="Loan Information" />
      <View style={{ height: h(12) }} />

      <DetailRow>
        <DetailSection label="Requested Amount" value={currency(item.amount)} />
        <DetailSection
          label="Approved Amount"
          value={currency(item.approvedAmount)}
        />
      </DetailRow>

      <View style={{ height: h(16) }} />

      <DetailRow>
        <DetailSection label="Purpose" value={orDash(item.purpose, titleCase)} />
        <DetailSection label="Season" value={orDash(item.season, titleCase)} />
      </DetailRow>

      <View style={{ height: h(16) }} />

      <DetailRow>
        <DetailSection
          label="Repayment Window"
          value={
            item.repaymentWindowDays != null
              ? `${item.repaymentWindowDays} days`
              : DASH
          }
        />
        <DetailSection label="Due Date" value={fmtDate(item.dueDate)} />
      </DetailRow>

      <View style={{ height: h(24) }} />

      {/* ── 4. Repayment ───────────────────────────────────────── */}
      <SectionHeader title="Repayment" />
      <View style={{ height: h(12) }} />

      <DetailRow>
        <DetailSection
          label="Total Repaid"
          value={currency(item.totalRepaid)}
          valueColor={colors.success}
        />
        <DetailSection
          label="Outstanding"
          value={currency(outstandingAmount(item))}
        />
      </DetailRow>

      <View style={{ height: h(24) }} />

      {/* ── 5. Disbursement ────────────────────────────────────── */}
      <SectionHeader title="Disbursement" />
      <View style={{ height: h(12) }} />

      <DetailRow>
        <DetailSection
          label="Disbursed Amount"
          value={currency(item.disbursedAmount)}
        />
        <DetailSection
          label="Disbursed At"
          value={fmtDateTime(item.disbursedAt)}
        />
      </DetailRow>

      {item.disbursementReference ? (
        <>
          <View style={{ height: h(16) }} />
          <DetailSection
            label="Disbursement Reference"
            value={item.disbursementReference}
          />
        </>
      ) : null}

      <View style={{ height: h(24) }} />

      {/* ── 6. Partner decision (conditional) ──────────────────── */}
      {item.partnerDecision ? (
        <>
          <SectionHeader title="Partner Decision" />
          <View style={{ height: h(12) }} />

          <DetailRow>
            <DetailSection
              label="Decision"
              value={titleCase(item.partnerDecision)}
              // Dart used alpha 0.10 here, not the 0.14 of the status pill.
              valueColor={statusTint(item.partnerDecision, 0.1).color}
              bgColor={statusTint(item.partnerDecision, 0.1).backgroundColor}
              borderColor="transparent"
            />
            <DetailSection
              label="Decision Date"
              value={fmtDateTime(item.partnerDecisionAt)}
            />
          </DetailRow>

          {item.partnerComments ? (
            <>
              <View style={{ height: h(16) }} />
              <DetailSection
                label="Partner Comments"
                value={item.partnerComments}
                valueColor={colors.grey}
              />
            </>
          ) : null}

          <View style={{ height: h(24) }} />
        </>
      ) : null}

      {/* ── 7. Admin review ────────────────────────────────────── */}
      <SectionHeader title="Admin Review" />
      <View style={{ height: h(12) }} />

      {item.adminComments ? (
        <>
          <DetailSection
            label="Admin Comments"
            value={item.adminComments}
            valueColor={colors.grey}
          />
          <View style={{ height: h(16) }} />
        </>
      ) : null}

      {item.rejectionReason ? (
        <>
          <DetailSection
            label="Rejection Reason"
            value={item.rejectionReason}
            valueColor={colors.failure}
            // Dart: AppColors.failure.withValues(alpha: 0.08)
            bgColor="rgba(244, 67, 54, 0.08)"
            borderColor="transparent"
          />
          <View style={{ height: h(16) }} />
        </>
      ) : null}

      {!item.adminComments && !item.rejectionReason ? (
        <DetailSection
          label="Admin Comments"
          value={DASH}
          valueColor={colors.grey}
        />
      ) : null}

      <View style={{ height: h(24) }} />

      {/* ── 8. Tier & credit info ──────────────────────────────── */}
      <SectionHeader title="Tier & Credit Info" />
      <View style={{ height: h(12) }} />

      <DetailRow>
        <TierCard
          title="Farmer Tier"
          tier={farmerTier}
          subtitle={titleCase(farmerName)}
        />
        <TierCard
          title="Coop Tier"
          tier={coopTier}
          subtitle={
            coopScore != null
              ? `Avg score: ${coopScore.toFixed(1)}`
              : coopName === DASH
                ? DASH
                : titleCase(coopName)
          }
        />
      </DetailRow>

      <View style={{ height: h(24) }} />

      {/* ── 9. Timeline ────────────────────────────────────────── */}
      <SectionHeader title="Timeline" />
      <View style={{ height: h(12) }} />

      <DetailRow>
        <DetailSection label="Submitted" value={fmtDateTime(item.date)} />
        <DetailSection label="Last Updated" value={fmtDateTime(item.updatedAt)} />
      </DetailRow>

      <View style={{ height: h(32) }} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  farmerName: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  coopName: {
    ...textTheme.bodySmall,
    fontSize: spMin(13),
    color: colors.grey,
  },
  cycleBadge: {
    paddingHorizontal: r(10),
    paddingVertical: r(4),
    borderRadius: r(8),
    backgroundColor: colors.secondary200,
    marginLeft: r(8),
  },
  cycleText: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.grey,
  },
});
