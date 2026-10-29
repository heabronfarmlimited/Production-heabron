/**
 * Farm-image dialog + fullscreen pager — ports `_showImagesDialog` and
 * `_showFullScreenImageGallery` from farmer_details_view.dart (and the
 * near-identical copy in production_yield_details_view.dart).
 *
 * Dialog: `'Farm Images'` + close button, a horizontal 250h strip of 200w
 * thumbnails, footer `'Tap on an image to view in full screen'`.
 * Fullscreen: a paged viewer on black with the title `'Photo'` and a close
 * button, `BoxFit.contain`.
 *
 * `InteractiveViewer(minScale: 0.5, maxScale: 4)` has no RN equivalent without
 * a gesture library, so the fullscreen page uses a `ScrollView` with
 * `maximumZoomScale={4}` / `minimumZoomScale={0.5}` — pinch-to-zoom on iOS, and
 * the full-width contained image on Android. Noted as a deviation.
 */
import { useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin, w } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface ImageGalleryDialogProps {
  visible: boolean;
  onClose: () => void;
  urls: string[];
  /** Dart: `'Farm Images'`. */
  title?: string;
  /** Dart footer copy. */
  footer?: string;
}

export function ImageGalleryDialog({
  visible,
  onClose,
  urls,
  title = 'Farm Images',
  footer = 'Tap on an image to view in full screen',
}: ImageGalleryDialogProps) {
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialog}>
            <View style={styles.dialogHeader}>
              <Text accessibilityRole="header" style={styles.dialogTitle}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                onPress={onClose}
              >
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <View style={{ height: h(16) }} />

            <FlatList
              horizontal
              data={urls}
              keyExtractor={(url, index) => `${url}-${index}`}
              showsHorizontalScrollIndicator={false}
              style={styles.strip}
              ItemSeparatorComponent={() => <View style={{ width: r(12) }} />}
              renderItem={({ item, index }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open photo ${index + 1} full screen`}
                  onPress={() => setFullscreenIndex(index)}
                  style={styles.thumbWrap}
                >
                  <GalleryImage uri={item} style={styles.thumb} resizeMode="cover" />
                </Pressable>
              )}
            />

            <View style={{ height: h(12) }} />

            <Text style={styles.footer}>{footer}</Text>
          </View>
        </View>
      </Modal>

      <FullscreenImagePager
        visible={fullscreenIndex != null}
        urls={urls}
        initialIndex={fullscreenIndex ?? 0}
        onClose={() => setFullscreenIndex(null)}
      />
    </>
  );
}

export interface FullscreenImagePagerProps {
  visible: boolean;
  urls: string[];
  initialIndex?: number;
  onClose: () => void;
  /** Dart used `'Photo'` on farmer details and `'Photo Preview'` on yields. */
  title?: string;
}

export function FullscreenImagePager({
  visible,
  urls,
  initialIndex = 0,
  onClose,
  title = 'Photo',
}: FullscreenImagePagerProps) {
  const width = Dimensions.get('window').width;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.fullscreen} edges={['top', 'bottom']}>
        <View style={styles.fullscreenBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={styles.fullscreenClose}>✕</Text>
          </Pressable>
          <Text style={styles.fullscreenTitle}>{title}</Text>
        </View>

        <FlatList
          horizontal
          pagingEnabled
          data={urls}
          initialScrollIndex={initialIndex}
          getItemLayout={(_data, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          keyExtractor={(url, index) => `${url}-${index}`}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <ScrollView
              style={{ width }}
              contentContainerStyle={styles.pageContent}
              maximumZoomScale={4}
              minimumZoomScale={0.5}
              centerContent
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            >
              <GalleryImage uri={item} style={{ width }} resizeMode="contain" fill />
            </ScrollView>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

/** Falls back to a broken-image glyph, as the Dart `errorBuilder` did. */
function GalleryImage({
  uri,
  style,
  resizeMode,
  fill = false,
}: {
  uri: string;
  style: object;
  resizeMode: 'cover' | 'contain';
  fill?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View style={[style, styles.imageFallback, fill && styles.imageFill]}>
        <Text accessible={false} style={styles.imageFallbackGlyph}>
          🖼
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[style, fill && styles.imageFill]}
      resizeMode={resizeMode}
      onError={() => setFailed(true)}
      accessible={false}
    />
  );
}

const styles = StyleSheet.create({
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: r(16),
  },
  dialog: {
    alignSelf: 'stretch',
    backgroundColor: colors.white,
    borderRadius: r(24),
    padding: r(20),
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dialogTitle: {
    ...textTheme.headlineSmall,
    fontSize: spMin(18),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  close: {
    fontSize: spMin(18),
    color: colors.black,
    paddingHorizontal: r(4),
  },
  strip: {
    height: h(250),
    flexGrow: 0,
  },
  thumbWrap: {
    borderRadius: r(16),
    overflow: 'hidden',
    // AppColors.grey @ 10%
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
  },
  thumb: {
    width: w(200),
    height: h(250),
  },
  footer: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
    textAlign: 'center',
  },
  fullscreen: {
    flex: 1,
    backgroundColor: colors.black,
  },
  fullscreenBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: r(16),
    paddingVertical: r(12),
    backgroundColor: colors.black,
  },
  fullscreenClose: {
    fontSize: spMin(20),
    color: colors.white,
    marginRight: r(16),
  },
  fullscreenTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    color: colors.white,
  },
  pageContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFill: {
    height: '100%',
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary100,
  },
  imageFallbackGlyph: {
    fontSize: spMin(28),
  },
});
