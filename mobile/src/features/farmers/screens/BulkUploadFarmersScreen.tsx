/**
 * Bulk Import Farmers — ported from
 * modules/farmers/presentation/view/bulk_upload_farmers_view.dart
 *
 * Layout from Dart: heading 'Bulk Import Farmers', subtitle 'Quickly onboard
 * multiple farmers by uploading a CSV file.', the template card ('Need the
 * document format?' / 'Download the official CSV template with all required
 * columns.' / 'Download CSV Template'), 'Upload Farmers CSV' with the picker
 * ('Tap to select CSV file' / 'Supports .csv files only', or the chosen file
 * with its size in KB and a close button), then 'Upload Farmers'.
 *
 * Fixes:
 *  - The route argument read (`as Cooperative`) was commented out and the
 *    upload called `bulkUploadFarmers(file, '')` into a FormData field that was
 *    itself commented out. `imports.bulkImport` derives each cooperative from
 *    the CSV's `cooperative_name` column, so no cooperative is needed at all —
 *    the screen takes no arguments.
 *  - 'Farmers bulk uploaded successfully' fired even when every row failed.
 *    The real counts are reported, and skipped rows are listed.
 *  - The template was an inline Dart string; `GET /agent/imports/template` is
 *    fetched, with the bundled copy as an offline fallback.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { pickCsv, type PickedAsset } from '../../../core/hooks/useMediaPicker';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { showApiError, showError } from '../../../core/utils/toast';
import { useBulkImportFarmers, useDownloadTemplate } from '../hooks/useBulkImport';
import type { BulkImportResult } from '../model/farmer';
import { TEMPLATE_COLUMNS } from '../services/csvTemplate';

export function BulkUploadFarmersScreen() {
  const [file, setFile] = useState<PickedAsset | null>(null);
  const [fileSizeKb, setFileSizeKb] = useState<number | null>(null);

  const { download, isPending: isDownloading } = useDownloadTemplate();
  const { uploadAsync, isPending: isUploading, result } = useBulkImportFarmers();

  const pickFile = async () => {
    try {
      const picked = await pickCsv();
      if (!picked) return;
      setFile(picked);
      // `PickedAsset` carries no size, so it is read off the cached copy —
      // Dart used `file.lengthSync()` for the same '<n> KB' line.
      setFileSizeKb(await readSizeKb(picked.uri));
    } catch (err) {
      // Dart: 'Could not pick file: $e'
      showApiError(err, 'Could not pick file');
    }
  };

  const upload = async () => {
    if (!file) {
      showError('Please select a CSV file first');
      return;
    }

    try {
      await uploadAsync({
        uri: file.uri,
        fileName: file.fileName,
        mimeType: file.mimeType,
      });
      setFile(null);
      setFileSizeKb(null);
    } catch (err) {
      showApiError(err, 'Upload failed');
    }
  };

  return (
    <AppSkeleton appBarTitle="Bulk Import Farmers" isBusy={isUploading} scrollable>
      <View style={{ height: h(23) }} />

      <Text accessibilityRole="header" style={styles.title}>
        Bulk Import Farmers
      </Text>

      <View style={{ height: h(8) }} />

      <Text style={styles.subtitle}>
        Quickly onboard multiple farmers by uploading a CSV file.
      </Text>

      <View style={{ height: h(30) }} />

      {/* ------------------------------------------------ template card */}
      <View style={styles.templateCard}>
        <View style={styles.templateHeader}>
          <View style={styles.templateIcon}>
            <Text accessible={false} style={styles.templateGlyph}>
              📄
            </Text>
          </View>

          <View style={styles.templateText}>
            <Text style={styles.templateTitle}>Need the document format?</Text>
            <View style={{ height: h(4) }} />
            <Text style={styles.templateBody}>
              Download the official CSV template with all required columns.
            </Text>
          </View>
        </View>

        <View style={{ height: h(20) }} />

        <AppButton
          text="Download CSV Template"
          isOutlined
          outlineColor={colors.primary}
          textColor={colors.primary}
          borderRadius={12}
          loading={isDownloading}
          onPress={() => void download()}
          testID="bulk-download-template"
        />

        <View style={{ height: h(12) }} />

        {/* The column list is useful and was nowhere in the Flutter UI. */}
        <Text style={styles.columns}>{`Columns: ${TEMPLATE_COLUMNS.join(', ')}`}</Text>
      </View>

      <View style={{ height: h(32) }} />

      <Text style={styles.sectionTitle}>Upload Farmers CSV</Text>

      <View style={{ height: h(16) }} />

      {/* --------------------------------------------------- file picker */}
      {file == null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tap to select CSV file"
          onPress={() => void pickFile()}
          style={styles.dropzone}
          testID="bulk-pick-file"
        >
          <Text accessible={false} style={styles.dropzoneGlyph}>
            ☁
          </Text>
          <View style={{ height: h(16) }} />
          <Text style={styles.dropzoneTitle}>Tap to select CSV file</Text>
          <View style={{ height: h(8) }} />
          <Text style={styles.dropzoneHint}>Supports .csv files only</Text>
        </Pressable>
      ) : (
        <View style={styles.fileCard}>
          <View style={styles.fileIcon}>
            <Text accessible={false} style={styles.fileGlyph}>
              📎
            </Text>
          </View>

          <View style={styles.fileText}>
            <Text style={styles.fileName} numberOfLines={1}>
              {file.fileName}
            </Text>
            <View style={{ height: h(4) }} />
            <Text style={styles.fileSize}>
              {fileSizeKb != null ? `${fileSizeKb.toFixed(1)} KB` : 'Ready to upload'}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove selected file"
            hitSlop={8}
            onPress={() => {
              setFile(null);
              setFileSizeKb(null);
            }}
            testID="bulk-clear-file"
          >
            <Text style={styles.removeGlyph}>✕</Text>
          </Pressable>
        </View>
      )}

      {result ? <ImportSummary result={result} /> : null}

      <View style={{ height: h(60) }} />

      <AppButton
        text="Upload Farmers"
        height={54}
        loading={isUploading}
        onPress={() => void upload()}
        testID="bulk-upload"
      />

      <View style={{ height: h(32) }} />
    </AppSkeleton>
  );
}

