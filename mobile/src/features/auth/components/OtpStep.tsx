/**
 * Registration step 2 — ported from
 * .../view/widgets/email_verification_step.dart
 *
 * Dart layout: 'Enter the 6-digit code sent to\n{maskEmail(email)} '
 * (15sp w500, centred — note the trailing space in the original), 24 space,
 * the 6-cell code input, 16 space, right-aligned "Didn't get code? Resend".
 * Entering the sixth digit auto-advanced via `onCompleted`.
 *
 * On success this also logs in, because `signup/complete` and the selfie
 * upload both need a bearer token — the same sequence the Dart controller used.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppPinCodeField } from '../../../components/AppPinCodeField';
import { colors } from '../../../core/theme/colors';
import { h, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { maskEmail } from '../../../core/utils/format';
import { useResendSignupOtp, useVerifySignupOtp } from '../hooks/useAuth';
import { useRegistrationStore } from '../model/registrationStore';
import { otpSchema, type OtpForm } from '../model/validation';

import { NextButtonIcon } from './NextButtonIcon';

export function OtpStep() {
  const email = useRegistrationStore((s) => s.email);
  const password = useRegistrationStore((s) => s.password);
  const next = useRegistrationStore((s) => s.next);

  const { mutate: verify, isPending } = useVerifySignupOtp();
  const { mutate: resend, isPending: resending } = useResendSignupOtp();

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
    mode: 'onTouched',
    defaultValues: { code: '' },
  });

  const submit = (values: OtpForm) => {
    verify(
      { email, code: values.code, password },
      {
        onSuccess: () => next(),
        onError: () =>
          setError('code', { message: 'That code is incorrect or has expired.' }),
      },
    );
  };

  return (
    <View style={styles.container}>
      {/* Dart kept the trailing space after the masked address. */}
      <Text style={styles.prompt}>
        {`Enter the 6-digit code sent to\n${maskEmail(email)} `}
      </Text>

      <View style={{ height: h(24) }} />

      <Controller
        control={control}
        name="code"
        render={({ field }) => (
          <AppPinCodeField
            value={field.value}
            onChangeText={field.onChange}
            // Dart auto-advanced on the sixth digit.
            onCompleted={() => handleSubmit(submit)()}
            error={errors.code?.message}
            enabled={!isPending}
            testID="register-otp"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <View style={styles.resendRow}>
        <Text style={styles.muted}>Didn&apos;t get code? </Text>
        <Pressable
          accessibilityRole="button"
          disabled={resending}
          onPress={() => resend(email)}
          hitSlop={6}
        >
          <Text style={[styles.link, resending && styles.linkDisabled]}>
            Resend
          </Text>
        </Pressable>
      </View>

      <View style={{ height: h(68) }} />

      <AppButton
        text="Next"
        isOutlined
        bgColor={NEXT_BG}
        outlineColor={NEXT_OUTLINE}
        textColor={colors.greyDeep}
        iconAlignment="end"
        icon={<NextButtonIcon />}
        loading={isPending}
        onPress={handleSubmit(submit)}
        testID="register-otp-next"
      />
    </View>
  );
}

const NEXT_BG = '#F9FAFB';
const NEXT_OUTLINE = '#D1D5DB';

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  prompt: {
    ...textTheme.bodyMedium,
    fontSize: spMin(15),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    textAlign: 'center',
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
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
  linkDisabled: {
    opacity: 0.5,
  },
});
