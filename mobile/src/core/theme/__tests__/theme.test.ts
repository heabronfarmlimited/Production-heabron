/**
 * Design-token fidelity.
 *
 * The Flutter app is the design source of truth, so these assert the ported
 * values against the Dart originals in `app_colors.dart`, `app_theme.dart`
 * and `app.dart`. A drift here changes how every screen looks.
 */
import { appBoxShadow, colors, getColorFromHex } from '../colors';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  scaleFontMin,
  scaleRadius,
  scaleWidth,
} from '../responsive';
import { FONT_FAMILY, fontWeights, textTheme, weightToFamily } from '../typography';

describe('colour tokens match app_colors.dart', () => {
  it('keeps the brand green', () => {
    // Dart: static const primary = Color(0XFF2E8B57)
    expect(colors.primary).toBe('#2E8B57');
  });

  it('converts Color.fromRGBO values correctly', () => {
    // Dart: Color.fromRGBO(255, 197, 111, 0.46)
    expect(colors.secondary).toBe('rgba(255, 197, 111, 0.46)');
    // Dart: Color.fromRGBO(135, 84, 14, 1)
    expect(colors.secondaryDeep).toBe('#87540E');
    // Dart: Color.fromRGBO(55, 65, 81, 1)
    expect(colors.greyDeep).toBe('#374151');
  });

  it('keeps the greyscale and semantic tokens', () => {
    expect(colors.grey).toBe('#6B7280');
    expect(colors.border).toBe('#D9D9D9');
    expect(colors.success).toBe('#1EAD60');
    expect(colors.warning).toBe('#FFC107');
    expect(colors.primaryLight).toBe('#FEEFB8');
    expect(colors.textLight).toBe('#131313');
    expect(colors.secondary100).toBe('#F2F2F2');
    expect(colors.secondary200).toBe('#E4E4E4');
    expect(colors.secondary400).toBe('#A2A2A2');
    expect(colors.secondaryTextColor).toBe('#9DB8A6');
  });

  it('has a box shadow that approximates the Dart BoxShadow', () => {
    // Dart: #000 @ 20%, offset (0,1), blur 21, spread -8.
    // RN has no spreadRadius, so blur is reduced by the spread.
    expect(appBoxShadow.shadowOpacity).toBe(0.2);
    expect(appBoxShadow.shadowOffset).toEqual({ width: 0, height: 1 });
    expect(appBoxShadow.shadowRadius).toBe(13);
  });
});

describe('getColorFromHex', () => {
  it('normalises with and without a leading hash', () => {
    expect(getColorFromHex('#334155')).toBe('#334155');
    expect(getColorFromHex('334155')).toBe('#334155');
    expect(getColorFromHex('dee2e6')).toBe('#DEE2E6');
  });

  it('returns transparent for a malformed value, as the Dart helper did', () => {
    expect(getColorFromHex('xyz')).toBe('transparent');
  });
});

describe('responsive scaling matches ScreenUtilInit', () => {
  it('uses the design size declared in app.dart', () => {
    // Dart: designSize: const Size(383, 852)
    expect(DESIGN_WIDTH).toBe(383);
    expect(DESIGN_HEIGHT).toBe(852);
  });

  it('returns a finite scaled value for every helper', () => {
    [scaleWidth(16), scaleRadius(8), scaleFontMin(14)].forEach((v) => {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    });
  });

  it('never scales fonts above the design size', () => {
    // `minTextAdapt: true` means text scales down on small screens but never
    // up on large ones, so a 14sp style is at most 14.
    expect(scaleFontMin(14)).toBeLessThanOrEqual(14);
    expect(scaleFontMin(30)).toBeLessThanOrEqual(30);
  });
});

describe('typography matches app_theme.dart', () => {
  it('registers Manrope', () => {
    expect(FONT_FAMILY).toBe('Manrope');
  });

  it('maps every Flutter FontWeight to a static Manrope face', () => {
    expect(weightToFamily['400']).toBe(fontWeights.regular);
    expect(weightToFamily['500']).toBe(fontWeights.medium);
    expect(weightToFamily['600']).toBe(fontWeights.semiBold);
    expect(weightToFamily['700']).toBe(fontWeights.bold);
  });

  it('keeps the declared weight for each TextTheme slot', () => {
    // From `_lightTextTheme`.
    expect(textTheme.headlineLarge.fontWeight).toBe('700');
    expect(textTheme.headlineMedium.fontWeight).toBe('600');
    expect(textTheme.headlineSmall.fontWeight).toBe('700');
    expect(textTheme.bodyLarge.fontWeight).toBe('400');
    expect(textTheme.bodyMedium.fontWeight).toBe('400');
    expect(textTheme.titleMedium.fontWeight).toBe('600');
  });

  it('leaves bodySmall unscaled, as the Dart style was a plain const 12', () => {
    expect(textTheme.bodySmall.fontSize).toBe(12);
  });

  it('gives every slot a Manrope face so no style falls back to the system font', () => {
    Object.values(textTheme).forEach((style) => {
      expect(style.fontFamily).toMatch(/^Manrope-/);
    });
  });
});
