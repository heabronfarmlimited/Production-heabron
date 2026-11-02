/**
 * The fields a farmer inherits from their cooperative (v2 user flow: "Add
 * farmer from a cooperative — inherited fields read-only").
 *
 * Registration number, address, state, LGA and primary crop belong to the
 * cooperative, not to the farmer. Asking the agent to retype them for every
 * member was how members of one cooperative ended up recorded in three
 * different LGAs — and the LGA is part of the yield benchmark lookup and of
 * the report id, so a typo there changes the score and the document.
 *
 * They are shown rather than hidden because the agent needs to see what is
 * being attached to the farmer, and read-only because changing them here
 * would mean changing the cooperative.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

const DASH = '—';

export interface InheritedFieldsCardProps {
  cooperativeName?: string | null;
  registrationNumber?: string | null;
  address?: string | null;
  state?: string | null;
  lga?: string | null;
  primaryCrop?: string | null;
  /** Shown while the cooperative is still being fetched. */
  loading?: boolean;
}

export function InheritedFieldsCard({
  cooperativeName,
  registrationNumber,
  address,
  state,
  lga,
  primaryCrop,
  loading = false,
}: InheritedFieldsCardProps) {
  const rows: Array<[string, string]> = [
    ['Registration number', value(registrationNumber)],
    ['Cooperative address', value(address)],
    ['State', value(state)],
    ['LGA', value(lga)],
    ['Primary crop', value(primaryCrop)],
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {cooperativeName ? `From ${cooperativeName}` : 'From the cooperative'}
      </Text>
      <Text style={styles.hint}>
        {loading
          ? 'Loading the cooperative’s details…'
          : 'These come from the cooperative and cannot be changed here. The farmer’s own home address is asked for below.'}
      </Text>

      <View style={{ height: h(10) }} />

      {rows.map(([label, text]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} numberOfLines={2}>
            {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A blank inherited field shows a dash, not an empty space.
 *
 * A cooperative registered without a registration number is a real case —
 * the field is optional server-side — and an empty row would read as a
 * loading failure rather than as "the cooperative does not have one".
 */
function value(raw?: string | null): string {
  const trimmed = (raw ?? '').trim();
  return trimmed.length > 0 ? trimmed : DASH;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: r(12),
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(107, 114, 128, 0.05)',
    padding: r(14),
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  hint: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.secondaryTextColor,
    lineHeight: spMin(16),
    marginTop: h(2),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: r(12),
    paddingVertical: h(5),
  },
  label: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
    flexShrink: 0,
  },
  value: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.black,
    flexShrink: 1,
    textAlign: 'right',
  },
});
