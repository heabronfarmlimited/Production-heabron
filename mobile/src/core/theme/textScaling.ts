/**
 * Global text-scaling policy.
 *
 * Both platforms let a user enlarge text system-wide (iOS Dynamic Type,
 * Android Settings > Display > Font size). React Native multiplies every
 * `<Text>`'s `fontSize` by that factor automatically.
 *
 * Honouring it matters: field agents work outdoors, often in bright sun, and
 * some will have set a larger system font deliberately. But the multiplier is
 * unbounded — iOS accessibility sizes reach roughly 3.1x — and at that point
 * fixed-height rows, buttons, tab bars and table cells overflow, which makes
 * the app less usable rather than more.
 *
 * So the policy is: respect the user's setting, but cap it at MAX_FONT_SCALE.
 * Applying `maxFontSizeMultiplier` once here is better than editing ~95
 * StyleSheet files, and it covers `<TextInput>` too, which has the same
 * problem and is easy to forget.
 *
 * Call `applyTextScalingPolicy()` once, before the first screen renders.
 */
import { Text, TextInput } from 'react-native';

import { MAX_FONT_SCALE } from './responsive';

type Scalable = {
  defaultProps?: Record<string, unknown>;
};

/**
 * Sets the default on a component class. `defaultProps` is the documented way
 * to do this for RN's host components, and remains the only global hook — RN
 * does not expose a theme-level font-scale setting.
 */
function setDefault(component: unknown, props: Record<string, unknown>): void {
  const target = component as Scalable;
  target.defaultProps = { ...(target.defaultProps ?? {}), ...props };
}

export function applyTextScalingPolicy(): void {
  // allowFontScaling stays true: the user's preference is honoured, just bounded.
  setDefault(Text, {
    allowFontScaling: true,
    maxFontSizeMultiplier: MAX_FONT_SCALE,
  });

  setDefault(TextInput, {
    allowFontScaling: true,
    maxFontSizeMultiplier: MAX_FONT_SCALE,
  });
}