/** Best-effort file size for the '<n> KB' line; null when unavailable. */
async function readSizeKb(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size / 1024 : null;
  } catch {
    return null;
  }
}

/**
 * The per-row errors `imports.bulkImport` returns.
 *
 * The Dart screen discarded them entirely and toasted an unconditional
 * success, so an agent whose CSV was half-rejected had no way to know which
 * rows to fix.
 */
function ImportSummary({ result }: { result: BulkImportResult }) {
  return (
    <View style={styles.summary}>
      <Text style={styles.summaryTitle}>Last import</Text>
      <View style={{ height: h(8) }} />
      <Text style={styles.summaryLine}>
        {`${result.farmersCreated} farmer${result.farmersCreated === 1 ? '' : 's'} created`}
        {result.cooperativesCreated > 0
          ? `, ${result.cooperativesCreated} cooperative${
              result.cooperativesCreated === 1 ? '' : 's'
            } created`
          : ''}
        {result.rowsProcessed > 0 ? ` from ${result.rowsProcessed} rows` : ''}
      </Text>

      {result.errors.length > 0 ? (
        <>
          <View style={{ height: h(12) }} />
          <Text style={styles.summaryErrorTitle}>
            {`${result.errors.length} row${result.errors.length === 1 ? '' : 's'} skipped`}
          </Text>
          <ScrollView style={styles.errorList} nestedScrollEnabled>
            {result.errors.map((error, index) => (
              <Text key={`${error.line}-${index}`} style={styles.summaryError}>
                {error.line != null ? `Line ${error.line}: ` : ''}
                {error.message}
              </Text>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    ...textTheme.headlineMedium,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  subtitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
  },
  templateCard: {
    padding: r(20),
    borderRadius: r(16),
    // Dart: AppColors.primaryLight @ 30%, border AppColors.primary @ 20%
    backgroundColor: 'rgba(254, 239, 184, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(46, 139, 87, 0.2)',
  },
  templateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  templateIcon: {
    padding: r(10),
    borderRadius: r(100),
    // AppColors.primary @ 10%
    backgroundColor: 'rgba(46, 139, 87, 0.1)',
  },
  templateGlyph: {
    fontSize: spMin(18),
  },
  templateText: {
    flex: 1,
    marginLeft: r(16),
  },
  templateTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  templateBody: {
    ...textTheme.bodySmall,
    fontSize: spMin(13),
    color: colors.grey,
  },
  columns: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.secondary400,
  },
  sectionTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  dropzone: {
    paddingVertical: r(40),
    alignItems: 'center',
    borderRadius: r(16),
    backgroundColor: colors.secondary100,
    borderWidth: 1,
    borderColor: colors.secondary400,
  },
  dropzoneGlyph: {
    fontSize: spMin(40),
    color: colors.primary,
  },
  dropzoneTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
  },
  dropzoneHint: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: r(20),
    borderRadius: r(16),
    backgroundColor: colors.secondary100,
    borderWidth: 1,
    borderColor: colors.secondary400,
  },
  fileIcon: {
    padding: r(12),
    borderRadius: r(12),
    backgroundColor: 'rgba(46, 139, 87, 0.1)',
  },
  fileGlyph: {
    fontSize: spMin(22),
  },
  fileText: {
    flex: 1,
    marginLeft: r(16),
  },
  fileName: {
    ...textTheme.bodyMedium,
    fontSize: spMin(15),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  fileSize: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  removeGlyph: {
    fontSize: spMin(16),
    color: colors.failure,
    paddingHorizontal: r(4),
  },
  summary: {
    marginTop: r(20),
    padding: r(16),
    borderRadius: r(12),
    backgroundColor: colors.secondary100,
  },
  summaryTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  summaryLine: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    color: colors.greyDeep,
  },
  summaryErrorTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.failure,
  },
  errorList: {
    maxHeight: h(140),
    marginTop: r(4),
  },
  summaryError: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.greyDeep,
    marginTop: r(2),
  },
});
