/**
 * Skeleton placeholders for a first load.
 *
 * WHY, RATHER THAN THE SPINNER THAT WAS HERE
 *
 * `AppSkeleton`'s `isBusy` draws a modal card with a spinner over the whole
 * screen. That is the right shape for an ACTION the agent just took — saving
 * a farmer, syncing — where blocking input is the point and the wait is
 * short.
 *
 * It is the wrong shape for the first load of a list or a profile. There, a
 * full-screen spinner says only "wait", gives no sense of how much is coming,
 * and makes the app feel like it stopped. A skeleton in the shape of the
 * content tells the agent what is arriving, keeps the screen's layout stable
 * so nothing jumps when the data lands, and — because it looks like the
 * answer rather than a barrier — reads as fast even when the connection is
 * not.
 *
 * The pulse runs on the native driver: it animates opacity only, so it does
 * not touch the JS thread while the screen is also parsing a response.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../core/theme/colors';
import { h, r } from '../core/theme/responsive';

const PULSE_MS = 900;
const MIN_OPACITY = 0.45;

/** One shimmering block. Everything below is built from these. */
export function SkeletonBlock({
  width,
  height,
  radius = 6,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: MIN_OPACITY,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    // Stopped on unmount: an animation left running behind a closed screen
    // keeps the JS timer alive and shows up as idle battery drain.
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      // Decorative. A screen reader should hear the real content when it
      // arrives, not a description of the placeholder.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { width, height: height ?? h(14), borderRadius: r(radius), opacity: pulse },
        style,
      ]}
    />
  );
}

/** A row of text lines, the last one short, as a paragraph reads. */
export function SkeletonLines({
  lines = 2,
  width = '100%',
}: {
  lines?: number;
  width?: number | `${number}%`;
}) {
  return (
    <View>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i}>
          {i > 0 ? <View style={{ height: h(6) }} /> : null}
          <SkeletonBlock
            width={i === lines - 1 && lines > 1 ? '60%' : width}
            height={h(12)}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * A list row: round avatar, two lines, a trailing value.
 *
 * Shaped like `CooperativeListItem` and `FarmerScoreTile` so the swap to real
 * content does not move anything on screen.
 */
export function SkeletonListRow() {
  return (
    <View style={styles.row}>
      <SkeletonBlock width={r(48)} height={r(48)} radius={48} />
      <View style={{ width: r(14) }} />
      <View style={styles.rowText}>
        <SkeletonBlock width="70%" height={h(14)} />
        <View style={{ height: h(8) }} />
        <SkeletonBlock width="45%" height={h(11)} />
      </View>
      <View style={{ width: r(12) }} />
      <SkeletonBlock width={r(42)} height={h(22)} radius={11} />
    </View>
  );
}

/** `count` list rows with separators. */
export function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i}>
          {i > 0 ? <View style={{ height: h(12) }} /> : null}
          <SkeletonListRow />
        </View>
      ))}
    </View>
  );
}

/** A card of label/value rows, as the detail screens show. */
export function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <View style={styles.card}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.cardRow}>
          <SkeletonBlock width="35%" height={h(12)} />
          <SkeletonBlock width="28%" height={h(12)} />
        </View>
      ))}
    </View>
  );
}

/** The home screen's tile grid: two rows of three. */
export function SkeletonTiles({ rows = 2, perRow = 3 }: { rows?: number; perRow?: number }) {
  return (
    <View>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <View key={rowIndex}>
          {rowIndex > 0 ? <View style={{ height: h(10) }} /> : null}
          <View style={styles.tileRow}>
            {Array.from({ length: perRow }, (_, i) => (
              <View key={i} style={styles.tileCell}>
                {i > 0 ? <View style={{ width: r(10) }} /> : null}
                <SkeletonBlock height={h(78)} radius={8} style={styles.tile} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: 'rgba(107, 114, 128, 0.16)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
  },
  card: {
    borderRadius: r(16),
    borderWidth: 1,
    borderColor: 'rgba(107, 114, 128, 0.2)',
    backgroundColor: colors.white,
    padding: r(16),
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: h(7),
  },
  tileRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tileCell: {
    flex: 1,
    flexDirection: 'row',
  },
  tile: {
    flex: 1,
  },
});
