/**
 * Glyph icons for the wallet screens, in the same style as
 * features/auth/components/FieldIcons.tsx — drawn with text so no icon font or
 * SVG asset is needed.
 *
 * Mapping to the Dart `Icons.*` each one replaces:
 *   Icons.arrow_downward                -> ArrowDownIcon   (credit)
 *   Icons.arrow_upward                  -> ArrowUpIcon     (debit)
 *   Icons.visibility_outlined           -> EyeIcon
 *   Icons.visibility_off_outlined       -> EyeOffIcon
 *   Icons.account_balance_wallet_rounded-> WalletIcon
 *   Icons.history                       -> HistoryIcon
 *   Icons.warning_amber_rounded         -> WarningIcon
 *   Icons.check_circle_outline          -> CheckCircleIcon (settlement approved)
 *   Icons.cancel_outlined               -> CancelIcon      (settlement rejected)
 *   Icons.hourglass_top_outlined        -> HourglassIcon   (settlement pending)
 *   Icons.receipt_long_outlined         -> ReceiptIcon     (empty state)
 *   Icons.close                         -> CloseIcon       (image viewer)
 *   Icons.broken_image_outlined         -> BrokenImageIcon
 *
 * `Icons.account_balance_outlined` reuses `BankIcon` from FieldIcons.
 */
import { StyleSheet, Text } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { spMin } from '../../../core/theme/responsive';

export interface WalletIconProps {
  color?: string;
  size?: number;
}

function Glyph({
  char,
  color = colors.grey,
  size = 18,
}: WalletIconProps & { char: string }) {
  return (
    <Text
      style={[styles.glyph, { color, fontSize: spMin(size) }]}
      accessible={false}
      allowFontScaling={false}
    >
      {char}
    </Text>
  );
}

export const ArrowDownIcon = (p: WalletIconProps) => <Glyph char="↓" {...p} />;
export const ArrowUpIcon = (p: WalletIconProps) => <Glyph char="↑" {...p} />;
export const EyeIcon = (p: WalletIconProps) => <Glyph char="👁" {...p} />;
export const EyeOffIcon = (p: WalletIconProps) => <Glyph char="🙈" {...p} />;
export const WalletIcon = (p: WalletIconProps) => <Glyph char="👛" {...p} />;
export const HistoryIcon = (p: WalletIconProps) => <Glyph char="🕘" {...p} />;
export const WarningIcon = (p: WalletIconProps) => <Glyph char="⚠" {...p} />;
export const CheckCircleIcon = (p: WalletIconProps) => <Glyph char="✓" {...p} />;
export const CancelIcon = (p: WalletIconProps) => <Glyph char="✕" {...p} />;
export const HourglassIcon = (p: WalletIconProps) => <Glyph char="⏳" {...p} />;
export const ReceiptIcon = (p: WalletIconProps) => <Glyph char="🧾" {...p} />;
export const CloseIcon = (p: WalletIconProps) => <Glyph char="✕" {...p} />;
export const BrokenImageIcon = (p: WalletIconProps) => <Glyph char="🖼" {...p} />;

const styles = StyleSheet.create({
  glyph: {
    textAlign: 'center',
  },
});
