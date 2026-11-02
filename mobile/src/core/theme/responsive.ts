/**
 * Responsive scaling — replaces `flutter_screenutil`.
 *
 * app.dart declared:
 *   ScreenUtilInit(designSize: Size(383, 852), minTextAdapt: true, splitScreenMode: true)
 *
 * The Dart call sites use four suffixes, each mapped to a function here:
 *   `.w`    -> scaleWidth   (scale against design width)
 *   `.h`    -> scaleHeight  (scale against design height)
 *   `.r`    -> scaleRadius  (scale by the smaller of the two ratios)
 *   `.sp`   -> scaleFont    (font scale)
 *   `.spMin`-> scaleFontMin (font scale, capped at 1 — `minTextAdapt: true`)
 *
 * The public API is unchanged; what changed is how far each ratio is allowed to
 * travel. See "Why the ratios are clamped" below.
 */
import type { ScaledSize } from 'react-native';
import { Dimensions, PixelRatio } from 'react-native';

/** designSize from app.dart — do not change without checking every call site. */
export const DESIGN_WIDTH = 383;
export const DESIGN_HEIGHT = 852;

/**
 * Why the ratios are clamped
 * --------------------------
 * The straight flutter_screenutil port multiplied by an unbounded ratio, which
 * misbehaved badly at the edges of the device range:
 *
 *   FONTS. `scaleFontMin` used min(widthRatio, heightRatio). The design height
 *   is 852 (iPhone 15), so on any SHORTER device the height ratio dominated and
 *   shrank every piece of text on the screen:
 *
 *       iPhone SE / 8   375x667   ->  0.78x   a 14px style rendered at 11.0px
 *       Android 360x640           ->  0.75x   a 14px style rendered at 10.5px
 *
 *   A body style at 10.5px on a budget Android — the device class this app is
 *   built for, used outdoors in sunlight — is not legible. Text wraps
 *   horizontally, so font size should follow WIDTH, not height. It now does,
 *   within a narrow band.
 *
 *   SPACING AND RADII. An unbounded ratio also distorts layout on tall, short
 *   and tablet-shaped screens. Each ratio is now bounded so a device at the
 *   extremes degrades gracefully instead of compounding.
 *
 * On the reference device (393x852) every ratio is ~1.0, so the design renders
 * exactly as drawn. Only devices away from the reference are corrected.
 */
const FONT_RATIO_MIN = 0.92;
const FONT_RATIO_MAX = 1.1;
const WIDTH_RATIO_MIN = 0.85;
const WIDTH_RATIO_MAX = 1.25;
const HEIGHT_RATIO_MIN = 0.85;
const HEIGHT_RATIO_MAX = 1.15;
const RADIUS_RATIO_MIN = 0.85;
const RADIUS_RATIO_MAX = 1.15;

/**
 * The largest OS font-scale multiplier the layouts are allowed to honour.
 *
 * Both platforms let a user enlarge text system-wide, and React Native applies
 * that multiplier to every `<Text>` on top of whatever `fontSize` we compute.
 * Accessibility settings must be respected, but an unbounded multiplier (iOS
 * accessibility sizes reach ~3.1x) overflows fixed-height rows and buttons.
 * Clamping keeps large-text users supported while the screen stays usable.
 *
 * Applied globally in `src/app/_layout.tsx`; see `MAX_FONT_SCALE`.
 */
export const MAX_FONT_SCALE = 1.3;

let screen: ScaledSize = Dimensions.get('window');

/**
 * Keeps the cached dimensions fresh on rotation / split-screen / fold.
 * Call `subscribeToDimensions()` once at app start.
 *
 * NOTE: values produced by the scale functions below are usually captured
 * inside `StyleSheet.create({...})`, which runs ONCE when the module is first
 * imported. Those styles therefore do NOT recompute when the window changes.
 * That is fine for rotation-locked phone screens, which is every screen here.
 * A screen that must adapt live (a foldable, split-screen, or a future tablet
 * layout) should read `useWindowDimensions()` from react-native and build its
 * styles inline.
 */
export function subscribeToDimensions(): () => void {
  const sub = Dimensions.addEventListener('change', ({ window }: { window: ScaledSize }) => {
    screen = window;
  });
  return () => sub.remove();
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const widthRatio = () => clamp(screen.width / DESIGN_WIDTH, WIDTH_RATIO_MIN, WIDTH_RATIO_MAX);
const heightRatio = () => clamp(screen.height / DESIGN_HEIGHT, HEIGHT_RATIO_MIN, HEIGHT_RATIO_MAX);
const radiusRatio = () =>
  clamp(
    Math.min(screen.width / DESIGN_WIDTH, screen.height / DESIGN_HEIGHT),
    RADIUS_RATIO_MIN,
    RADIUS_RATIO_MAX,
  );

/**
 * Font ratio follows WIDTH only — text wraps horizontally, so a short screen
 * is no reason to shrink it — bounded to a narrow band so type stays on the
 * design's scale across the whole device range.
 */
const fontRatio = () => clamp(screen.width / DESIGN_WIDTH, FONT_RATIO_MIN, FONT_RATIO_MAX);

/** `.w` — scales a width/horizontal value. */
export const scaleWidth = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * widthRatio());

/** `.h` — scales a height/vertical value. */
export const scaleHeight = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * heightRatio());

/** `.r` — scales radii/padding by the smaller ratio so shapes stay round. */
export const scaleRadius = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * radiusRatio());

/** `.sp` — scales a font size. */
export const scaleFont = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * fontRatio());

/**
 * `.spMin` — font scale that never exceeds the design size.
 *
 * `minTextAdapt: true` in Flutter means text never scales *up* past the design
 * size, so large screens keep readable (not ballooned) type. The Dart theme
 * used `.spMin` for every text style, so this is the common path.
 *
 * The cap at 1.0 is kept. What changed is the floor: it no longer follows the
 * height ratio down to 0.75x on a short screen.
 */
export const scaleFontMin = (size: number): number =>
  PixelRatio.roundToNearestPixel(size * Math.min(1, fontRatio()));

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

/** Test seam: lets the unit tests drive the scale functions deterministically. */
export function __setScreenForTest(next: ScaledSize): void {
  screen = next;
}
