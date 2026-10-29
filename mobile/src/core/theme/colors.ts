/**
 * Color tokens — ported 1:1 from lib/src/core/utils/app_colors.dart
 *
 * Flutter `Color(0xAARRGGBB)` and `Color.fromRGBO(r,g,b,a)` are both
 * normalised here to CSS-style strings so they can be used directly in
 * React Native style objects.
 */

export const colors = {
  /** Brand green — Color(0xFF2E8B57) */
  primary: '#2E8B57',

  /** Color.fromRGBO(255, 197, 111, 0.46) */
  secondary: 'rgba(255, 197, 111, 0.46)',
  /** Color.fromRGBO(135, 84, 14, 1) */
  secondaryDeep: '#87540E',

  background: '#FFFFFF',

  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',

  secondaryTextColor: '#9DB8A6',
  grey: '#6B7280',
  /** Color.fromRGBO(55, 65, 81, 1) */
  greyDeep: '#374151',
  border: '#D9D9D9',
  primaryLight: '#FEEFB8',
  success: '#1EAD60',
  /** Flutter `Colors.red` */
  failure: '#F44336',
  warning: '#FFC107',

  secondary100: '#F2F2F2',
  secondary200: '#E4E4E4',
  secondary400: '#A2A2A2',
  secondaryBlack600: '#000000',
  textLight: '#131313',

  /** Flutter Colors.* used directly in helper.dart status resolvers */
  orange: '#FF9800',
  orange700: '#F57C00',
  yellow: '#FFEB3B',
  green: '#4CAF50',
  red: '#F44336',
} as const;

export type AppColor = (typeof colors)[keyof typeof colors];

/**
 * Port of AppColors.appBoxShadow —
 * BoxShadow(color: #000 @ 20%, offset: (0,1), blurRadius: 21, spreadRadius: -8)
 *
 * React Native has no spreadRadius, so the blur is reduced by the spread to
 * approximate the same visual footprint. `elevation` covers Android.
 */
export const appBoxShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.2,
  shadowRadius: 13, // 21 blur - 8 spread
  elevation: 4,
} as const;

/** Normalises `#RRGGBB` / `RRGGBB` input, mirroring AppColors.getColorFromHex. */
export function getColorFromHex(hexColor: string): string {
  const hex = hexColor.toUpperCase().replace('#', '');
  return hex.length === 6 ? `#${hex}` : 'transparent';
}
