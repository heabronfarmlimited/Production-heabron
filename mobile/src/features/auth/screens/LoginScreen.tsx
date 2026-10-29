/**
 * Login — ported from
 * modules/authentication/presentation/view/login_view.dart
 *
 * Layout from Dart, top to bottom: `app_bar_bg.png` header image, an
 * `AuthBackButton` over it, then 200 vertical space, 'Welcome Back' (24sp
 * w600), 20 space, the two-line subtitle (16sp w500 grey, centred), 32 space,
 * Email, 16 space, Password, 17 space, right-aligned 'Forgot Password? ',
 * 71 space, the Log in button, a Spacer, and the sign-up prompt.
 *
 * NOTE — the Dart screen rendered `AuthBackButton` twice (a copy/paste
 * duplicate); only one is rendered here.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { routes } from '../../../core/navigation/routes';
import { images } from '../../../core/theme/assets';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { EmailIcon, PasswordIcon } from '../components/FieldIcons';
import { useLogin } from '../hooks/useAuth';
import { loginSchema, type LoginForm } from '../model/validation';

export function LoginScreen() {
  const router = useRouter();
  const { mutate: login, isPending } = useLogin();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    // Dart: AutovalidateMode.onUserInteraction
    mode: 'onTouched',
    // NOTE — the Dart controller shipped kDebugMode credential prefills.
    // Deliberately omitted.
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (values: LoginForm) => {
    login({
      email: values.email.trim().toLowerCase(),
      password: values.password.trim(),
    });
  };

  return (
    <AppSkeleton isBusy={isPending} bodyPadding={styles.noPadding} scrollable>
      <Image source={images.appBarBg} style={styles.headerImage} resizeMode="cover" />

      <View style={styles.backButton}>
        <AuthBackButton />
      </View>

      <View style={styles.body}>
        <View style={{ height: h(200) }} />

        <Text style={styles.title}>Welcome Back</Text>

        <View style={{ height: h(20) }} />

        <Text style={styles.subtitle}>{'Sign in to CoopScore Field\nAgent'}</Text>

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
              testID="login-email"
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
              hintText="Enter password"
              isPassword
              prefix={<PasswordIcon />}
              autoComplete="password"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={errors.password?.message}
              testID="login-password"
            />
          )}
        />

        <View style={{ height: h(17) }} />

        <Pressable
          accessibilityRole="link"
          style={styles.forgotWrap}
          onPress={() => router.push(routes.forgotPassword)}
          hitSlop={6}
        >
          {/* Dart kept the trailing space inside the label. */}
          <Text style={styles.link}>Forgot Password? </Text>
        </Pressable>

        <View style={{ height: h(71) }} />

        <AppButton
          text="Log in"
          loading={isPending}
          onPress={handleSubmit(onSubmit)}
          testID="login-submit"
        />

        <View style={styles.spacer} />

        <View style={styles.signupRow}>
          <Text style={styles.muted}>Don’t have an account?</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(routes.register)}
            hitSlop={6}
          >
            <Text style={styles.link}> Sign Up</Text>
          </Pressable>
        </View>

        <View style={{ height: h(32) }} />
      </View>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  noPadding: {
    paddingHorizontal: 0,
  },
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
  forgotWrap: {
    alignSelf: 'flex-end',
  },
  link: {
    ...textTheme.bodySmall,
    fontSize: spMin(16),
    color: colors.primary,
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  muted: {
    ...textTheme.bodySmall,
    fontSize: spMin(16),
    color: colors.grey,
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  spacer: {
    flex: 1,
    minHeight: h(24),
  },
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
