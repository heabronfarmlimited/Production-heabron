/**
 * Material `Icons.chevron_right`, drawn with views so no icon font is needed —
 * the same approach `BaseAppBar`'s BackArrow and `AppDropdown`'s Caret take.
 *
 * NOTE — belongs beside the other glyphs in
 * `src/features/auth/components/FieldIcons.tsx` (or a shared
 * `src/components/Icons.tsx`) once that file is no longer auth-scoped.
 */
import { View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r } from '../../../core/theme/responsive';

export interface ChevronProps {
  color?: string;
  /** Dart used 20r on the list item, 24 (default) in the options sheet. */
  size?: number;
  direction?: 'right' | 'down';
}

export function Chevron({
  color = colors.grey,
  size = 20,
  direction = 'right',
}: ChevronProps) {
  const box = r(size);
  const arm = box * 0.4;

  return (
    <View
      style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}
      accessible={false}
    >
      <View
        style={{
          width: arm,
          height: arm,
          borderTopWidth: 2,
          borderRightWidth: 2,
          borderColor: color,
          transform: [{ rotate: direction === 'right' ? '45deg' : '135deg' }],
          // Optically centres the glyph in its box.
          marginLeft: direction === 'right' ? -arm * 0.25 : 0,
          marginTop: direction === 'down' ? -arm * 0.25 : 0,
        }}
      />
    </View>
  );
}
