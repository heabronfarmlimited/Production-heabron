/**
 * Trailing arrow on the registration 'Next' button —
 * Dart `icon: Icon(Icons.arrow_forward, color: Colors.black)`.
 */
import { StyleSheet, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r } from '../../../core/theme/responsive';

export interface NextButtonIconProps {
  color?: string;
  size?: number;
}

export function NextButtonIcon({
  color = colors.black,
  size = 18,
}: NextButtonIconProps) {
  const s = r(size);
  return (
    <View style={[styles.wrap, { width: s, height: s }]}>
      <View style={[styles.shaft, { backgroundColor: color, width: s * 0.8 }]} />
      <View
        style={[
          styles.head,
          {
            borderTopColor: color,
            borderRightColor: color,
            width: s * 0.4,
            height: s * 0.4,
            right: s * 0.05,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
  },
  shaft: {
    height: 2,
  },
  head: {
    position: 'absolute',
    borderTopWidth: 2,
    borderRightWidth: 2,
    transform: [{ rotate: '45deg' }],
  },
});
