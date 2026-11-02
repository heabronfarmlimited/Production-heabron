/**
 * A remote image with the defaults every remote image in this app wants.
 *
 * Avatars, selfies, farm photos, ID documents and cooperative logos all come
 * from Supabase storage over a field connection. Rendered as a bare
 * `<Image source={{uri}}>` they each produced the same three problems:
 *
 *   - a white hole the size of the image until the bytes arrived, so a list
 *     of farmers looked broken while it filled in;
 *   - a hard pop when they did arrive, which reads as a stutter;
 *   - a fresh download every time the screen was revisited, because React
 *     Native's `Image` has no disk cache — the single biggest cause of the
 *     app feeling slow on a second visit to a screen it had already shown.
 *
 * So: cached to disk, faded in over a styled surface, and a broken URL falls
 * back to the same surface rather than a blank gap. One component so those
 * decisions are in one place instead of copied across eight call sites and
 * drifting.
 */
import { Image, type ImageContentFit, type ImageProps } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../core/theme/colors';
import { r, spMin } from '../core/theme/responsive';
import { fontWeights, textTheme } from '../core/theme/typography';

export interface RemoteImageProps
  extends Omit<ImageProps, 'source' | 'contentFit' | 'style'> {
  /** The stored URL. Null or empty renders the fallback, not a broken image. */
  uri?: string | null;
  contentFit?: ImageContentFit;
  /**
   * Shown while loading and if the image fails — initials, a glyph, whatever
   * the surrounding screen uses. Without one the fallback is a plain tinted
   * surface, which is still better than a white hole.
   */
  fallback?: string;
  style?: StyleProp<ViewStyle>;
  /** Rounded corners on both the image and its placeholder. */
  radius?: number;
  testID?: string;
}

export function RemoteImage({
  uri,
  contentFit = 'cover',
  fallback,
  style,
  radius,
  testID,
  ...rest
}: RemoteImageProps) {
  const [failed, setFailed] = useState(false);

  const rounded = radius != null ? { borderRadius: radius } : null;
  const hasImage = Boolean(uri && uri.length > 0) && !failed;

  return (
    <View style={[styles.container, rounded, style]}>
      {/*
        The placeholder sits UNDER the image rather than being swapped for
        it, so the fade has something to fade over and a slow connection
        shows a styled surface instead of a hole. It costs one extra view
        and removes every flash of white.
      */}
      <View style={[styles.placeholder, rounded]}>
        {fallback ? (
          <Text style={styles.fallbackText} numberOfLines={1}>
            {fallback}
          </Text>
        ) : null}
      </View>

      {hasImage ? (
        <Image
          source={{ uri: uri as string }}
          style={[StyleSheet.absoluteFill, rounded]}
          contentFit={contentFit}
          // Kept in memory for this session and on disk between sessions, so
          // revisiting a screen costs nothing and neither does a restart.
          cachePolicy="memory-disk"
          transition={200}
          // A dead or expired URL must not leave a blank gap where a face
          // should be; the placeholder underneath becomes the answer.
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
          testID={testID}
          {...rest}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  placeholder: {
    // RN 0.88 does not type `StyleSheet.absoluteFillObject`; only the
    // registered `absoluteFill` style exists, which cannot be spread.
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(107, 114, 128, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.secondaryTextColor,
    paddingHorizontal: r(4),
  },
});
