/**
 * Transaction list row — ports the two near-duplicate row builders:
 *
 *   wallet_view.dart `_buildTransactionItem`  -> variant="wallet"
 *     36r CIRCLE, 18r icon, title 12sp w400 **toTitleCase()**,
 *     subtitle 10sp w500 grey **replaceAll('_',' ').toTitleCase()**,
 *     time 12sp w500 grey, amount 12sp w400, 16r vertical padding,
 *     trailing divider unless `isLast`
 *
 *   transaction_history_view.dart item builder -> variant="history"
 *     44r ROUNDED SQUARE (radius 12), 22r icon, title 12sp w400 **raw**,
 *     subtitle 10sp w400 grey **raw**, time 10sp w400 grey,
 *     amount 14sp w500, 16r vertical padding, divider drawn by the list
 *
 * The casing difference is deliberate and preserved: the wallet list title-cases
 * both lines, the history list does not.
 *
 * FIXED — both Dart rows printed the amount with `toStringAsFixed(2)`, so a
 * six-figure balance read "123456.00" while the details screen used
 * `NumberFormat('#,##0.00')` and read "123,456.00". `formatNaira` is used
 * everywhere now, which is the grouped form.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme, withNaira } from '../../../core/theme/typography';
import { formatDateAndTime, formatNaira, titleCase } from '../../../core/utils/format';
import { isCredit, type WalletTransaction } from '../model/walletTransaction';
import { withAlpha } from '../utils/color';

import { ArrowDownIcon, ArrowUpIcon } from './WalletIcons';

export interface TransactionRowProps {
  transaction: WalletTransaction;
  /** `wallet` = the 36r circle on the tab root, `history` = the 44r square. */
  variant: 'wallet' | 'history';
  onPress?: (transaction: WalletTransaction) => void;
  /** Wallet variant only — suppresses the trailing divider on the last row. */
  isLast?: boolean;
}

export function TransactionRow({
  transaction,
  variant,
  onPress,
  isLast = false,
}: TransactionRowProps) {
  const credit = isCredit(transaction);
  const accent = credit ? colors.success : colors.failure;
  const prefix = credit ? '+' : '-';
  const isWallet = variant === 'wallet';

  // Dart fallbacks, identical in both views.
  const rawTitle = transaction.description ?? 'Transaction';
  const rawSubtitle = transaction.source ?? 'Wallet Transfer';

  const title = isWallet ? titleCase(rawTitle) : rawTitle;
  const subtitle = isWallet ? titleCase(rawSubtitle) : rawSubtitle;
  const time = transaction.createdAt ? formatDateAndTime(transaction.createdAt) : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${prefix}${formatNaira(transaction.amount)}`}
      onPress={onPress ? () => onPress(transaction) : undefined}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <View
          style={[
            styles.badge,
            {
              width: r(isWallet ? 36 : 44),
              height: r(isWallet ? 36 : 44),
              backgroundColor: withAlpha(accent, 0.12),
              borderRadius: isWallet ? r(36) : r(12),
            },
          ]}
        >
          {credit ? (
            <ArrowDownIcon color={accent} size={isWallet ? 18 : 22} />
          ) : (
            <ArrowUpIcon color={accent} size={isWallet ? 18 : 22} />
          )}
        </View>

        <View style={styles.texts}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.gap6} />
          <Text
            style={[
              styles.subtitle,
              isWallet ? styles.subtitleMedium : styles.subtitleRegular,
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
          <View style={styles.gap6} />
          <Text style={isWallet ? styles.timeWallet : styles.timeHistory}>{time}</Text>
        </View>

        <Text
          style={[
            isWallet ? styles.amountWallet : styles.amountHistory,
            { color: accent },
          ]}
        >
          {`${prefix}${formatNaira(transaction.amount)}`}
        </Text>
      </View>

      {isWallet && !isLast ? <View style={styles.divider} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: r(16),
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    marginLeft: r(14),
  },
  gap6: {
    height: r(6),
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(12),
    fontFamily: fontWeights.regular,
    fontWeight: '400',
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    color: colors.grey,
  },
  subtitleMedium: {
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  subtitleRegular: {
    fontFamily: fontWeights.regular,
    fontWeight: '400',
  },
  timeWallet: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.grey,
  },
  timeHistory: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    fontFamily: fontWeights.regular,
    fontWeight: '400',
    color: colors.grey,
  },
  amountWallet: {
    ...withNaira(textTheme.bodyMedium),
    fontSize: spMin(12),
    fontWeight: '400',
    marginLeft: r(8),
  },
  amountHistory: {
    ...withNaira(textTheme.bodyMedium),
    fontSize: spMin(14),
    fontWeight: '500',
    marginLeft: r(8),
  },
  divider: {
    height: 1,
    // Dart: AppColors.grey.withValues(alpha: 0.2)
    backgroundColor: withAlpha(colors.grey, 0.2),
  },
});
