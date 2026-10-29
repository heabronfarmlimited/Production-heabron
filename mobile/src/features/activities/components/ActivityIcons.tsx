/**
 * Glyph icons for the activities screens, in the style of
 * features/auth/components/FieldIcons.tsx.
 *
 * Mapping to the Dart `Icons.*` each one replaces:
 *   Icons.account_balance_wallet  -> WalletIcon       (repayment card)
 *   Icons.upload_file             -> UploadIcon       (import, pending/empty)
 *   Icons.check_circle_outline    -> CheckCircleIcon  (import completed)
 *   Icons.error_outline           -> ErrorIcon        (import failed)
 *   Icons.warning_amber_rounded   -> WarningIcon      (import partial)
 *   Icons.local_shipping          -> TruckIcon        (delivery card — new)
 *   Icons.assignment_late_outlined-> AssignmentIcon   (empty state)
 *   Icons.search_off              -> SearchOffIcon    (no search results)
 *   Icons.arrow_back_ios_new      -> BackChevronIcon  (activity-log header)
 */
import { StyleSheet, Text } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { spMin } from '../../../core/theme/responsive';

export interface ActivityIconProps {
  color?: string;
  size?: number;
}

function Glyph({
  char,
  color = colors.grey,
  size = 20,
}: ActivityIconProps & { char: string }) {
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

export const WalletIcon = (p: ActivityIconProps) => <Glyph char="👛" {...p} />;
export const UploadIcon = (p: ActivityIconProps) => <Glyph char="⬆" {...p} />;
export const CheckCircleIcon = (p: ActivityIconProps) => <Glyph char="✓" {...p} />;
export const ErrorIcon = (p: ActivityIconProps) => <Glyph char="⊘" {...p} />;
export const WarningIcon = (p: ActivityIconProps) => <Glyph char="⚠" {...p} />;
export const TruckIcon = (p: ActivityIconProps) => <Glyph char="🚚" {...p} />;
export const AssignmentIcon = (p: ActivityIconProps) => <Glyph char="📋" {...p} />;
export const SearchOffIcon = (p: ActivityIconProps) => <Glyph char="🔎" {...p} />;
export const BackChevronIcon = (p: ActivityIconProps) => <Glyph char="‹" {...p} />;

const styles = StyleSheet.create({
  glyph: {
    textAlign: 'center',
  },
});
