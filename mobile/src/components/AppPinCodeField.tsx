/**
 * OTP input — ported from lib/src/shared/app_pincode_textfield.dart
 * (which wrapped `pin_code_fields`).
 *
 * Dart config: `length: 6`, digits only, `obscureText: false`, box shape,
 * 48×44 cells, border `#EBEBEB`, and `onCompleted` firing the next step.
 *
 * Implemented as one hidden TextInput behind six display cells. That keeps a
 * single caret, makes OS SMS autofill work, and avoids the focus-juggling bugs
 * of six separate inputs.
 */
import { useEffect, useRef, useState } from 'react';
import type { TextInputInstance, TextInputKeyPressEvent } from 'react-native';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '../core/theme/colors';
import { r, spMin } from '../core/theme/responsive';
import { fontWeights, textTheme } from '../core/theme/typography';

/** Dart cell border colour. */
const CELL_BORDER = '#EBEBEB';

export interface AppPinCodeFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  /** Fired when the final digit is entered — Dart `onCompleted`. */
  onCompleted?: (value: string) => void;
  /** Dart default: 6. */
  length?: number;
  error?: string;
  enabled?: boolean;
  autoFocus?: boolean;
  testID?: string;
}

export function AppPinCodeField({
  value,
  onChangeText,
  onCompleted,
  length = 6,
  error,
  enabled = true,
  autoFocus = true,
  testID,
}: AppPinCodeFieldProps) {
  const inputRef = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const completedFor = useRef<string | null>(null);

  // Fire onCompleted once per complete value, not on every re-render.
  useEffect(() => {
    if (value.length === length && completedFor.current !== value) {
      completedFor.current = value;
      onCompleted?.(value);
    }
    if (value.length < length) completedFor.current = null;
  }, [value, length, onCompleted]);

  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, length);
    onChangeText(digits);
  };

  // Android sometimes swallows backspace on an empty input.
  const handleKeyPress = (e: TextInputKeyPressEvent) => {
    if (e.nativeEvent.key === 'Backspace' && value.length > 0) {
      onChangeText(value.slice(0, -1));
    }
  };

  const cells = Array.from({ length }, (_, i) => value[i] ?? '');
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.row}
        onPress={() => inputRef.current?.focus()}
        accessibilityRole="none"
      >
        {cells.map((digit, i) => {
          const isActive = focused && i === activeIndex;
          return (
            <View
              key={i}
              style={[
                styles.cell,
                isActive && styles.cellActive,
                Boolean(error) && styles.cellError,
              ]}
            >
              <Text style={styles.digit}>{digit}</Text>
            </View>
          );
        })}
      </Pressable>

      <TextInput
        ref={inputRef}
        testID={testID}
        style={styles.hiddenInput}
        value={value}
        onChangeText={handleChange}
        onKeyPress={handleKeyPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        maxLength={length}
        editable={enabled}
        autoFocus={autoFocus}
        // Lets iOS/Android offer the code straight from the SMS.
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        caretHidden
        accessibilityLabel={`${length}-digit verification code`}
      />

      {error ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: r(8),
  },
  cell: {
    // Dart: 48 wide x 44 tall
    flex: 1,
    maxWidth: r(48),
    height: r(44),
    borderWidth: 1,
    borderColor: CELL_BORDER,
    borderRadius: r(8),
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: {
    borderColor: colors.primary,
  },
  cellError: {
    borderColor: colors.failure,
  },
  digit: {
    ...textTheme.bodyLarge,
    fontSize: spMin(18),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: '100%',
    height: r(44),
    top: 0,
  },
  error: {
    ...textTheme.bodySmall,
    color: colors.failure,
    fontSize: spMin(12),
    marginTop: r(8),
  },
});
