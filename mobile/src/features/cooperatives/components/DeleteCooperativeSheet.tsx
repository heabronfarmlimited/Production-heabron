/**
 * Delete confirmation — restored from the ~120 commented-out lines of
 * `_showDeleteCooperativeSheet` in `cooperative_details_view.dart`.
 *
 * The backend has always supported `DELETE /agent/cooperatives/:id` and the
 * Dart repository implemented `deleteCooperative`, but the sheet and the
 * `Delete Cooperative` row that opened it were both commented out, so the
 * flow was unreachable. All copy below is the Dart source's, with one fix:
 * its title read `'Delete this  Cooperative'` with a double space.
 *
 * The typed-name confirmation is the Dart design and is kept — deleting a
 * cooperative cascades to its farmers, so a single tap is too cheap.
 * `CooperativesController.deleteCooperative` compared the typed name to the
 * signed-in agent's `fullName`, case-insensitively and trimmed.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppTextField } from '../../../components/AppTextField';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { PersonIcon } from '../../auth/components/FieldIcons';

import { BottomSheet } from './BottomSheet';

export interface DeleteCooperativeSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The signed-in agent's full name — what the typed value must match. */
  agentFullName?: string | null;
  onConfirm: () => void;
  deleting?: boolean;
}

export function DeleteCooperativeSheet({
  visible,
  onClose,
  agentFullName,
  onConfirm,
  deleting = false,
}: DeleteCooperativeSheetProps) {
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | undefined>();

  const close = () => {
    setFullName('');
    setError(undefined);
    onClose();
  };

  const confirm = () => {
    const typed = fullName.trim().toLowerCase();

    if (typed.length === 0) {
      setError('Please enter your full name');
      return;
    }

    // Dart compared against the cached user and toasted on mismatch; the
    // message lands on the field instead.
    if (typed !== (agentFullName ?? '').trim().toLowerCase()) {
      setError('Enter your full name to delete this cooperative');
      return;
    }

    setError(undefined);
    onConfirm();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title="Delete this Cooperative">
      <View style={{ height: h(20) }} />

      <View style={styles.warning}>
        <Text style={styles.warningText}>
          This action will delete this Cooperative and associated data permanently
        </Text>
      </View>

      <View style={{ height: h(23) }} />

      <AppTextField
        title="Enter Agent’s Fullname to continue"
        hintText="Enter agent’s full name"
        prefix={<PersonIcon />}
        autoCapitalize="words"
        value={fullName}
        onChangeText={(text) => {
          setFullName(text);
          if (error) setError(undefined);
        }}
        error={error}
        testID="delete-cooperative-name"
      />

      <View style={{ height: h(24) }} />

      <View style={styles.actions}>
        <View style={styles.action}>
          <AppButton
            text="Cancel"
            isOutlined
            bgColor={colors.white}
            textColor={colors.black}
            outlineColor={colors.border}
            borderRadius={100}
            height={52}
            onPress={close}
          />
        </View>

        <View style={{ width: r(16) }} />

        <View style={styles.action}>
          <AppButton
            text="Yes, delete Cooperative"
            bgColor={colors.failure}
            textColor={colors.white}
            borderRadius={100}
            height={52}
            loading={deleting}
            onPress={confirm}
            testID="delete-cooperative-confirm"
          />
        </View>
      </View>

      <View style={{ height: h(24) }} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  warning: {
    width: '100%',
    padding: r(10),
    // Dart: Color.fromRGBO(255, 235, 235, 0.9)
    backgroundColor: 'rgba(255, 235, 235, 0.9)',
    borderRadius: r(16),
  },
  warningText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.regular,
    fontWeight: '400',
    color: colors.failure,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  action: {
    flex: 1,
  },
});
