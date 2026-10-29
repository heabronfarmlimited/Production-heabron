/**
 * Dropdown — ported from lib/src/shared/app_dropdown.dart
 *
 * Dart used `DropdownButtonFormField<String>` with a floating label, a
 * `#D6DDEB` border and `menuMaxHeight: height * 0.6`. React Native has no
 * native picker that matches, so this renders a styled field that opens a
 * bottom-sheet list — which also works better on small screens with the long
 * LGA lists.
 *
 * Takes `Option[]` (label + API value) rather than the Dart `List<String>`, so
 * screens never send a display label to the API. See domainConstants.ts.
 */
import { useMemo, useState } from 'react';
import type {
  StyleProp,
  ViewStyle} from 'react-native';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import type { Option } from '../core/api/domainConstants';
import { colors } from '../core/theme/colors';
import { r, screenHeight, spMin } from '../core/theme/responsive';
import { fontWeights, textTheme } from '../core/theme/typography';

/** Dart border colour for the dropdown. */
const BORDER = '#D6DDEB';
/** Dart label colour. */
const LABEL = '#6E798F';

export interface AppDropdownProps<T extends string = string> {
  /** Placeholder shown when nothing is selected (Dart `label`). */
  label: string;
  /** Field title above the control (Dart `title`). */
  title?: string;
  options: readonly Option<T>[];
  value?: T | null;
  onChange: (value: T) => void;
  error?: string;
  enabled?: boolean;
  hasRequired?: boolean;
  /** Adds a search box in the sheet. Auto-enabled past 12 options. */
  searchable?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function AppDropdown<T extends string = string>({
  label,
  title,
  options,
  value,
  onChange,
  error,
  enabled = true,
  hasRequired = false,
  searchable,
  style,
  testID,
}: AppDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const showSearch = searchable ?? options.length > 12;

  const filtered = useMemo(() => {
    if (!showSearch || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, showSearch]);

  const close = () => {
    setOpen(false);
    setQuery('');
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
        accessibilityLabel={title ?? label}
        accessibilityState={{ expanded: open, disabled: !enabled }}
        disabled={!enabled}
        onPress={() => setOpen(true)}
        style={[styles.field, !enabled && styles.fieldDisabled]}
      >
        <Text
          style={[styles.value, !selected && styles.placeholder]}
          numberOfLines={1}
        >
          {selected?.label ?? label}
        </Text>
        <Caret />
      </Pressable>

      {error ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : null}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{title ?? label}</Text>

          {showSearch ? (
            <TextInput
              style={styles.search}
              placeholder="Search"
              placeholderTextColor={colors.grey}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
          ) : null}

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>No matches found</Text>
            }
            renderItem={({ item }) => {
              const isSelected = item.value === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  style={[styles.row, isSelected && styles.rowSelected]}
                  onPress={() => {
                    onChange(item.value);
                    close();
                  }}
                >
                  <Text
                    style={[styles.rowText, isSelected && styles.rowTextSelected]}
                  >
                    {item.label}
                  </Text>
                  {isSelected ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

/** Material `Icons.arrow_drop_down`. */
function Caret() {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: r(5),
        borderRightWidth: r(5),
        borderTopWidth: r(6),
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderTopColor: colors.grey,
      }}
    />
  );
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
    borderColor: BORDER,
    borderRadius: r(4),
    backgroundColor: colors.white,
    // Dart contentPadding: symmetric(horizontal: 16, vertical: 16)
    paddingHorizontal: r(16),
    paddingVertical: r(16),
    minHeight: r(52),
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
    color: LABEL,
  },
  error: {
    ...textTheme.bodySmall,
    color: colors.failure,
    fontSize: spMin(12),
    marginTop: r(4),
  },
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
    paddingTop: r(8),
    paddingBottom: r(24),
    // Dart menuMaxHeight: context.height * 0.6
    maxHeight: screenHeight() * 0.6,
  },
  handle: {
    alignSelf: 'center',
    width: r(40),
    height: r(4),
    borderRadius: r(2),
    backgroundColor: colors.secondary200,
    marginBottom: r(12),
  },
  sheetTitle: {
    ...textTheme.titleLarge,
    fontFamily: fontWeights.bold,
    fontWeight: '700',
    fontSize: spMin(16),
    paddingHorizontal: r(16),
    marginBottom: r(8),
  },
  search: {
    marginHorizontal: r(16),
    marginBottom: r(8),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: r(8),
    paddingHorizontal: r(12),
    paddingVertical: r(10),
    fontSize: spMin(15),
    fontFamily: fontWeights.regular,
    color: colors.black,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: r(16),
    paddingVertical: r(14),
  },
  rowSelected: {
    backgroundColor: colors.secondary100,
  },
  rowText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(15),
    flex: 1,
  },
  rowTextSelected: {
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
  },
  check: {
    color: colors.primary,
    fontSize: spMin(16),
    fontFamily: fontWeights.bold,
  },
  empty: {
    ...textTheme.bodyMedium,
    color: colors.grey,
    textAlign: 'center',
    paddingVertical: r(24),
  },
});
