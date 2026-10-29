/**
 * Pre-auth landing — ported from
 * modules/startup/presentation/view/pre_auth_view.dart
 *
 * Dart layout: `auth_bg.png` as a cover background, 193 vertical space then
 * `preauth_icon_center.png` (full width, 181h). A white bottom sheet with
 * 24r top corners holds 32 space, 'Sign up' (filled), 16 space, 'Log in'
 * (outlined, bg `#F9FAFB`, outline `#D1D5DB`, text `greyDeep`), 32 space.
 */
import { useRouter } from 'expo-router';
import { Image, ImageBackground, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '../../../components/AppButton';
import { routes } from '../../../core/navigation/routes';
import { images } from '../../../core/theme/assets';
import { colors } from '../../../core/theme/colors';
import { h, r } from '../../../core/theme/responsive';

/** Dart: `bgColor: Color(0Xfff9fafb)`, `outlineColor: Color(0xFFD1D5DB)`. */
const LOGIN_BG = '#F9FAFB';
const LOGIN_OUTLINE = '#D1D5DB';

export function PreAuthScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <ImageBackground
        source={images.authBg}
        style={styles.background}
        resizeMode="cover"
      >
        <SafeAreaView style={styles.flex} edges={['top']}>
          <View style={styles.body}>
            <View style={{ height: h(193) }} />
            <Image
              source={images.preAuthIconCenter}
              style={styles.hero}
              resizeMode="contain"
            />
          </View>
        </SafeAreaView>

        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetInner}>
            <View style={{ height: h(32) }} />

            <AppButton
              text="Sign up"
              onPress={() => router.push(routes.register)}
              testID="preauth-signup"
            />

            <View style={{ height: h(16) }} />

            <AppButton
              text="Log in"
              isOutlined
              bgColor={LOGIN_BG}
              outlineColor={LOGIN_OUTLINE}
              textColor={colors.greyDeep}
              onPress={() => router.push(routes.login)}
              testID="preauth-login"
            />

            <View style={{ height: h(32) }} />
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  background: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: r(16),
  },
  hero: {
    width: '100%',
    height: h(181),
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: r(24),
    borderTopRightRadius: r(24),
    overflow: 'hidden',
  },
  sheetInner: {
    paddingHorizontal: r(16),
    paddingVertical: r(24),
  },
});
