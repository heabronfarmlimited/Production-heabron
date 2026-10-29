/**
 * Edit profile — ported from
 * modules/profile/presentation/view/edit_profile_view.dart
 *
 * Dart layout: 'Edit Profile' (22sp w700), a 100r avatar with a camera badge
 * (tap -> gallery), then Full name, Phone number, the State/LGA pair, and a
 * footer with 'Discard' (outlined) and 'Save changes'.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { StateLgaDropdown } from '../../../components/StateLgaDropdown';
import { useImageField } from '../../../core/hooks/useMediaPicker';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { PersonIcon, PhoneIcon } from '../../auth/components/FieldIcons';
import { useUser } from '../../auth/model/authStore';
import { editProfileSchema, type EditProfileForm } from '../../auth/model/validation';
import { useUpdateProfile } from '../hooks/useProfile';

export function EditProfileScreen() {
  const router = useRouter();
  const user = useUser();
  const { mutate: save, isPending } = useUpdateProfile();

  const avatar = useImageField('avatar', user?.avatarUrl ?? null);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<EditProfileForm>({
    resolver: zodResolver(editProfileSchema),
    mode: 'onTouched',
    defaultValues: {
      fullName: user?.fullName ?? '',
      phone: user?.phone ?? '',
      // Prefilled, unlike the Dart edit forms which left these blank and
      // forced a re-select.
      state: user?.state ?? '',
      lga: user?.lga ?? '',
    },
  });

  const state = watch('state');
  const lga = watch('lga');

  const onSubmit = (values: EditProfileForm) => {
    save({
      fullName: values.fullName,
      phone: values.phone,
      state: values.state,
      lga: values.lga,
      avatarUrl: avatar.url ?? undefined,
    });
  };

  return (
    <AppSkeleton
      isBusy={isPending}
      appBarLeading={<AuthBackButton />}
      scrollable
    >
      <View style={{ height: h(12) }} />

      <Text style={styles.title}>Edit Profile</Text>

      <View style={{ height: h(24) }} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change profile photo"
        style={styles.avatarWrap}
        onPress={avatar.chooseFromLibrary}
        disabled={avatar.uploading}
      >
        <View style={styles.avatar}>
          {avatar.previewUri ? (
            <Image source={{ uri: avatar.previewUri }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <PersonIcon size={40} />
            </View>
          )}
        </View>

        <View style={styles.cameraBadge}>
          {avatar.uploading ? (
            <AppLoading color={colors.white} />
          ) : (
            <Text style={styles.cameraGlyph}>📷</Text>
          )}
        </View>
      </Pressable>

      <View style={{ height: h(28) }} />

      <Controller
        control={control}
        name="fullName"
        render={({ field }) => (
          <AppTextField
            title="Full name"
            hintText="Enter your full name"
            prefix={<PersonIcon />}
            autoCapitalize="words"
            maxLength={120}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.fullName?.message}
            testID="profile-full-name"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <AppTextField
            title="Phone number"
            hintText="Enter phone number"
            prefix={<PhoneIcon />}
            keyboardType="phone-pad"
            maxLength={11}
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.phone?.message}
            testID="profile-phone"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <StateLgaDropdown
        state={state}
        lga={lga}
        onStateChange={(next) => setValue('state', next, { shouldValidate: true })}
        onLgaChange={(next) => setValue('lga', next, { shouldValidate: true })}
        stateError={errors.state?.message}
        lgaError={errors.lga?.message}
      />

      <View style={{ height: h(40) }} />

      <View style={styles.footer}>
        <View style={styles.footerButton}>
          <AppButton
            text="Discard"
            isOutlined
            onPress={() => router.back()}
            testID="profile-discard"
          />
        </View>
        <View style={{ width: r(12) }} />
        <View style={styles.footerButton}>
          <AppButton
            text="Save changes"
            loading={isPending}
            onPress={handleSubmit(onSubmit)}
            testID="profile-save"
          />
        </View>
      </View>

      <View style={{ height: h(24) }} />
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  title: {
    ...textTheme.headlineMedium,
    fontSize: spMin(22),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  avatarWrap: {
    alignSelf: 'center',
  },
  avatar: {
    width: r(100),
    height: r(100),
    borderRadius: r(100),
    overflow: 'hidden',
    backgroundColor: colors.secondary100,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: r(32),
    height: r(32),
    borderRadius: r(32),
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  cameraGlyph: {
    fontSize: spMin(14),
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerButton: {
    flex: 1,
  },
});
