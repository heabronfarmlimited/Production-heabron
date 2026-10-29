/**
 * Profile — ported from
 * modules/profile/presentation/view/profile_view.dart
 *
 * Dart layout: a pinned SliverAppBar (back + overflow menu), 'Profile Settings'
 * (20sp w600), a 91r avatar, a 'Personal Information' card, an 'Edit profile'
 * row, the bank-account tile, and a 'Logout' button (radius 28, h56).
 *
 * FIXED — the Dart `_ProfileItem` list passed `isLast: true` on 'Role' while
 * 'L.G.A' came after it, so the divider under Role went missing and the order
 * read oddly. Order here is Fullname, Phone number, NIN, State, L.G.A, Role,
 * with the separator logic derived from position.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { titleCase } from '../../../core/utils/format';
import { PersonIcon } from '../../auth/components/FieldIcons';
import { useLogout, useMe } from '../../auth/hooks/useAuth';
import { useUser } from '../../auth/model/authStore';
import { isBankAccountPopulated } from '../api/profileApi';
import { useBankAccount, useDeleteAccount } from '../hooks/useProfile';

export function ProfileScreen() {
  const router = useRouter();
  const user = useUser();
  const { isLoading } = useMe();
  const { data: bankAccount, isLoading: bankLoading } = useBankAccount();
  const { mutate: logout, isPending: loggingOut } = useLogout();
  const { mutate: deleteAccount, isPending: deleting } = useDeleteAccount();

  const [showLogout, setShowLogout] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const hasBank = isBankAccountPopulated(bankAccount);
  const last4 = bankAccount?.accountNumber?.slice(-4) ?? '';

  const items: Array<{ label: string; value: string }> = [
    { label: 'Fullname', value: user?.fullName ?? '' },
    { label: 'Phone number', value: user?.phone ?? '' },
    { label: 'NIN', value: user?.nin?.nin ?? '' },
    { label: 'State', value: user?.state ?? '' },
    { label: 'L.G.A', value: user?.lga ?? '' },
    { label: 'Role', value: titleCase(user?.role) },
  ];

  return (
    <AppSkeleton
      isBusy={isLoading && !user}
      appBarLeading={<AuthBackButton />}
      appBarActions={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More options"
          hitSlop={8}
          onPress={() => setShowDelete(true)}
          style={styles.menuButton}
        >
          <Text style={styles.menuGlyph}>⋮</Text>
        </Pressable>
      }
      scrollable
    >
      <Text style={styles.sectionHeading}>Profile Settings</Text>

      <View style={{ height: h(20) }} />

      <View style={styles.avatarWrap}>
        {user?.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <PersonIcon size={48} />
          </View>
        )}
      </View>

      <View style={{ height: h(28) }} />

      <Text style={styles.label}>Personal Information</Text>

      <View style={{ height: h(12) }} />

      <View style={styles.card}>
        {items.map((item, index) => (
          <ProfileItem
            key={item.label}
            label={item.label}
            value={item.value}
            isLast={index === items.length - 1}
          />
        ))}
      </View>

      <View style={{ height: h(20) }} />

      <Pressable
        accessibilityRole="button"
        style={styles.editRow}
        onPress={() => router.push(routes.profileEdit)}
      >
        <Text style={styles.editText}>Edit profile</Text>
        <Text style={styles.editGlyph}>✎</Text>
      </Pressable>

      <View style={{ height: h(20) }} />

      {bankLoading ? (
        <View style={styles.bankCardNeutral}>
          <Text style={styles.bankTitle}>Loading bank details…</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(routes.bankAccount)}
          style={hasBank ? styles.bankCardNeutral : styles.bankCardWarning}
        >
          <Text style={styles.bankGlyph}>{hasBank ? '🏦' : '⚠️'}</Text>
          <View style={styles.bankText}>
            <Text style={[styles.bankTitle, !hasBank && styles.bankTitleWarning]}>
              {hasBank ? 'Update Bank Details' : 'Add Bank Details'}
            </Text>
            <Text
              style={[styles.bankSubtitle, !hasBank && styles.bankSubtitleWarning]}
            >
              {hasBank
                ? `${bankAccount?.bankName} • ****${last4}`
                : 'Required to request financing'}
            </Text>
          </View>
        </Pressable>
      )}

      <View style={{ height: h(40) }} />

      <AppButton
        text="Logout"
        height={56}
        borderRadius={28}
        loading={loggingOut}
        onPress={() => setShowLogout(true)}
        testID="profile-logout"
      />

      <View style={{ height: h(24) }} />

      <ConfirmSheet
        visible={showLogout}
        title="Logout"
        message={
          'Are you sure you want to log out of your account? You’ll need to sign in again to access your dashboard, activities, and company updates. Any unsaved changes may be lost.'
        }
        cancelText="Cancel"
        confirmText="Logout"
        onCancel={() => setShowLogout(false)}
        onConfirm={() => {
          setShowLogout(false);
          logout();
        }}
      />

      <ConfirmSheet
        visible={showDelete}
        destructive
        title="Delete My Account"
        message="This action will delete all Cooperation, Farmer and associated data permanently"
        /**
         * Typing the agent's own full name is required to confirm — the Dart
         * sheet asked for it ('Enter Agent’s Fullname to continue') but
         * validated nothing and its confirm button only popped, leaving
         * `// TODO(heabron): wire delete account action`.
         */
        confirmationPrompt="Enter Agent’s Fullname to continue"
        confirmationPlaceholder="Enter agent’s full name"
        expectedConfirmation={user?.fullName ?? ''}
        cancelText="Cancel"
        confirmText="Yes, delete account"
        loading={deleting}
        onCancel={() => setShowDelete(false)}
        onConfirm={() => {
          setShowDelete(false);
          deleteAccount(undefined);
        }}
      />
    </AppSkeleton>
  );
}

function ProfileItem({
  label,
  value,
  isLast,
}: {
  label: string;
  value: string;
  isLast: boolean;
}) {
  return (
    <View style={[styles.item, !isLast && styles.itemDivider]}>
      <Text style={styles.itemLabel}>{label}</Text>
      <Text style={styles.itemValue} numberOfLines={1}>
        {value || '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeading: {
    ...textTheme.titleMedium,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  menuButton: {
    width: r(32),
    height: r(32),
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuGlyph: {
    fontSize: spMin(22),
    color: colors.black,
  },
  avatarWrap: {
    alignSelf: 'center',
  },
  avatar: {
    width: r(91),
    height: r(91),
    borderRadius: r(91),
  },
  avatarPlaceholder: {
    backgroundColor: colors.secondary100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: r(8),
    paddingHorizontal: r(12),
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: r(14),
    gap: r(12),
  },
  itemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemLabel: {
    ...textTheme.bodySmall,
    fontSize: spMin(13),
    color: colors.grey,
  },
  itemValue: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(6),
  },
  editText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  editGlyph: {
    fontSize: spMin(14),
  },
  bankCardNeutral: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(12),
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: r(8),
    padding: r(14),
  },
  /** Dart: bg #FFF7ED, border #FED7AA, icon #EA580C, subtitle #C2410C. */
  bankCardWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(12),
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: r(8),
    padding: r(14),
  },
  bankGlyph: {
    fontSize: spMin(20),
  },
  bankText: {
    flex: 1,
  },
  bankTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  bankTitleWarning: {
    color: '#C2410C',
  },
  bankSubtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  bankSubtitleWarning: {
    color: '#C2410C',
  },
});
