/**
 * Forgot password — ported from
 * .../view/forgotPassword/forgot_password_view.dart
 *
 * Copy: 'Forgot Password' / 'Enter your email address and we’ll send you a
 * code to reset your password.' One Email field, button 'Send Code'.
 */
import { zodResolver } from '@hookform/resolvers/zod';
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
import { EmailIcon } from '../components/FieldIcons';
import { useForgotPassword } from '../hooks/useAuth';
import { forgotPasswordSchema, type ForgotPasswordForm } from '../model/validation';

export function ForgotPasswordScreen() {
  const { mutate: sendCode, isPending } = useForgotPassword();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });

  return (
    <AppSkeleton isBusy={isPending} bodyPadding={styles.noPadding} scrollable>
      <Image source={images.appBarBg} style={styles.headerImage} resizeMode="cover" />

      <View style={styles.backButton}>
        <AuthBackButton />
      </View>

      <View style={styles.body}>
        <View style={{ height: h(200) }} />

        <Text style={styles.title}>Forgot Password</Text>

        <View style={{ height: h(20) }} />

        <Text style={styles.subtitle}>
          Enter your email address and we’ll send you a code to reset your
          password.
        </Text>

        <View style={{ height: h(32) }} />

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <AppTextField
              title="Email"
              hintText="Enter email"
              prefix={<EmailIcon />}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.email?.message}
              testID="forgot-email"
            />
          )}
        />

        <View style={{ height: h(48) }} />

        <AppButton
          text="Send Code"
          loading={isPending}
          onPress={handleSubmit((v) => sendCode(v.email.trim().toLowerCase()))}
          testID="forgot-submit"
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
  backButton: {
    paddingHorizontal: r(16),
    paddingTop: r(8),
  },
  body: {
    flex: 1,
    paddingHorizontal: r(16),
    alignItems: 'center',
  },
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
