/**
 * Date picker field — replaces the `AppTextField(readOnly: true, onTap: showDatePicker)`
 * pattern repeated across the Flutter forms (date of birth, planting/harvest
 * dates, payment date, event date).
 *
 * Renders as an AppTextField-styled control that opens the platform picker.
 * The displayed value and the stored value are separate: the UI shows a
 * readable format while the form holds `YYYY-MM-DD`, which is what the API
 * takes (`Joi.date().iso()`).
 */
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../core/theme/colors';
import { r, spMin } from '../core/theme/responsive';
import { fontWeights, textTheme } from '../core/theme/typography';

export interface DateFieldProps {
  title?: string;
  /** Placeholder when empty, e.g. 'Select date of birth'. */
  hintText?: string;
  /** `YYYY-MM-DD`, or empty. */
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  /** Where the picker opens when the field is empty. */
  initialDate?: Date;
  /** Shows a clear button once a date is set. */
  clearable?: boolean;
  enabled?: boolean;
  hasRequired?: boolean;
  /** Display format. Dart used `yyyy-MM-dd` or `MMM dd, yyyy`. */
  displayFormat?: string;
  suffix?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DateField({
  title,
  hintText = 'Select date',
  value,
  onChange,
  error,
  minimumDate,
  maximumDate,
  initialDate,
  clearable = false,
  enabled = true,
  hasRequired = false,
  displayFormat = 'yyyy-MM-dd',
  suffix,
  style,
  testID,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);

  const parsed = parseValue(value);
  const display = parsed ? format(parsed, displayFormat) : '';

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    // Android fires 'dismissed' on cancel; iOS keeps the spinner inline.
    if (Platform.OS === 'android') setOpen(false);

    if (event.type === 'dismissed' || !date) return;
    onChange(format(date, 'yyyy-MM-dd'));
    if (Platform.OS === 'ios') setOpen(false);
  };

  return (
    <View style={[styles.container, style]}>
      {title ? (
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {hasRequired ? <Text style={styles.required}> *</Text> : null}
        </View>
      ) : null}

      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title ?? hintText}
        accessibilityValue={{ text: display || 'not set' }}
        disabled={!enabled}
        onPress={() => setOpen(true)}
        style={[
          styles.field,
          Boolean(error) && styles.fieldError,
          !enabled && styles.fieldDisabled,
        ]}
      >
        <Text style={[styles.value, !display && styles.placeholder]} numberOfLines={1}>
          {display || hintText}
        </Text>

        {clearable && display ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear date"
            hitSlop={8}
            onPress={() => onChange('')}
            style={styles.clear}
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        ) : (
          (suffix ?? <Text style={styles.calendar}>📅</Text>)
        )}
      </Pressable>

      {error ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : null}

      {open ? (
        <DateTimePicker
          value={parsed ?? initialDate ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={handleChange}
        />
      ) : null}
    </View>
  );
}

function parseValue(value?: string): Date | null {
  if (!value) return null;
  try {
    const d = parseISO(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: r(8),
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
  },
  required: {
    color: colors.failure,
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.grey,
    borderRadius: r(8),
    backgroundColor: colors.white,
    paddingHorizontal: r(10),
    paddingVertical: r(16),
    minHeight: r(52),
  },
  fieldError: {
    borderColor: colors.failure,
  },
  fieldDisabled: {
    backgroundColor: colors.secondary100,
  },
  value: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    flex: 1,
    marginRight: r(8),
  },
  placeholder: {
    color: colors.grey,
  },
  calendar: {
    fontSize: spMin(15),
  },
  clear: {
    padding: r(2),
  },
  clearText: {
    color: colors.grey,
    fontSize: spMin(14),
  },
  error: {
    ...textTheme.bodySmall,
    color: colors.failure,
    fontSize: spMin(12),
    marginTop: r(4),
  },
});
