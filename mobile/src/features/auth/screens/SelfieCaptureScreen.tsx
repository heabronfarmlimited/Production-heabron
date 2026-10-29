/**
 * Selfie capture — ported from
 * modules/authentication/presentation/view/image_verification_view.dart
 *
 * Dart layout: 20 space, AuthBackButton, 32 space, 'Verify your image'
 * (24sp w700), 12 space, the guidance paragraph (black @75 %, line height 1.5),
 * 32 space, a 260r circular preview ringed in primary @35 %, the caption
 * 'Position your head in the middle of the frame', then two circular icon
 * buttons (camera / gallery), a Spacer, and — only once a photo exists — a
 * 'Submit' button that simply popped back.
 */
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '../../../components/AppButton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { pickImage, takePhoto } from '../../../core/hooks/useMediaPicker';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { useRegistrationStore } from '../model/registrationStore';

export function SelfieCaptureScreen() {
  const router = useRouter();
  const selfie = useRegistrationStore((s) => s.selfie);
  const setSelfie = useRegistrationStore((s) => s.setSelfie);

  const handleCamera = async () => {
    const asset = await takePhoto();
    if (asset) setSelfie(asset);
  };

  const handleGallery = async () => {
    const asset = await pickImage();
    if (asset) setSelfie(asset);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={{ height: h(20) }} />

        <AuthBackButton />

        <View style={{ height: h(32) }} />

        <Text style={styles.title}>Verify your image</Text>

        <View style={{ height: h(12) }} />

        <Text style={styles.paragraph}>
          Stay still and position your face clearly inside the frame. Ensure you
          are in a well-lit area and take a clear photo for verification.
        </Text>

        <View style={{ height: h(32) }} />

        <View style={styles.previewWrap}>
          <View style={styles.ring}>
            {selfie ? (
              <Image
                source={{ uri: selfie.uri }}
                style={styles.image}
                accessibilityLabel="Your selfie"
              />
            ) : (
              <View style={styles.placeholder}>
                <View style={styles.personChip}>
                  <Text style={styles.personGlyph}>👤</Text>
                </View>
                <View style={{ height: h(16) }} />
                <Text style={styles.placeholderText}>
                  Your selfie will appear here
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ height: h(16) }} />

        <Text style={styles.caption}>
          Position your head in the middle of the frame
        </Text>

        <View style={{ height: h(24) }} />

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            style={styles.iconButton}
            onPress={handleCamera}
          >
            <Text style={styles.iconGlyph}>📷</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose from gallery"
            style={styles.iconButton}
            onPress={handleGallery}
          >
            <Text style={styles.iconGlyph}>🖼</Text>
          </Pressable>
        </View>

        <View style={styles.spacer} />

        {selfie ? (
          <AppButton
            text="Submit"
            onPress={() => router.back()}
            testID="selfie-submit"
          />
        ) : null}

        <View style={{ height: h(16) }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
    paddingHorizontal: r(16),
  },
  title: {
    ...textTheme.headlineSmall,
    fontSize: spMin(24),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  paragraph: {
    ...textTheme.bodyMedium,
    // Dart: AppColors.black.withValues(alpha: 0.75), height: 1.5
    color: 'rgba(0, 0, 0, 0.75)',
    lineHeight: spMin(14) * 1.5,
  },
  previewWrap: {
    alignItems: 'center',
  },
  ring: {
    width: r(260),
    height: r(260),
    borderRadius: r(260),
    borderWidth: 2,
    borderColor: 'rgba(46, 139, 87, 0.35)',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46, 139, 87, 0.08)',
    paddingHorizontal: r(16),
  },
  personChip: {
    padding: r(16),
    borderRadius: r(100),
    backgroundColor: 'rgba(46, 139, 87, 0.18)',
  },
  personGlyph: {
    fontSize: spMin(32),
  },
  placeholderText: {
    ...textTheme.bodySmall,
    color: colors.primary,
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    textAlign: 'center',
  },
  caption: {
    ...textTheme.bodySmall,
    color: colors.grey,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: r(24),
  },
  iconButton: {
    width: r(56),
    height: r(56),
    borderRadius: r(56),
    backgroundColor: 'rgba(46, 139, 87, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(46, 139, 87, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: spMin(22),
  },
  spacer: {
    flex: 1,
    minHeight: h(16),
  },
});
