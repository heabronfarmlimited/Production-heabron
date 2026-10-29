/**
 * Registration step 1 — ported from
 * .../view/widgets/email_step.dart
 *
 * Fields: Email ('Enter email', Icons.email), Password ('Create password',
 * Icons.lock), Confirm password ('Confirm password', Icons.lock), with the
 * five password complexity rules from the Dart validators.
 *
 * FIXED — the Dart confirm-password field had no controller attached, so its
 * validator compared `val` against the password while the field itself never
 * stored anything the form could submit. Here both are real form fields and
 * the match check lives in the Zod schema.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppTextField } from '../../../components/AppTextField';
import { colors } from '../../../core/theme/colors';
import { h } from '../../../core/theme/responsive';
import { useSignup } from '../hooks/useAuth';
import { applyFieldErrors } from '../hooks/useAuth';
import { useRegistrationStore } from '../model/registrationStore';
import {
  registerCredentialsSchema,
  type RegisterCredentialsForm,
} from '../model/validation';

import { EmailIcon, PasswordIcon } from './FieldIcons';
import { NextButtonIcon } from './NextButtonIcon';

export function CredentialsStep() {
  const setCredentials = useRegistrationStore((s) => s.setCredentials);
  const next = useRegistrationStore((s) => s.next);
  const email = useRegistrationStore((s) => s.email);
  const password = useRegistrationStore((s) => s.password);

  const { mutate: signup, isPending } = useSignup();

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterCredentialsForm>({
    resolver: zodResolver(registerCredentialsSchema),
    mode: 'onTouched',
    // Pre-filled when stepping back from the OTP screen.
    defaultValues: { email, password, confirmPassword: password },
  });

  const onSubmit = (values: RegisterCredentialsForm) => {
    const cleanEmail = values.email.trim().toLowerCase();
    const cleanPassword = values.password.trim();

    signup(
      { email: cleanEmail, password: cleanPassword },
      {
        onSuccess: () => {
          // Held so step 2 can log in straight after verifying the OTP.
          setCredentials(cleanEmail, cleanPassword);
          next();
        },
        onError: (err) => {
          // A duplicate email comes back as a field error; show it on the field.
          applyFieldErrors<RegisterCredentialsForm>(err, setError);
        },
      },
    );
  };

  return (
    <View style={styles.container}>
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
            testID="register-email"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <AppTextField
            title="Password"
            hintText="Create password"
            isPassword
            prefix={<PasswordIcon />}
            autoComplete="password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.password?.message}
            testID="register-password"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="confirmPassword"
        render={({ field }) => (
          <AppTextField
            title="Confirm password"
            hintText="Confirm password"
            isPassword
            prefix={<PasswordIcon />}
            autoComplete="password"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.confirmPassword?.message}
            testID="register-confirm-password"
          />
        )}
      />

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
        onPress={handleSubmit(onSubmit)}
        testID="register-next"
      />
    </View>
  );
}

/** Dart: `bgColor: Color(0Xfff9fafb)`, `outlineColor: Color(0xFFD1D5DB)`. */
const NEXT_BG = '#F9FAFB';
const NEXT_OUTLINE = '#D1D5DB';

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
});
