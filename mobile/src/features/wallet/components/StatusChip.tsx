/**
 * Status pill — ports the two chip widgets in the wallet module, which used
 * different colour maps and sizes:
 *
 *   wallet_transaction_details_view.dart `_StatusChip`      -> size="large"
 *     completed -> success, pending -> orange700,
 *     failed|reversed -> failure, default -> grey
 *     14w/6h padding, radius 20, 11sp w700, letterSpacing 0.6
 *
 *   settlement_history_view.dart `_SettlementItem` chip     -> size="small"
 *     approved -> success, rejected -> failure, pending|default -> orange700
 *     8w/3h padding, radius 20, 9sp w700, letterSpacing 0.5
 *
 * Both render `status.toUpperCase()` on a 12 %-alpha tint of the status colour.
 *
 * NOTE — `resolveStatusColor` in core/utils/format.ts covers the *settlement*
 * map (approved/rejected/pending) and is reused for it. The transaction map
 * (completed/failed/reversed) has no core equivalent, so it stays here.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin, w } from '../../../core/theme/responsive';
import { fontWeights } from '../../../core/theme/typography';
import { resolveStatusColor } from '../../../core/utils/format';
import { withAlpha } from '../utils/color';

/** Which colour map to apply — transactions and settlements differ. */
export type StatusPalette = 'transaction' | 'settlement';

/** `_StatusChip._color` / `_SettlementItem._statusColor` */
export function statusColor(
  status: string | null | undefined,
  palette: StatusPalette,
): string {
  if (palette === 'settlement') {
    // `resolveStatusColor` already maps approved -> success,
    // rejected -> failure and pending -> orange700. The Dart `default` branch
    // fell through to pending's orange, which it also does.
    const value = (status ?? '').toLowerCase();
    if (value === 'approved' || value === 'rejected') return resolveStatusColor(value);
    return colors.orange700;
  }

  switch ((status ?? '').toLowerCase()) {
    case 'completed':
      return colors.success;
    case 'pending':
      return colors.orange700;
    case 'failed':
    case 'reversed':
      return colors.failure;
    default:
      return colors.grey;
  }
}

export interface StatusChipProps {
  status: string | null | undefined;
  palette?: StatusPalette;
  /** `large` = the details hero chip, `small` = the settlement row chip. */
  size?: 'large' | 'small';
}

export function StatusChip({
  status,
  palette = 'transaction',
  size = 'large',
}: StatusChipProps) {
  const color = statusColor(status, palette);
  const isLarge = size === 'large';

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: withAlpha(color, 0.12),
          paddingHorizontal: isLarge ? w(14) : w(8),
          paddingVertical: isLarge ? h(6) : h(3),
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color,
            fontSize: isLarge ? spMin(11) : spMin(9),
            letterSpacing: isLarge ? 0.6 : 0.5,
          },
        ]}
      >
        {(status ?? '').toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: r(20),
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
});
