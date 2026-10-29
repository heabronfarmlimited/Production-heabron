/**
 * Text styles — ported from lib/src/core/utils/app_theme.dart (`_lightTextTheme`)
 * and the `withColor` / `.bold` helpers in extensions/text_style_extension.dart.
 *
 * Every size uses `spMin` because the Dart theme declares them with `.spMin`.
 * `bodySmall` is the one exception — it is a plain `const 12` in Dart (no
 * scaling), so it is kept unscaled here to match exactly.
 */
import type { TextStyle } from 'react-native';

import { colors } from './colors';
import { spMin } from './responsive';

/** pubspec.yaml registers the family as `Manrope`. */
export const FONT_FAMILY = 'Manrope';

/**
 * Manrope ships as a variable font plus static instances. React Native needs a
 * concrete face per weight, so these names must match the files registered in
 * `src/assets/fonts` (and linked via react-native.config.js / expo-font).
 */
export const fontWeights = {
  extraLight: 'Manrope-ExtraLight',
  light: 'Manrope-Light',
  regular: 'Manrope-Regular',
  medium: 'Manrope-Medium',
  semiBold: 'Manrope-SemiBold',
  bold: 'Manrope-Bold',
  extraBold: 'Manrope-ExtraBold',
} as const;

/**
 * Maps a Flutter FontWeight to the matching static Manrope face.
 * w400 -> Regular, w500 -> Medium, w600 -> SemiBold, w700 -> Bold.
 */
export const weightToFamily = {
  '200': fontWeights.extraLight,
  '300': fontWeights.light,
  '400': fontWeights.regular,
  '500': fontWeights.medium,
  '600': fontWeights.semiBold,
  '700': fontWeights.bold,
  '800': fontWeights.extraBold,
} as const;

type Weight = keyof typeof weightToFamily;

const style = (
  size: number,
  weight: Weight,
  color: string = colors.secondaryBlack600,
  scaled = true,
): TextStyle => ({
  fontSize: scaled ? spMin(size) : size,
  fontFamily: weightToFamily[weight],
  fontWeight: weight,
  color,
});

/**
 * Direct equivalents of Flutter's TextTheme slots, so a widget that used
 * `context.textTheme.bodyMedium` maps to `textTheme.bodyMedium` here.
 *
 * These are getters: `spMin` reads live screen dimensions, so evaluating them
 * lazily keeps the styles correct after a rotation.
 */
export const textTheme = {
  get headlineLarge(): TextStyle {
    return style(30, '700');
  },
  get headlineMedium(): TextStyle {
    return style(26, '600');
  },
  get headlineSmall(): TextStyle {
    return style(24, '700');
  },
  get bodyLarge(): TextStyle {
    return style(18, '400');
  },
  get bodyMedium(): TextStyle {
    return style(14, '400');
  },
  /** Dart declares this as a plain `const 12` — intentionally unscaled. */
  get bodySmall(): TextStyle {
    return style(12, '400', colors.secondaryBlack600, false);
  },
  get titleLarge(): TextStyle {
    return style(14, '400');
  },
  get titleMedium(): TextStyle {
    return style(20, '600');
  },
  get titleSmall(): TextStyle {
    return style(14, '400');
  },
  /**
   * `labelMedium` is not declared in `_lightTextTheme` but is referenced by
   * `context.formTitleStyle` (`textTheme.labelMedium?.bold`), so it falls
   * through to Flutter's Material default of 12/w500 — reproduced here.
   */
  get labelMedium(): TextStyle {
    return style(12, '500');
  },
} as const;

/**
 * Ports of the semantic getters in context_extension.dart, so screen code can
 * keep using the same vocabulary it used in Dart.
 */
export const textStyles = {
  get appTitle(): TextStyle {
    return textTheme.headlineMedium;
  },
  get appBar(): TextStyle {
    return textTheme.headlineSmall;
  },
  /** `bodyMedium.withColor(colorScheme.onSurfaceVariant)` */
  get appBody(): TextStyle {
    return { ...textTheme.bodyMedium, color: colors.grey };
  },
  /** `bodyMedium.withColor(colorScheme.primary).bold` */
  get appBodyPrimary(): TextStyle {
    return {
      ...textTheme.bodyMedium,
      color: colors.primary,
      fontFamily: fontWeights.bold,
      fontWeight: '700',
    };
  },
  /** `labelMedium.bold` */
  get formTitle(): TextStyle {
    return {
      ...textTheme.labelMedium,
      fontFamily: fontWeights.bold,
      fontWeight: '700',
    };
  },
  /** `titleLarge.bold` */
  get modalTitle(): TextStyle {
    return {
      ...textTheme.titleLarge,
      fontFamily: fontWeights.bold,
      fontWeight: '700',
    };
  },
} as const;

/** Equivalent of `TextStyle.copyWith(color:)` — text_style_extension.dart. */
export const withColor = (base: TextStyle, color: string): TextStyle => ({
  ...base,
  color,
});

/** Equivalent of the `.bold` extension getter. */
export const bold = (base: TextStyle): TextStyle => ({
  ...base,
  fontFamily: fontWeights.bold,
  fontWeight: '700',
});

/**
 * Equivalent of the `.semiBold` extension getter.
 *
 * NOTE — the Dart original is a bug:
 *   `TextStyle get semiBold => copyWith(fontWeight: FontWeight.w400);`
 * w400 is *regular*, so `.semiBold` in the Flutter app renders no heavier than
 * normal text. This port implements the intended w600. Any screen that looked
 * correct in Flutter only because `.semiBold` was a no-op will now render
 * genuinely semi-bold — which is the design intent per the Manrope weights
 * registered in pubspec.yaml.
 */
export const semiBold = (base: TextStyle): TextStyle => ({
  ...base,
  fontFamily: fontWeights.semiBold,
  fontWeight: '600',
});

/** `.thin` — FontWeight.w100; Manrope's lightest registered face is ExtraLight. */
export const thin = (base: TextStyle): TextStyle => ({
  ...base,
  fontFamily: fontWeights.extraLight,
  fontWeight: '200',
});

/** `.bolder` — FontWeight.w900; maps to the ExtraBold face. */
export const bolder = (base: TextStyle): TextStyle => ({
  ...base,
  fontFamily: fontWeights.extraBold,
  fontWeight: '800',
});

/** `.italicize` */
export const italicize = (base: TextStyle): TextStyle => ({
  ...base,
  fontStyle: 'italic',
});

/**
 * `.withNaira` — the Dart original switches to Roboto so the ₦ glyph renders,
 * because Manrope has no Naira sign. Using the platform default font achieves
 * the same thing on both iOS and Android.
 */
export const withNaira = (base: TextStyle): TextStyle => ({
  ...base,
  fontFamily: undefined,
});
