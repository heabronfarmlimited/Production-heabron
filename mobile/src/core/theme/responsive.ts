/**
 * Responsive scaling — replaces `flutter_screenutil`.
 *
 * app.dart declares:
 *   ScreenUtilInit(designSize: Size(383, 852), minTextAdapt: true, splitScreenMode: true)
 *
 * The Dart call sites use four suffixes, each mapped to a function here:
 *   `.w`    -> scaleWidth   (scale against design width)
 *   `.h`    -> scaleHeight  (scale against design height)
 *   `.r`    -> scaleRadius  (scale by the smaller of the two ratios)
 *   `.sp`   -> scaleFont    (font scale)
 *   `.spMin`-> scaleFontMin (font scale, capped at 1 — `minTextAdapt: true`)
 */
import type { ScaledSize } from 'react-native';
import { Dimensions, PixelRatio } from 'react-native';

/** designSize from app.dart — do not change without checking every call site. */
export const DESIGN_WIDTH = 383;
export const DESIGN_HEIGHT = 852;

let screen: ScaledSize = Dimensions.get('window');

/**
 * Keeps the cached dimensions fresh on rotation / split-screen / fold.
 * Call `subscribeToDimensions()` once at app start.
 */
export function subscribeToDimensions(): () => void {
  const sub = Dimensions.addEventListener('change', ({ window }) => {
    screen = window;
  });
  return () => sub.remove();
}

const widthRatio = () => screen.width / DESIGN_WIDTH;
const heightRatio = () => screen.height / DESIGN_HEIGHT;

/** `.w` — scales a width/horizontal value. */
export const scaleWidth = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * widthRatio());

/** `.h` — scales a height/vertical value. */
export const scaleHeight = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * heightRatio());

/** `.r` — scales radii/padding by the smaller ratio so shapes stay round. */
export const scaleRadius = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * Math.min(widthRatio(), heightRatio()));

/** `.sp` — scales a font size. */
export const scaleFont = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * Math.min(widthRatio(), heightRatio()));

/**
 * `.spMin` — font scale capped at 1x.
 *
 * `minTextAdapt: true` in Flutter means text never scales *up* past the design
 * size, so large screens keep readable (not ballooned) type. The Dart theme
 * uses `.spMin` for every text style, so this is the common path.
 */
export const scaleFontMin = (size: number): number =>
  PixelRatio.roundToNearestPixel(
    size * Math.min(1, Math.min(widthRatio(), heightRatio())),
  );

/** Short aliases that read closer to the original Dart call sites. */
export const w = scaleWidth;
export const h = scaleHeight;
export const r = scaleRadius;
export const sp = scaleFont;
export const spMin = scaleFontMin;

/** context_extension.dart: `bool get isTablet => width >= 600` */
export const isTablet = (): boolean => screen.width >= 600;

/** context_extension.dart: `width` / `height` */
export const screenWidth = (): number => screen.width;
export const screenHeight = (): number => screen.height;
