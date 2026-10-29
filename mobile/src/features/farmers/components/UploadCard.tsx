/**
 * `_UploadCard` / `_MultiUploadCard` / `_buildUploadRow` — one implementation
 * of each instead of the copies that lived privately in add_farmer_view.dart,
 * edit_farmer_view.dart and record_yields_view.dart.
 *
 * Copy is preserved verbatim:
 *   single  — 'File attached' / 'Tap to upload'
 *   multi   — '<n> photos added' / 'Tap to add photos'
 *   yield   — '<n> files selected' / 'File selected'
 *
 * The edit variants took an `existingUrl` and rendered `Image.network` with an
 * `errorBuilder` falling back to a broken-image icon; `previewUri` covers both
 * a freshly picked local file and a stored remote URL.
 */
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

/** Dart `AppColors.grey.withValues(alpha: 0.3)` on the idle card border. */
const IDLE_BORDER = 'rgba(107, 114, 128, 0.3)';
/** Dart `const Color(0xFFD6DDEB)` on the Record Yields upload rows. */
const YIELD_BORDER = '#D6DDEB';

export interface UploadCardProps {
  title: string;
  subtitle?: string;
  /** Local file URI or stored remote URL. */
  previewUri?: string | null;
  hasValue: boolean;
  uploading?: boolean;
  onPress: () => void;
  onClear?: () => void;
  error?: string;
  testID?: string;
}

export function UploadCard({
  title,
  subtitle,
  previewUri,
  hasValue,
  uploading = false,
  onPress,
  onClear,
  error,
  testID,
}: UploadCardProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      {subtitle ? (
        <>
          <View style={{ height: h(4) }} />
          <Text style={styles.subtitle}>{subtitle}</Text>
        </>
      ) : null}

      <View style={{ height: h(8) }} />

      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={hasValue ? 'File attached' : 'Tap to upload'}
        onPress={onPress}
        style={[styles.card, hasValue ? styles.cardFilled : styles.cardIdle]}
      >
        <Text accessible={false} style={styles.glyph}>
          {hasValue ? '✓' : '☁'}
        </Text>

        <Text
          style={[styles.cardLabel, hasValue ? styles.filledText : styles.idleText]}
          numberOfLines={1}
        >
          {hasValue ? 'File attached' : 'Tap to upload'}
        </Text>

        {uploading ? (
          <AppLoading color={colors.primary} />
        ) : previewUri ? (
          <Thumbnail uri={previewUri} size={40} />
        ) : null}

        {hasValue && onClear && !uploading ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${title}`}
            hitSlop={8}
            onPress={onClear}
            style={styles.clear}
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        ) : null}
      </Pressable>

      {error ? (
        <Text style={styles.error} numberOfLines={2}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export interface MultiUploadCardProps {
  title: string;
  /** Uploaded remote URLs. */
  urls: string[];
  /** Local previews still uploading. */
  pendingUris?: string[];
  uploading?: boolean;
  onPress: () => void;
  onRemove?: (index: number) => void;
  testID?: string;
}

export function MultiUploadCard({
  title,
  urls,
  pendingUris = [],
  uploading = false,
  onPress,
  onRemove,
  testID,
}: MultiUploadCardProps) {
  const previews = [...urls, ...pendingUris];
  const count = previews.length;
  const hasValue = count > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <View style={{ height: h(8) }} />

      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={[styles.card, styles.cardColumn, hasValue ? styles.cardFilled : styles.cardIdle]}
      >
        <View style={styles.cardRow}>
          <Text accessible={false} style={styles.glyph}>
            {hasValue ? '✓' : '➕'}
          </Text>
          <Text style={[styles.cardLabel, hasValue ? styles.filledText : styles.idleText]}>
            {hasValue ? `${count} photos added` : 'Tap to add photos'}
          </Text>
          {uploading ? <AppLoading color={colors.primary} /> : null}
        </View>

        {hasValue ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
          >
            {previews.map((uri, index) => (
              <View key={`${uri}-${index}`} style={styles.stripItem}>
                <Thumbnail uri={uri} size={60} />
                {onRemove && index < urls.length ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove photo ${index + 1}`}
                    hitSlop={6}
                    onPress={() => onRemove(index)}
                    style={styles.stripRemove}
                  >
                    <Text style={styles.stripRemoveText}>✕</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}
      </Pressable>
    </View>
  );
}

export interface UploadRowProps {
  title: string;
  hasFile: boolean;
  /** When set, renders '<n> files selected' instead of 'File selected'. */
  fileCount?: number;
  uploading?: boolean;
  onPress: () => void;
  testID?: string;
}

/** `_buildUploadRow` from record_yields_view.dart. */
export function UploadRow({
  title,
  hasFile,
  fileCount,
  uploading = false,
  onPress,
  testID,
}: UploadRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={styles.uploadRow}
    >
      <Text
        accessible={false}
        style={[styles.glyph, hasFile ? styles.successText : styles.idleText]}
      >
        {hasFile ? '✓' : '⬆'}
      </Text>

      <View style={styles.uploadRowText}>
        <Text style={styles.uploadRowTitle}>{title}</Text>
        {hasFile ? (
          <Text style={styles.uploadRowSubtitle}>
            {fileCount != null ? `${fileCount} files selected` : 'File selected'}
          </Text>
        ) : null}
      </View>

      {uploading ? (
        <AppLoading color={colors.primary} />
      ) : (
        <Text accessible={false} style={styles.chevron}>
          ›
        </Text>
      )}
    </Pressable>
  );
}

/** Falls back to a broken-image glyph, as the Dart `errorBuilder` did. */
function Thumbnail({ uri, size }: { uri: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: r(size), height: r(size), borderRadius: r(4) };

  if (failed) {
    return (
      <View style={[styles.thumbFallback, box]}>
        <Text accessible={false} style={styles.thumbFallbackText}>
          🖼
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={box}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessible={false}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: r(16),
    backgroundColor: colors.white,
    borderRadius: r(12),
    borderWidth: 1,
  },
  cardColumn: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIdle: {
    borderColor: IDLE_BORDER,
  },
  cardFilled: {
    borderColor: colors.primary,
  },
  glyph: {
    fontSize: spMin(18),
    marginRight: r(12),
  },
  cardLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    flex: 1,
  },
  idleText: {
    color: colors.grey,
  },
  filledText: {
    color: colors.primary,
  },
  successText: {
    color: colors.success,
  },
  clear: {
    marginLeft: r(10),
    padding: r(2),
  },
  clearText: {
    color: colors.failure,
    fontSize: spMin(14),
  },
  strip: {
    marginTop: r(12),
    flexGrow: 0,
  },
  stripContent: {
    gap: r(8),
  },
  stripItem: {
    position: 'relative',
  },
  stripRemove: {
    position: 'absolute',
    top: -r(4),
    right: -r(4),
    width: r(18),
    height: r(18),
    borderRadius: r(18),
    backgroundColor: colors.failure,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripRemoveText: {
    color: colors.white,
    fontSize: spMin(10),
    lineHeight: spMin(12),
  },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: r(16),
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: YIELD_BORDER,
    borderRadius: r(8),
  },
  uploadRowText: {
    flex: 1,
  },
  uploadRowTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  uploadRowSubtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.success,
  },
  chevron: {
    fontSize: spMin(22),
    color: colors.grey,
  },
  thumbFallback: {
    backgroundColor: colors.secondary100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFallbackText: {
    fontSize: spMin(16),
  },
  error: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.failure,
    marginTop: r(4),
  },
});
