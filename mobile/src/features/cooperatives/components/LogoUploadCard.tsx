/**
 * The logo upload target from `create_cooperative_view.dart` /
 * `edit_cooperative_view.dart`.
 *
 * Dart: full-width box, 32r vertical padding, `primary@0.08` fill, radius 16,
 * a 1.5px `primary@0.35` border; empty state is a 56r `primary@0.15` circle
 * holding a 28r cloud-upload icon, 16 space, `'Upload image / logo'` at 15sp
 * w600 primary, 8 space, a 20r downward arrow. Once a file is picked the box
 * fills with it (`BoxFit.cover`) and the children collapse.
 *
 * NOTE — on the edit form the Dart version rendered an *existing* logo URL
 * inside the little 56r circle while a newly picked file filled the whole box,
 * so the same field looked different depending on where the image came from.
 * Both render as the full-bleed preview here.
 */
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface LogoUploadCardProps {
  /** Local URI or remote URL; null shows the empty state. */
  previewUri?: string | null;
  uploading?: boolean;
  onPress: () => void;
  label?: string;
}

export function LogoUploadCard({
  previewUri,
  uploading = false,
  onPress,
  label = 'Upload image / logo',
}: LogoUploadCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: uploading }}
      onPress={onPress}
      style={styles.box}
      testID="cooperative-logo-upload"
    >
      {previewUri ? (
        <Image source={{ uri: previewUri }} style={styles.preview} contentFit="cover" />
      ) : (
        <View style={styles.empty}>
          <View style={styles.circle}>
            {uploading ? (
              <AppLoading color={colors.primary} />
            ) : (
              <Text style={styles.uploadGlyph}>☁</Text>
            )}
          </View>

          <View style={{ height: h(16) }} />

          <Text style={styles.label}>{label}</Text>

          <View style={{ height: h(8) }} />

          <Text style={styles.arrow}>↓</Text>
        </View>
      )}

      {previewUri && uploading ? (
        <View style={styles.overlay}>
          <AppLoading color={colors.white} size="large" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    minHeight: r(160),
    borderRadius: r(16),
    borderWidth: 1.5,
    // Dart: AppColors.primary.withValues(alpha: 0.35) / 0.08
    borderColor: 'rgba(46, 139, 87, 0.35)',
    backgroundColor: 'rgba(46, 139, 87, 0.08)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: r(32),
  },
  circle: {
    width: r(56),
    height: r(56),
    borderRadius: r(56),
    // Dart: AppColors.primary.withValues(alpha: 0.15)
    backgroundColor: 'rgba(46, 139, 87, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadGlyph: {
    fontSize: spMin(28),
    color: colors.primary,
  },
  label: {
    ...textTheme.bodyMedium,
    fontSize: spMin(15),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
  },
  arrow: {
    fontSize: spMin(20),
    color: colors.primary,
  },
  preview: {
    width: '100%',
    height: r(160),
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
