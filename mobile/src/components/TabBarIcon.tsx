/**
 * Bottom-tab icons — the five SVGs from `assets/icons/nav/`, tinted to match
 * the Flutter `CustomBottomBar`: `AppColors.primary` when selected, else
 * `Colors.grey`.
 *
 * The Dart bar was a hand-rolled `Row` of `InkWell`s (height 80, white, 1px
 * `#DEE2E6` top border, 24 icon size, 10sp labels). expo-router's Tabs gives
 * the same thing declaratively; the sizing is matched in the tab layout.
 */
import ActivitiesIcon from '../assets/icons/nav/activities.svg';
import CooperativesIcon from '../assets/icons/nav/cooperatives.svg';
import FarmersIcon from '../assets/icons/nav/farmers.svg';
import HomeIcon from '../assets/icons/nav/home.svg';
import WalletIcon from '../assets/icons/nav/wallet.svg';
import { colors } from '../core/theme/colors';
import { r } from '../core/theme/responsive';

export type TabIconName = 'home' | 'cooperatives' | 'farmers' | 'activities' | 'wallet';

const ICONS = {
  home: HomeIcon,
  cooperatives: CooperativesIcon,
  farmers: FarmersIcon,
  activities: ActivitiesIcon,
  wallet: WalletIcon,
} as const;

export interface TabBarIconProps {
  name: TabIconName;
  focused: boolean;
  /** Dart `iconSize: 24`. */
  size?: number;
}

export function TabBarIcon({ name, focused, size = 24 }: TabBarIconProps) {
  const Icon = ICONS[name];
  const dimension = r(size);

  return (
    <Icon
      width={dimension}
      height={dimension}
      // Dart tinted the whole SVG with a ColorFilter.
      color={focused ? colors.primary : colors.grey}
      fill={focused ? colors.primary : colors.grey}
    />
  );
}
