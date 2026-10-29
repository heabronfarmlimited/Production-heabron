/**
 * Confirmation bottom sheet — ported from lib/src/shared/dialog_sheet.dart and
 * the inline confirm sheets in profile_view.dart, farmer_details_view.dart and
 * cooperative_details_view.dart.
 *
 * Supports the two shapes the Dart screens used:
 *  - a plain confirm (logout) — title, message, Cancel / Confirm
 *  - a typed confirmation (delete account / delete cooperative) — the same plus
 *    a field the user must fill with an exact expected value
 *
 * `destructive` paints the confirm button red and tints the message panel,
 * matching the Dart 'Danger Zone' styling (`rgba(255,239,168,0.24)`).
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../core/theme/colors';
import { r, spMin } from '../core/theme/responsive';
import { fontWeights, textTheme } from '../core/theme/typography';

import { AppButton } from './AppButton';
import { AppTextField } from './AppTextField';

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  message?: string;
  cancelText?: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
  destructive?: boolean;
  /** Label above the confirmation field, when one is required. */
  confirmationPrompt?: string;
  confirmationPlaceholder?: string;
  /** Confirm stays disabled until the typed value matches this, case-insensitively. */
  expectedConfirmation?: string;
}

export function ConfirmSheet({
  visible,
  title,
  message,
  cancelText = 'Cancel',
  confirmText = 'Confirm',
  onCancel,
  onConfirm,
  loading = false,
  destructive = false,
  confirmationPrompt,
  confirmationPlaceholder,
  expectedConfirmation,
}: ConfirmSheetProps) {
  const [typed, setTyped] = useState('');

  // Clear the field each time the sheet opens so a previous attempt doesn't
  // leave the confirm button already enabled.
  useEffect(() => {
    if (visible) setTyped('');
  }, [visible]);

  const needsConfirmation = Boolean(confirmationPrompt && expectedConfirmation);
  const matches =
    !needsConfirmation ||
    typed.trim().toLowerCase() === (expectedConfirmation ?? '').trim().toLowerCase();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onCancel} />

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>{title}</Text>

        {message ? (
          <View style={destructive ? styles.messagePanel : undefined}>
            <Text style={[styles.message, destructive && styles.messageDestructive]}>
              {message}
            </Text>
          </View>
        ) : null}

        {needsConfirmation ? (
          <View style={styles.field}>
            <AppTextField
              title={confirmationPrompt}
              hintText={confirmationPlaceholder}
              prefix={<Text style={styles.fieldGlyph}>👤</Text>}
              autoCapitalize="words"
              value={typed}
              onChangeText={setTyped}
              testID="confirm-sheet-input"
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          <View style={styles.action}>
            <AppButton
              text={cancelText}
              isOutlined
              disabled={loading}
              onPress={onCancel}
              testID="confirm-sheet-cancel"
            />
          </View>
          <View style={{ width: r(12) }} />
          <View style={styles.action}>
            <AppButton
              text={confirmText}
              bgColor={destructive ? colors.failure : colors.primary}
              loading={loading}
              disabled={!matches}
              onPress={onConfirm}
              testID="confirm-sheet-confirm"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
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
    paddingBottom: r(32),
  },
  handle: {
    alignSelf: 'center',
    width: r(40),
    height: r(4),
    borderRadius: r(2),
    backgroundColor: colors.secondary200,
    marginBottom: r(16),
  },
  title: {
    ...textTheme.titleLarge,
    fontSize: spMin(18),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
    marginBottom: r(12),
  },
  /** Dart 'Danger Zone' panel: rgba(255, 239, 168, 0.24). */
  messagePanel: {
    backgroundColor: 'rgba(255, 239, 168, 0.24)',
    borderRadius: r(8),
    padding: r(12),
  },
  message: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.greyDeep,
    lineHeight: spMin(14) * 1.5,
  },
  messageDestructive: {
    color: colors.failure,
  },
  field: {
    marginTop: r(20),
  },
  fieldGlyph: {
    fontSize: spMin(16),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: r(24),
  },
  action: {
    flex: 1,
  },
});
