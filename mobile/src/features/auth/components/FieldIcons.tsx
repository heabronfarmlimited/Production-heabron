/**
 * Field prefix icons — stand-ins for the Material icons the Flutter forms used
 * as `prefixWidget`, drawn with views and text so no icon font or SVG asset is
 * required. All render at the Dart grey (`AppColors.grey`).
 *
 * Mapping to the Dart icons:
 *   Icons.email                -> EmailIcon
 *   Icons.password / lock      -> PasswordIcon
 *   Icons.person               -> PersonIcon
 *   Icons.phone                -> PhoneIcon
 *   Icons.badge_outlined       -> BadgeIcon
 *   Icons.calendar_today       -> CalendarIcon
 *   Icons.search               -> SearchIcon
 *   Icons.account_balance      -> BankIcon
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';

interface IconProps {
  color?: string;
  size?: number;
}

function Glyph({ char, color = colors.grey, size = 18 }: IconProps & { char: string }) {
  return (
    <Text style={[styles.glyph, { color, fontSize: spMin(size) }]} accessible={false}>
      {char}
    </Text>
  );
}

export const EmailIcon = (p: IconProps) => <Glyph char="✉" {...p} />;
export const PasswordIcon = (p: IconProps) => <Glyph char="🔒" {...p} />;
export const PersonIcon = (p: IconProps) => <Glyph char="👤" {...p} />;
export const PhoneIcon = (p: IconProps) => <Glyph char="📞" {...p} />;
export const BadgeIcon = (p: IconProps) => <Glyph char="🪪" {...p} />;
export const CalendarIcon = (p: IconProps) => <Glyph char="📅" {...p} />;
export const SearchIcon = (p: IconProps) => <Glyph char="🔍" {...p} />;
export const BankIcon = (p: IconProps) => <Glyph char="🏦" {...p} />;
export const CameraIcon = (p: IconProps) => <Glyph char="📷" {...p} />;
export const NairaPrefix = ({ color = colors.primary }: IconProps) => (
  <Text style={[styles.naira, { color }]}>₦</Text>
);

/** A simple circular avatar placeholder — Dart used `Icons.person` at 48. */
export function PersonAvatarPlaceholder({ size = 48 }: { size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: r(size), height: r(size), borderRadius: r(size) },
      ]}
    >
      <Glyph char="👤" size={size * 0.45} />
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: {
    textAlign: 'center',
  },
  naira: {
    fontSize: spMin(16),
    fontWeight: '600',
  },
  avatar: {
    backgroundColor: colors.secondary100,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
