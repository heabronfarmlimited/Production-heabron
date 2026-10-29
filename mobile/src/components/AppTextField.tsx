/**
 * Text input — ported from lib/src/shared/app_textfield.dart
 *
 * Keeps the Dart widget's structure: optional title label above the field,
 * filled rounded box, grey border that turns primary on focus, red error text
 * below (max 2 lines), optional prefix/suffix, and a built-in password
 * visibility toggle.
 *
 * The emoji-blocking input filter is carried over verbatim.
 */
import type { ReactNode} from 'react';
import { useState } from 'react';
import type {
  KeyboardTypeOptions,
  NativeSyntheticEvent,
  ReturnKeyTypeOptions,
  StyleProp,
  TextInputFocusEventData,
  TextStyle,
  ViewStyle} from 'react-native';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { colors, getColorFromHex } from '../core/theme/colors';
import { r, spMin } from '../core/theme/responsive';
import { fontWeights, textTheme } from '../core/theme/typography';

/**
 * Emoji ranges denied by the Dart `FilteringTextInputFormatter.deny`.
 * Emoticons, pictographs, transport, flags, misc symbols and dingbats.
 */
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;

export const stripEmoji = (value: string): string => value.replace(EMOJI_REGEX, '');

export interface AppTextFieldProps {
  /** Label rendered above the field (`title` in Dart). */
  title?: string;
  /** Placeholder (`hintText`). */
  hintText?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  onBlur?: (e: NativeSyntheticEvent<TextInputFocusEventData>) => void;
  /** Validation message; renders in red below the field. */
  error?: string;
  enabled?: boolean;
  readOnly?: boolean;
  /** Password field — adds the visibility toggle. */
  isPassword?: boolean;
  keyboardType?: KeyboardTypeOptions;
  returnKeyType?: ReturnKeyTypeOptions;
  maxLength?: number;
  /** Dart default: 1. */
  minLines?: number;
  maxLines?: number;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** When set, the field becomes read-only and the press opens a picker. */
  onPress?: () => void;
  /** Dart default: true, fill `AppColors.white`. */
  filled?: boolean;
  filledColor?: string;
  textColor?: string;
  counterText?: string;
  /** Shows a red asterisk beside the title. */
  hasRequired?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: 'off' | 'email' | 'password' | 'tel' | 'name';
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  testID?: string;
}

export function AppTextField({
  title,
  hintText,
  value,
  onChangeText,
  onBlur,
  error,
  enabled = true,
  readOnly = false,
  isPassword = false,
  keyboardType,
  returnKeyType = 'next',
  maxLength,
  minLines = 1,
  maxLines,
  prefix,
  suffix,
  onPress,
  filled = true,
  filledColor,
  textColor,
  counterText,
  hasRequired = false,
  // Dart used TextCapitalization.sentences.
  autoCapitalize = 'sentences',
  autoComplete = 'off',
  style,
  inputStyle,
  testID,
}: AppTextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [obscured, setObscured] = useState(true);

  // `readOnly: widget.onTap != null || widget.readOnly`
  const isReadOnly = readOnly || onPress != null;
  const multiline = (maxLines ?? 1) > 1 || minLines > 1;

  const borderColor = !enabled
    ? colors.white
    : error
      ? colors.primary // Dart set errorBorder = focusedBorder (primary)
      : focused
        ? colors.primary
        : colors.grey;

  const field = (
    <View
      style={[
        styles.inputWrap,
        {
          borderColor,
          backgroundColor: filled ? (filledColor ?? colors.white) : 'transparent',
        },
      ]}
    >
      {prefix ? <View style={styles.prefix}>{prefix}</View> : null}

      <TextInput
        testID={testID}
        style={[
          styles.input,
          { color: textColor ?? colors.black },
          multiline ? styles.inputMultiline : null,
          inputStyle,
        ]}
        value={value}
        onChangeText={(text) => onChangeText?.(stripEmoji(text))}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        placeholder={hintText}
        placeholderTextColor={colors.grey}
        editable={enabled && !isReadOnly}
        secureTextEntry={isPassword && obscured}
        keyboardType={keyboardType}
        returnKeyType={returnKeyType}
        maxLength={maxLength}
        multiline={multiline}
        numberOfLines={multiline ? (maxLines ?? minLines) : 1}
        autoCapitalize={isPassword ? 'none' : autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        // Dart: enableSuggestions: false
        spellCheck={false}
        cursorColor={textColor ?? colors.primary}
        selectionColor={colors.primary}
        pointerEvents={onPress ? 'none' : 'auto'}
      />

      {suffix ? (
        <View style={styles.suffix}>{suffix}</View>
      ) : isPassword ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={obscured ? 'Show password' : 'Hide password'}
          onPress={() => setObscured((v) => !v)}
          hitSlop={8}
          style={styles.suffix}
        >
          <EyeIcon off={obscured} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, style]}>
      {title ? (
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {hasRequired ? <Text style={styles.required}> *</Text> : null}
        </View>
      ) : null}

      {onPress ? (
        <Pressable onPress={enabled ? onPress : undefined}>{field}</Pressable>
      ) : (
        field
      )}

      {error ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : counterText ? (
        <Text style={styles.counter}>{counterText}</Text>
      ) : null}
    </View>
  );
}

/**
 * Stands in for Material's `visibility_rounded` / `visibility_off_rounded`.
 * Colour `#334155` matches the Dart `getColorFromHex('#334155')`.
 */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <Text style={[styles.eye, { color: getColorFromHex('#334155') }]}>
      {off ? '🙈' : '👁'}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Dart: 8.verticalSpace between title and field
    marginBottom: r(8),
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.regular,
    fontWeight: '400',
  },
  required: {
    color: colors.failure,
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: r(8),
    minHeight: r(52),
  },
  input: {
    flex: 1,
    fontSize: spMin(16),
    fontFamily: fontWeights.regular,
    fontWeight: '400',
    // Dart: contentPadding EdgeInsets.symmetric(vertical: 16, horizontal: 10)
    paddingVertical: r(16),
    paddingHorizontal: r(10),
  },
  inputMultiline: {
    textAlignVertical: 'top',
  },
  prefix: {
    // Dart: Padding(left: 11, right: 11)
    paddingLeft: r(11),
    paddingRight: r(11),
  },
  suffix: {
    paddingHorizontal: r(12),
  },
  eye: {
    fontSize: spMin(16),
  },
  error: {
    ...textTheme.bodySmall,
    color: colors.failure,
    fontSize: spMin(12),
    marginTop: r(4),
  },
  counter: {
    ...textTheme.bodySmall,
    color: colors.grey,
    fontSize: spMin(12),
    marginTop: r(4),
    textAlign: 'right',
  },
});
