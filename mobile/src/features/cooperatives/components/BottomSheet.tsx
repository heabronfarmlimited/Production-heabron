/**
 * `showSizeSheet` — ported from lib/src/shared/dialog_sheet.dart as a
 * component rather than an imperative call, since React Native has no
 * `showModalBottomSheet`.
 *
 * Dart chrome: white, 24r top corners, a centred 40w x 4h `secondary200`
 * handle, 16 horizontal / 20 vertical padding, and an optional title
 * (16sp w600) with a 12sp `secondary400` subtitle beneath it.
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, screenHeight, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: BottomSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
      />

      <View style={styles.sheet}>
        <View style={styles.handle} />

        {title ? (
          <>
            <View style={{ height: h(18) }} />
            <Text style={styles.title}>{title}</Text>
          </>
        ) : null}

        {subtitle ? (
          <>
            <View style={{ height: h(4) }} />
            <Text style={styles.subtitle}>{subtitle}</Text>
          </>
        ) : null}

        <View style={{ height: h(24) }} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: r(24),
    borderTopRightRadius: r(24),
    paddingHorizontal: r(16),
    paddingTop: r(8),
    paddingBottom: r(20),
    maxHeight: screenHeight() * 0.85,
  },
  handle: {
    alignSelf: 'center',
    width: r(40),
    height: r(4),
    borderRadius: r(10),
    backgroundColor: colors.secondary200,
  },
  title: {
    ...textTheme.titleMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondary400,
  },
});
