/**
 * Finger signature capture (spec 3.7, 10).
 *
 * Built on react-native-svg and PanResponder, which the app already depends
 * on — a WebView-based signature library would be a new dependency, a heavier
 * runtime, and a blank box on a device with no network, which is exactly the
 * situation this screen has to work in.
 *
 * The box is deliberately large: the spec requires it to be comfortable for a
 * finger on a small phone, with Clear and Retry.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights } from '../../../core/theme/typography';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
}

interface Props {
  /** Fires whenever the strokes change, so the parent can enable Continue. */
  onChange?: (hasSignature: boolean) => void;
  /** Called with the captured strokes as an SVG string, ready to upload. */
  onCapture?: (svg: string) => void;
  label?: string;
}

/** A single stroke: the points between a finger touching down and lifting. */
type Stroke = string;

export function SignaturePad({ onChange, onCapture, label }: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<string>('');
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Held in a ref as well as state: the PanResponder closure is created once
  // and would otherwise capture the first render's empty value.
  const currentRef = useRef('');

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Keep the gesture even if a parent ScrollView wants it, otherwise a
        // vertical stroke scrolls the form instead of drawing.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,

        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentRef.current = `M${locationX.toFixed(2)},${locationY.toFixed(2)}`;
          setCurrent(currentRef.current);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentRef.current += ` L${locationX.toFixed(2)},${locationY.toFixed(2)}`;
          setCurrent(currentRef.current);
        },
        onPanResponderRelease: () => {
          const finished = currentRef.current;
          currentRef.current = '';
          setCurrent('');
          if (!finished) return;
          setStrokes((prev) => {
            const next = [...prev, finished];
            onChange?.(true);
            return next;
          });
        },
      }),
    [onChange],
  );

  const clear = useCallback(() => {
    setStrokes([]);
    setCurrent('');
    currentRef.current = '';
    onChange?.(false);
  }, [onChange]);

  const capture = useCallback(() => {
    if (strokes.length === 0) return;
    // A self-contained SVG document, so the stored file renders anywhere
    // without the app's styling.
    const paths = strokes
      .map((d) => `<path d="${d}" stroke="#000000" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(size.width)}" ` +
      `height="${Math.round(size.height)}" viewBox="0 0 ${Math.round(size.width)} ${Math.round(size.height)}">` +
      `<rect width="100%" height="100%" fill="#FFFFFF"/>${paths}</svg>`;
    onCapture?.(svg);
  }, [strokes, size, onCapture]);

  const hasSignature = strokes.length > 0 || current.length > 0;

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={styles.pad} onLayout={onLayout} {...panResponder.panHandlers}>
        {size.width > 0 ? (
          <Svg width={size.width} height={size.height}>
            {strokes.map((d, i) => (
              <Path
                key={`${i}-${d.length}`}
                d={d}
                stroke={colors.black}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {current ? (
              <Path
                d={current}
                stroke={colors.black}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </Svg>
        ) : null}

        {!hasSignature ? (
          <View style={styles.placeholder} pointerEvents="none">
            <Text style={styles.placeholderText}>Sign here with your finger</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          onPress={clear}
          disabled={!hasSignature}
          style={[styles.action, !hasSignature && styles.actionDisabled]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear signature"
        >
          <Text style={[styles.actionText, !hasSignature && styles.actionTextDisabled]}>Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={capture}
          disabled={!hasSignature}
          style={[styles.action, styles.actionPrimary, !hasSignature && styles.actionDisabled]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Use this signature"
        >
          <Text style={[styles.actionText, styles.actionTextPrimary]}>Use this signature</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: spMin(14),
    fontFamily: fontWeights.medium,
    color: colors.black,
    marginBottom: h(8),
  },
  pad: {
    height: h(200),
    borderRadius: r(12),
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  placeholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: spMin(14),
    fontFamily: fontWeights.regular,
    color: colors.secondaryTextColor,
  },
  actions: {
    flexDirection: 'row',
    gap: r(12),
    marginTop: h(12),
  },
  action: {
    flex: 1,
    paddingVertical: h(12),
    borderRadius: r(10),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionText: {
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    color: colors.black,
  },
  actionTextPrimary: {
    color: colors.white,
  },
  actionTextDisabled: {
    color: colors.secondaryTextColor,
  },
});
