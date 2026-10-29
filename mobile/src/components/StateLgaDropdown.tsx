/**
 * State + LGA pair — ported from lib/src/shared/state_lga_dropdown.dart
 *
 * Two dependent dropdowns driven by `assets/json/nigeria_states_lga.json`.
 * States are sorted alphabetically, LGAs are derived from the selected state
 * and sorted, and changing the state clears the LGA — same behaviour as Dart.
 *
 * Unlike the Dart version, the JSON is `require`d at module load instead of
 * read asynchronously from `rootBundle`, so the lists are populated on first
 * render (the Dart widget showed empty dropdowns until the async load
 * finished, which is why it needed the `didUpdateWidget` re-sync dance).
 *
 * State and LGA are stored as the human-readable names the backend expects —
 * `state: Joi.string()`, `lga: Joi.string()` — so no value mapping applies.
 */
import { useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

import type { Option } from '../core/api/domainConstants';
import { r } from '../core/theme/responsive';

import { AppDropdown } from './AppDropdown';

interface StateRecord {
  state: string;
  alias?: string;
  lgas: string[];
}

/** Loaded once; the dataset is static. */
const DATA = require('../assets/json/nigeria_states_lga.json') as StateRecord[];

const STATE_OPTIONS: Option[] = [...DATA]
  .map((r) => r.state)
  .sort((a, b) => a.localeCompare(b))
  .map((s) => ({ label: s, value: s }));

/** Pre-indexed so LGA lookup is O(1) rather than a `firstWhere` scan. */
const LGAS_BY_STATE = new Map<string, Option[]>(
  DATA.map((rec) => [
    rec.state,
    [...(rec.lgas ?? [])]
      .sort((a, b) => a.localeCompare(b))
      .map((l) => ({ label: l, value: l })),
  ]),
);

export const NIGERIA_STATES: readonly Option[] = STATE_OPTIONS;

export const lgasForState = (state?: string | null): Option[] =>
  (state && LGAS_BY_STATE.get(state)) || [];

export interface StateLgaDropdownProps {
  state?: string | null;
  lga?: string | null;
  onStateChange: (state: string) => void;
  /** Called with `''` when the state changes and the LGA is cleared. */
  onLgaChange: (lga: string) => void;
  stateError?: string;
  lgaError?: string;
  /** Dart default: `'State'`. */
  stateLabel?: string;
  /** Dart default: `'Local Government Area'`. */
  lgaLabel?: string;
  /** Dart default: 16. */
  spacing?: number;
  hasRequired?: boolean;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function StateLgaDropdown({
  state,
  lga,
  onStateChange,
  onLgaChange,
  stateError,
  lgaError,
  stateLabel = 'State',
  lgaLabel = 'Local Government Area',
  spacing = 16,
  hasRequired = false,
  enabled = true,
  style,
}: StateLgaDropdownProps) {
  const lgaOptions = useMemo(() => lgasForState(state), [state]);

  return (
    <View style={style}>
      <AppDropdown
        title={stateLabel}
        label="Select State"
        options={STATE_OPTIONS}
        value={state ?? null}
        error={stateError}
        enabled={enabled}
        hasRequired={hasRequired}
        searchable
        onChange={(next) => {
          if (next === state) return;
          onStateChange(next);
          // Changing state invalidates the LGA.
          onLgaChange('');
        }}
        testID="state-dropdown"
      />

      <View style={{ height: r(spacing) }} />

      <AppDropdown
        title={lgaLabel}
        label="Select LGA"
        options={lgaOptions}
        value={lga ?? null}
        error={lgaError}
        // An LGA cannot be chosen before a state.
        enabled={enabled && lgaOptions.length > 0}
        hasRequired={hasRequired}
        searchable
        onChange={onLgaChange}
        testID="lga-dropdown"
      />
    </View>
  );
}
