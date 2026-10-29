/**
 * Bottom action sheet — ports `showSizeSheet` from `shared/dialog_sheet.dart`.
 *
 * `ActionSheet` is the "Farmer actions" sheet: a 40x4 grab handle, a 16sp w600
 * title, a 12sp `secondary400` subtitle and a column of `OptionsRow`s on a
 * white card with a 24-radius top.
 *
 * The destructive-confirm card the ~86 commented-out lines in
 * farmer_details_view.dart would have shown is the shared
 * `components/ConfirmSheet`, which also supports the typed confirmation the
 * farmer delete uses.
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, screenHeight, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface ActionSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function ActionSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: ActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.backdrop}
        onPress={onClose}
      />

      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={{ height: h(18) }} />

        <Text accessibilityRole="header" style={styles.sheetTitle}>
          {title}
        </Text>

        {subtitle ? (
          <>
            <View style={{ height: h(4) }} />
            <Text style={styles.sheetSubtitle}>{subtitle}</Text>
          </>
        ) : null}

        <View style={{ height: h(24) }} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.sheetBody}
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
    paddingTop: r(12),
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
  sheetTitle: {
    ...textTheme.titleMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  sheetSubtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondary400,
  },
  sheetBody: {
    paddingBottom: r(16),
  },
});
