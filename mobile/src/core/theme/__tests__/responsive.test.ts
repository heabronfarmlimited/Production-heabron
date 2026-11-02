import type { ScaledSize } from 'react-native';

import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  __setScreenForTest,
  h,
  isTablet,
  r,
  scaleFont,
  spMin,
  w,
} from '../responsive';

const screen = (width: number, height: number): ScaledSize =>
  ({ width, height, scale: 2, fontScale: 1 }) as ScaledSize;

/** The devices this app actually runs on, including the cheap Androids. */
const DEVICES = {
  iphoneSE: screen(375, 667),
  iphone13Mini: screen(375, 812),
  reference: screen(DESIGN_WIDTH + 10, DESIGN_HEIGHT), // 393x852, the design target
  iphoneProMax: screen(430, 932),
  androidSmall: screen(360, 640),
  androidMid: screen(360, 800),
  pixel8: screen(412, 915),
  tablet7: screen(600, 960),
};

afterEach(() => __setScreenForTest(DEVICES.reference));

describe('font scaling', () => {
  it('renders the design size on the reference device', () => {
    __setScreenForTest(DEVICES.reference);
    expect(spMin(14)).toBe(14);
    expect(spMin(24)).toBe(24);
  });

  it.each([
    ['iPhone SE', DEVICES.iphoneSE],
    ['small Android 360x640', DEVICES.androidSmall],
    ['iPhone 13 mini', DEVICES.iphone13Mini],
    ['Samsung A54', DEVICES.androidMid],
  ])('keeps body text legible on %s', (_name, size) => {
    __setScreenForTest(size);
    const body = spMin(14);

    // The regression this guards: fonts used to follow min(widthRatio,
    // heightRatio). With a design height of 852, every shorter device shrank
    // its text — 11.0px on an iPhone SE and 10.5px on a 360x640 Android, from
    // a 14px style. Anything at or below 12px here is the bug returning.
    expect(body).toBeGreaterThan(12.5);
    expect(body).toBeLessThanOrEqual(14);
  });

  it('never scales text above the design size (minTextAdapt)', () => {
    for (const size of Object.values(DEVICES)) {
      __setScreenForTest(size);
      expect(spMin(14)).toBeLessThanOrEqual(14);
    }
  });

  it('does not balloon type on a tablet', () => {
    __setScreenForTest(DEVICES.tablet7);
    // scaleFont may grow, but only within the clamp (1.1x).
    expect(scaleFont(14)).toBeLessThanOrEqual(14 * 1.1 + 0.5);
  });

  it('is bounded across every supported device', () => {
    for (const [, size] of Object.entries(DEVICES)) {
      __setScreenForTest(size);
      const ratio = spMin(100) / 100;
      expect(ratio).toBeGreaterThanOrEqual(0.9);
      expect(ratio).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('layout scaling', () => {
  it('keeps spacing and radii within a bounded range', () => {
    for (const [, size] of Object.entries(DEVICES)) {
      __setScreenForTest(size);
      expect(h(100) / 100).toBeGreaterThanOrEqual(0.85);
      expect(h(100) / 100).toBeLessThanOrEqual(1.15);
      expect(r(100) / 100).toBeGreaterThanOrEqual(0.85);
      expect(r(100) / 100).toBeLessThanOrEqual(1.15);
      expect(w(100) / 100).toBeGreaterThanOrEqual(0.85);
      expect(w(100) / 100).toBeLessThanOrEqual(1.25);
    }
  });

  it('does not stretch layout on a tablet-shaped screen', () => {
    __setScreenForTest(DEVICES.tablet7);
    // 600/383 is 1.57 unclamped, which would blow a card out of proportion.
    expect(w(100)).toBeLessThanOrEqual(125);
  });
});

describe('breakpoints', () => {
  it('identifies tablets', () => {
    __setScreenForTest(DEVICES.tablet7);
    expect(isTablet()).toBe(true);

    __setScreenForTest(DEVICES.androidSmall);
    expect(isTablet()).toBe(false);
  });
});
