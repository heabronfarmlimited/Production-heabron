/**
 * Bulk CSV import + template download — replaces
 * `BulkUploadFarmersController`.
 *
 * Changes from the Dart controller:
 *  - `bulkUploadFarmers(file, '')` passed an empty cooperative id into a
 *    FormData field that was itself commented out. The backend derives the
 *    cooperative from the CSV's `cooperative_name` column, so the parameter is
 *    gone rather than sent empty.
 *  - The template was an inline Dart string with the `Hamsel Industries`
 *    sample rows. `GET /agent/imports/template` serves the authoritative file,
 *    so it is fetched; the bundled copy is only a fallback when offline, and
 *    it is byte-identical to what the endpoint returns.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';

import { qk } from '../../../core/api/queryClient';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import { bulkImportFarmers, fetchImportTemplateCsv } from '../api/farmersApi';
import type { BulkImportResult } from '../model/farmer';
import { FARMER_CSV_TEMPLATE, TEMPLATE_FILE_NAME } from '../services/csvTemplate';

/** `POST /agent/imports` */
export function useBulkImportFarmers() {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    BulkImportResult,
    unknown,
    { uri: string; fileName?: string; mimeType?: string }
  >({
    mutationFn: bulkImportFarmers,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['farmers'] });
      void queryClient.invalidateQueries({ queryKey: ['cooperatives'] });
      void queryClient.invalidateQueries({ queryKey: qk.imports() });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });

      // The Dart toast was unconditional; the real counts are shown instead,
      // and partial failures are surfaced rather than hidden behind "success".
      if (result.errors.length > 0) {
        showSuccess(
          `${result.farmersCreated} farmer${result.farmersCreated === 1 ? '' : 's'} imported, ` +
            `${result.errors.length} row${result.errors.length === 1 ? '' : 's'} skipped`,
        );
      } else {
        showSuccess('Farmers bulk uploaded successfully');
      }
    },
  });

  return {
    upload: mutation.mutate,
    uploadAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    result: mutation.data ?? null,
    error: mutation.error,
  };
}

/**
 * Writes the CSV template to the cache directory and opens the share sheet —
 * `SharePlus.instance.share(... subject: 'Bulk Farmer Upload Template')`.
 */
export function useDownloadTemplate() {
  const [isPending, setIsPending] = useState(false);

  const download = async (): Promise<void> => {
    setIsPending(true);
    try {
      let csv = '';
      try {
        csv = await fetchImportTemplateCsv();
      } catch {
        // Offline or the route is unavailable — fall back to the bundled copy.
        csv = '';
      }
      if (!csv.trim()) csv = FARMER_CSV_TEMPLATE;

      const uri = `${FileSystem.cacheDirectory ?? ''}${TEMPLATE_FILE_NAME}`;
      await FileSystem.writeAsStringAsync(uri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Bulk Farmer Upload Template',
          UTI: 'public.comma-separated-values-text',
        });
      }

      showSuccess('Template downloaded successfully');
    } catch (err) {
      showApiError(err, 'Could not download template');
    } finally {
      setIsPending(false);
    }
  };

  return { download, isPending };
}
