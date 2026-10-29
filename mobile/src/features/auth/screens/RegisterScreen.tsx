/**
 * Registration — ported from
 * modules/authentication/presentation/view/register_view.dart plus its three
 * step widgets (email_step, email_verification_step, personal_info_step).
 *
 * Dart layout: `app_bar_bg.png` header, 200 space, 'Create an account'
 * (24sp w600), 12 space, 'Become a CoopScore Field Agent' (16sp w500 grey),
 * 26 space, StepIndicator, 46 space, the step body, 68 space, then either
 * 'Next' (outlined, trailing arrow) or 'Submit' (filled) on the last step, a
 * Spacer, and — on step 0 only — the login prompt.
 *
 * Each step is its own form so a validation failure on step 3 cannot be
 * confused with step 1's fields (the Dart version shared one `formKey` across
 * all three, so `formKey.currentState.validate()` validated whichever widgets
 * happened to be mounted).
 */
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { routes } from '../../../core/navigation/routes';
import { images } from '../../../core/theme/assets';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { CredentialsStep } from '../components/CredentialsStep';
import { OtpStep } from '../components/OtpStep';
import { PersonalInfoStep } from '../components/PersonalInfoStep';
import { StepIndicator } from '../components/StepIndicator';
import { REGISTRATION_STEPS, useRegistrationStore } from '../model/registrationStore';

export function RegisterScreen() {
  const router = useRouter();
  const step = useRegistrationStore((s) => s.step);
  const back = useRegistrationStore((s) => s.back);
  const reset = useRegistrationStore((s) => s.reset);

  // Back steps within the wizard before leaving it, so an agent on step 3
  // doesn't lose the whole flow with one tap.
  const handleBack = () => {
    if (step > 0) {
      back();
      return;
    }
    reset();
    router.back();
  };

  return (
    <AppSkeleton bodyPadding={styles.noPadding} scrollable>
      <Image source={images.appBarBg} style={styles.headerImage} resizeMode="cover" />

      <View style={styles.backButton}>
        <AuthBackButton onPress={handleBack} />
      </View>

      <View style={styles.body}>
        <View style={{ height: h(200) }} />

        <Text style={styles.title}>Create an account</Text>

        <View style={{ height: h(12) }} />

        <Text style={styles.subtitle}>Become a CoopScore Field Agent</Text>

        <View style={{ height: h(26) }} />

        <StepIndicator currentStep={step} totalSteps={REGISTRATION_STEPS} />

        <View style={{ height: h(46) }} />

        {step === 0 ? <CredentialsStep /> : null}
        {step === 1 ? <OtpStep /> : null}
        {step === 2 ? <PersonalInfoStep /> : null}

        {step === 0 ? (
          <>
            <View style={styles.spacer} />
            <View style={styles.loginRow}>
              <Text style={styles.muted}>Already have account? </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  reset();
                  router.replace(routes.login);
                }}
                hitSlop={6}
              >
                <Text style={styles.link}>Login</Text>
              </Pressable>
            </View>
          </>
        ) : null}

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
  spacer: {
    flex: 1,
    minHeight: h(24),
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
});
