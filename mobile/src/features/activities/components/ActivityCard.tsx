/**
 * Activity card — ports `_ActivityCard` from activities_view.dart, plus the
 * per-tab icon and colour selection that the Dart view did inline.
 *
 * Card chrome (identical for every tab): 12r bottom margin, 16r padding,
 * radius 16, white, `grey @ 10%` border; a 40r rounded square (radius 12)
 * holding a 20r icon; title 14sp w600; subtitle 12sp grey rendered through
 * `replaceAll('_',' ').toTitleCase()`; trailing time 10sp grey.
 *
 * Icon + colour per kind, exactly as recorded in the audit:
 *   repayment  account_balance_wallet  green            green.shade50
 *   import     by derived statusText:
 *                completed | success   green            green @ 10%
 *                failed                red              red @ 10%
 *                partial               orange           orange @ 10%
 *                (anything else)       orange           orange @ 10%  upload_file
 *   delivery   local_shipping          primary          primary @ 10%   [new]
 *
 * NOTE — core's `titleCase` capitalises each word's first letter and leaves
 * the rest alone, where Dart's `change_case.toTitleCase()` also lowercases the
 * remainder. The difference only shows on already-uppercase input, and leaving
 * the remainder alone keeps names like 'McDonald' intact.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { titleCase } from '../../../core/utils/format';
import { importStatusText, type AgentImport } from '../model/agentImport';
import type { CombinedActivity } from '../model/combinedActivity';
import { withAlpha } from '../utils/color';

import {
  CheckCircleIcon,
  ErrorIcon,
  TruckIcon,
  UploadIcon,
  WalletIcon,
  WarningIcon,
} from './ActivityIcons';

/** Dart `Colors.green.shade50` — the repayment icon background. */
const GREEN_50 = '#E8F5E9';

export interface ActivityCardProps {
  title: string;
  subtitle: string;
  time: string;
  icon: ReactNode;
  iconBgColor: string;
}

export function ActivityCard({
  title,
  subtitle,
  time,
  icon,
  iconBgColor,
}: ActivityCardProps) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconBox, { backgroundColor: iconBgColor }]}>{icon}</View>

      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.gap6} />
        <Text style={styles.subtitle}>{titleCase(subtitle)}</Text>
      </View>

      <Text style={styles.time}>{time}</Text>
    </View>
  );
}

/** The icon + background an import's derived status maps to. */
function importVisuals(item?: AgentImport): { icon: ReactNode; bg: string } {
  switch (item ? importStatusText(item).toLowerCase() : '') {
    case 'completed':
    case 'success':
      return {
        icon: <CheckCircleIcon color={colors.green} size={20} />,
        bg: withAlpha(colors.green, 0.1),
      };
    case 'failed':
      return {
        icon: <ErrorIcon color={colors.red} size={20} />,
        bg: withAlpha(colors.red, 0.1),
      };
    case 'partial':
      return {
        icon: <WarningIcon color={colors.orange} size={20} />,
        bg: withAlpha(colors.orange, 0.1),
      };
    // Dart's initial values: `Colors.orange` + `Icons.upload_file`.
    default:
      return {
        icon: <UploadIcon color={colors.orange} size={20} />,
        bg: withAlpha(colors.orange, 0.1),
      };
  }
}

/**
 * Renders any combined activity with the right icon for its kind — used by
 * all four tabs so a repayment looks the same in 'All' as in 'Repayments'.
 */
export function ActivityCardFor({ activity }: { activity: CombinedActivity }) {
  if (activity.kind === 'repayment') {
    return (
      <ActivityCard
        title={activity.title}
        subtitle={activity.subtitle}
        time={activity.time}
        icon={<WalletIcon color={colors.green} size={20} />}
        iconBgColor={GREEN_50}
      />
    );
  }

  if (activity.kind === 'import') {
    const { icon, bg } = importVisuals(activity.import);
    return (
      <ActivityCard
        title={activity.title}
        subtitle={activity.subtitle}
        time={activity.time}
        icon={icon}
        iconBgColor={bg}
      />
    );
  }

  return (
    <ActivityCard
      title={activity.title}
      subtitle={activity.subtitle}
      time={activity.time}
      icon={<TruckIcon color={colors.primary} size={20} />}
      iconBgColor={withAlpha(colors.primary, 0.1)}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: r(12),
    padding: r(16),
    borderRadius: r(16),
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: withAlpha(colors.grey, 0.1),
  },
  iconBox: {
    width: r(40),
    height: r(40),
    borderRadius: r(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    marginLeft: r(12),
  },
  gap6: {
    height: r(6),
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.secondaryBlack600,
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  time: {
    ...textTheme.bodySmall,
    marginLeft: r(8),
    fontSize: spMin(10),
    color: colors.grey,
  },
});
