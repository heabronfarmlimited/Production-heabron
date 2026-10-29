/**
 * Set a new password — ported from
 * .../view/forgotPassword/reset_password_view.dart
 *
 * Copy: 'Create new password' / 'Set a new password to secure your\naccount
 * and regain access.' Fields 'New Password' ('Enter new password') and
 * 'Confirm Password' ('Confirm new password'); button 'Create new password'.
 *
 * FIXED — two defects in the Dart screen:
 *  1. Neither field set `isPassword`, so both rendered as **plain visible
 *     text** while the user typed a new password.
 *  2. It enforced only `minLength(8)` here while registration enforced five
 *     complexity rules, letting a user reset to a password they could not have
 *     registered with. Both now share `resetPasswordSchema`, and the
 *     match check is in the schema rather than a post-submit toast.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Image, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { images } from '../../../core/theme/assets';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { showError } from '../../../core/utils/toast';
import { PasswordIcon } from '../components/FieldIcons';
import { useResetPassword } from '../hooks/useAuth';
import { resetPasswordSchema, type ResetPasswordForm } from '../model/validation';

export function ResetPasswordScreen() {
  const { email = '', otp = '' } = useLocalSearchParams<{
    email?: string;
    otp?: string;
  }>();

  const { mutate: reset, isPending } = useResetPassword();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = (values: ResetPasswordForm) => {
    if (!email || !otp) {
      showError('Your reset link has expired. Please request a new code.');
      return;
    }
    reset({ email, code: otp, newPassword: values.password });
  };

  return (
    <AppSkeleton isBusy={isPending} bodyPadding={styles.noPadding} scrollable>
      <Image source={images.appBarBg} style={styles.headerImage} resizeMode="cover" />

      <View style={styles.backButton}>
        <AuthBackButton />
      </View>

      <View style={styles.body}>
        <View style={{ height: h(200) }} />

        <Text style={styles.title}>Create new password</Text>

        <View style={{ height: h(20) }} />

        <Text style={styles.subtitle}>
          {'Set a new password to secure your\naccount and regain access.'}
        </Text>

        <View style={{ height: h(32) }} />

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <AppTextField
              title="New Password"
              hintText="Enter new password"
              isPassword
              prefix={<PasswordIcon />}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.password?.message}
              testID="reset-password"
            />
          )}
        />

        <View style={{ height: h(16) }} />

        <Controller
          control={control}
          name="confirmPassword"
          render={({ field }) => (
            <AppTextField
              title="Confirm Password"
              hintText="Confirm new password"
              isPassword
              prefix={<PasswordIcon />}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.confirmPassword?.message}
              testID="reset-confirm-password"
            />
          )}
        />

        <View style={{ height: h(48) }} />

        <AppButton
          text="Create new password"
          loading={isPending}
          onPress={handleSubmit(onSubmit)}
          testID="reset-submit"
        />
      </View>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  noPadding: { paddingHorizontal: 0 },
  headerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: h(240),
    width: '100%',
  },
  backButton: { paddingHorizontal: r(16), paddingTop: r(8) },
  body: { flex: 1, paddingHorizontal: r(16), alignItems: 'center' },
  title: {
    ...textTheme.headlineMedium,
    fontSize: spMin(24),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(16),
    color: colors.grey,
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    textAlign: 'center',
  },
});
