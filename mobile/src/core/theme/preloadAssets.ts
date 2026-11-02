/**
 * Warming the local image assets before the first screen paints.
 *
 * THE PROBLEM THIS FIXES
 *
 * The splash used to lift as soon as the FONTS had loaded. The images had
 * not: `splash_bg`, `auth_bg`, `app_bar_bg`, the logo and the pre-auth icon
 * are bundled assets, and React Native resolves and decodes them lazily on
 * first render. So the first screen appeared with its layout in place and its
 * background a moment later — text and buttons on bare white, then the
 * artwork snapping in behind them. On a mid-range Android that read as the
 * app lagging, which is exactly what it was: work happening after the screen
 * was already in front of the agent instead of behind the splash, where there
 * is a loading indicator and nobody is waiting on anything.
 *
 * `Asset.loadAsync` downloads (for bundled assets, resolves) and caches each
 * one, so the first render has them in hand and paints complete.
 *
 * WHAT IS NOT PRELOADED
 *
 * Remote images — farmer photos, cooperative logos, ID documents — are not
 * here and must not be: they are per-record, there can be thousands, and
 * holding the splash on a network fetch would make a weak connection look
 * like a hang. Those are handled the other way round, by `expo-image`'s
 * disk cache plus a placeholder, so they fade in over a styled surface
 * instead of a white hole.
 */
import { Asset } from 'expo-asset';

import { images } from './assets';

/**
 * Every bundled raster the first few screens need.
 *
 * Derived from the registry rather than listed again, so an image added to
 * `images` is preloaded without anyone remembering to come back here — the
 * omission that caused this in the first place.
 */
const BUNDLED_IMAGES = Object.values(images);

/**
 * Resolves and caches the bundled images.
 *
 * Never rejects. A failed preload is a cosmetic problem — the image still
 * loads lazily on render, exactly as it used to — whereas a rejection here
 * would hold the splash forever and brick the app over a missing background.
 * That trade is the whole reason this swallows errors rather than reporting
 * them.
 */
export async function preloadAssets(): Promise<void> {
  try {
    await Asset.loadAsync(BUNDLED_IMAGES);
  } catch {
    // Deliberately silent: see above.
  }
}

/** Exposed for the test that checks the registry is covered. */
export const preloadCount = BUNDLED_IMAGES.length;
