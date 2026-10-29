/**
 * Verify password-reset code — ported from
 * .../view/forgotPassword/verify_forgotpassword_otp_view.dart
 *
 * Copy: 'Enter the 6 digit code ' / 'Enter the 6-digit code sent to
 * {maskEmail(email)}.' One 6-cell code input, a 'Resend' link, button 'Next'.
 *
 * NOTE — like the Dart screen, this performs no network call. The code is
 * verified server-side by `POST /auth/reset-password`, so it is carried
 * forward as a route param and a wrong code surfaces on the next screen.
 * That is the backend's design: there is no verify-only endpoint for the
 * `reset` purpose.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppPinCodeField } from '../../../components/AppPinCodeField';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { routes } from '../../../core/navigation/routes';
import { images } from '../../../core/theme/assets';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { maskEmail } from '../../../core/utils/format';
import { NextButtonIcon } from '../components/NextButtonIcon';
import { useForgotPassword } from '../hooks/useAuth';
import { otpSchema, type OtpForm } from '../model/validation';

export function VerifyResetOtpScreen() {
  const router = useRouter();
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const { mutate: resend, isPending: resending } = useForgotPassword();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
    mode: 'onTouched',
    defaultValues: { code: '' },
  });

  const proceed = (values: OtpForm) => {
    router.replace({
      pathname: routes.forgotPasswordReset,
      params: { email, otp: values.code },
    });
  };

  return (
    <AppSkeleton bodyPadding={styles.noPadding} scrollable>
      <Image source={images.appBarBg} style={styles.headerImage} resizeMode="cover" />

      <View style={styles.backButton}>
        <AuthBackButton />
      </View>

      <View style={styles.body}>
        <View style={{ height: h(200) }} />

        {/* Dart kept the trailing space in this heading. */}
        <Text style={styles.title}>Enter the 6 digit code </Text>

        <View style={{ height: h(20) }} />

        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to {maskEmail(email)}.
        </Text>

        <View style={{ height: h(32) }} />

        <Controller
          control={control}
          name="code"
          render={({ field }) => (
            <AppPinCodeField
              value={field.value}
              onChangeText={field.onChange}
              onCompleted={() => handleSubmit(proceed)()}
              error={errors.code?.message}
              testID="reset-otp"
            />
          )}
        />

        <View style={{ height: h(16) }} />

        <View style={styles.resendRow}>
          <Text style={styles.muted}>Didn&apos;t get code? </Text>
          <Pressable
            accessibilityRole="button"
            disabled={resending || !email}
            onPress={() => resend(email)}
            hitSlop={6}
          >
            <Text style={[styles.link, resending && styles.linkDisabled]}>
              Resend
            </Text>
          </Pressable>
        </View>

        <View style={{ height: h(48) }} />

        <AppButton
          text="Next"
          isOutlined
          bgColor={NEXT_BG}
          outlineColor={NEXT_OUTLINE}
          textColor={colors.greyDeep}
          iconAlignment="end"
          icon={<NextButtonIcon />}
          onPress={handleSubmit(proceed)}
          testID="reset-otp-next"
        />
      </View>
    </AppSkeleton>
  );
}

const NEXT_BG = '#F9FAFB';
const NEXT_OUTLINE = '#D1D5DB';

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
    textAlign: 'center',
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(16),
    color: colors.grey,
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    textAlign: 'center',
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
  },
  muted: {
    ...textTheme.bodySmall,
    fontSize: spMin(16),
    color: colors.grey,
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  link: {
    ...textTheme.bodySmall,
    fontSize: spMin(16),
    color: colors.primary,
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  linkDisabled: { opacity: 0.5 },
});
