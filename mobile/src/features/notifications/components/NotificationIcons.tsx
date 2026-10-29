/**
 * Glyph icons for the notification widgets, in the style of
 * features/auth/components/FieldIcons.tsx.
 *
 *   Icons.notifications -> BellIcon
 *   Icons.close         -> CloseIcon
 */
import { StyleSheet, Text } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { spMin } from '../../../core/theme/responsive';

export interface NotificationIconProps {
  color?: string;
  size?: number;
}

function Glyph({
  char,
  color = colors.primary,
  size = 20,
}: NotificationIconProps & { char: string }) {
  return (
    <Text
      style={[styles.glyph, { color, fontSize: spMin(size) }]}
      accessible={false}
      allowFontScaling={false}
    >
      {char}
    </Text>
  );
}

export const BellIcon = (p: NotificationIconProps) => <Glyph char="🔔" {...p} />;
export const CloseIcon = (p: NotificationIconProps) => <Glyph char="✕" {...p} />;

const styles = StyleSheet.create({
  glyph: {
    textAlign: 'center',
  },
});
