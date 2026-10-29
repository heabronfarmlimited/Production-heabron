/**
 * Tab shell — replaces modules/home/views/home_view.dart and its
 * `CustomBottomBar`.
 *
 * Dart: `IndexedStack` over five screens (so all tabs stayed mounted) with a
 * hand-rolled bar — height 80, white, 1px `#DEE2E6` top border, padding
 * left 12 / right 16, 24 icon size, 10sp labels, `primary` when selected and
 * `grey` otherwise. `PopScope(canPop: false)` disabled the system back button.
 *
 * Tab order matches Dart exactly: Home, Cooperatives, Farmers, Activities,
 * Wallet. Several screens navigate by index, so the order is load-bearing.
 */
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { TabBarIcon } from '../../components/TabBarIcon';
import { colors } from '../../core/theme/colors';
import { h, r, spMin } from '../../core/theme/responsive';
import { fontWeights } from '../../core/theme/typography';

/** Dart: `AppColors.getColorFromHex('#DEE2E6')`. */
const BAR_BORDER = '#DEE2E6';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item,
        tabBarLabelStyle: styles.label,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.grey,
        // Dart `InkSparkle` with a yellow splash; RN has no splash colour here.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabBarIcon name="home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="cooperatives"
        options={{
          title: 'Cooperatives',
          tabBarIcon: ({ focused }) => (
            <TabBarIcon name="cooperatives" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="farmers"
        options={{
          title: 'Farmers',
          tabBarIcon: ({ focused }) => (
            <TabBarIcon name="farmers" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="activities"
        options={{
          title: 'Activities',
          tabBarIcon: ({ focused }) => (
            <TabBarIcon name="activities" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ focused }) => <TabBarIcon name="wallet" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: h(80),
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: BAR_BORDER,
    // Dart: EdgeInsets.only(right: 16, left: 12)
    paddingLeft: r(12),
    paddingRight: r(16),
    paddingTop: r(8),
    // Dart `showElevation: false` on the home screen.
    elevation: 0,
    shadowOpacity: 0,
  },
  item: {
    paddingVertical: r(4),
  },
  label: {
    fontSize: spMin(10),
    fontFamily: fontWeights.regular,
    fontWeight: '400',
    // Dart: 4px gap between icon and label.
    marginTop: r(4),
  },
});
