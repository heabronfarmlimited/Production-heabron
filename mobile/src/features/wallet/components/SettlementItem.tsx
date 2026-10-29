/**
 * Settlement list row — ports `_SettlementItem` from
 * settlement_history_view.dart.
 *
 * Layout: 14r vertical padding, a 44r rounded-square (radius 12) status bubble
 * tinted 12 %, then bank name (13sp w500, 1 line), account number (11sp grey),
 * created date `dd MMM, yyyy` (10sp grey) and — only when present — the admin
 * note in an 8 %-tinted 6r box, italic, 10sp, max 2 lines. The right column
 * holds the amount (14sp w600) over the uppercase status chip.
 *
 * Status icon map: approved -> check_circle_outline, rejected ->
 * cancel_outlined, pending/default -> hourglass_top_outlined.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin, w } from '../../../core/theme/responsive';
import { fontWeights, textTheme, withNaira } from '../../../core/theme/typography';
import { formatNaira } from '../../../core/utils/format';
import type { SettlementRequest } from '../model/settlementRequest';
import { withAlpha } from '../utils/color';
import { formatDayMonthYear } from '../utils/format';

import { StatusChip, statusColor } from './StatusChip';
import { CancelIcon, CheckCircleIcon, HourglassIcon } from './WalletIcons';

function StatusIcon({ status, color }: { status: string | null; color: string }) {
  switch ((status ?? '').toLowerCase()) {
    case 'approved':
      return <CheckCircleIcon color={color} size={22} />;
    case 'rejected':
      return <CancelIcon color={color} size={22} />;
    // Dart: `case 'pending': default:`
    default:
      return <HourglassIcon color={color} size={22} />;
  }
}

export interface SettlementItemProps {
  item: SettlementRequest;
}

export function SettlementItem({ item }: SettlementItemProps) {
  const color = statusColor(item.status, 'settlement');
  const hasNote = Boolean(item.adminNotes && item.adminNotes.length > 0);

  return (
    <View style={styles.row}>
      <View style={[styles.bubble, { backgroundColor: withAlpha(color, 0.12) }]}>
        <StatusIcon status={item.status} color={color} />
      </View>

      <View style={styles.details}>
        <Text style={styles.bank} numberOfLines={1}>
          {item.bankName ?? 'Bank Transfer'}
        </Text>
        <View style={styles.gap4} />
        <Text style={styles.account}>{item.accountNumber ?? '—'}</Text>
        <View style={styles.gap4} />
        <Text style={styles.date}>{formatDayMonthYear(item.createdAt)}</Text>

        {hasNote ? (
          <>
            <View style={styles.gap6} />
            <View style={[styles.note, { backgroundColor: withAlpha(color, 0.08) }]}>
              <Text style={[styles.noteText, { color }]} numberOfLines={2}>
                {item.adminNotes}
              </Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.trailing}>
        <Text style={styles.amount}>{formatNaira(item.amount)}</Text>
        <View style={styles.gap6} />
        {/* Dart: `(item.status ?? 'pending').toUpperCase()` */}
        <StatusChip status={item.status ?? 'pending'} palette="settlement" size="small" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: r(14),
  },
  bubble: {
    width: r(44),
    height: r(44),
    borderRadius: r(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    flex: 1,
    marginLeft: r(14),
  },
  trailing: {
    alignItems: 'flex-end',
    marginLeft: r(16),
  },
  gap4: {
    height: r(4),
  },
  gap6: {
    height: r(6),
  },
  bank: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  account: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.grey,
  },
  date: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    color: colors.grey,
  },
  note: {
    paddingHorizontal: w(8),
    paddingVertical: h(4),
    borderRadius: r(6),
  },
  noteText: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    fontStyle: 'italic',
  },
  amount: {
    ...withNaira(textTheme.bodyMedium),
    fontSize: spMin(14),
    fontWeight: '600',
  },
});
