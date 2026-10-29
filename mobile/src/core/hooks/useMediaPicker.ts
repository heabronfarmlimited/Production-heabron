/**
 * Image / file picking + upload — replaces the `image_picker`, `file_picker`
 * and `UploadService` usage spread across AddFarmerController,
 * EditFarmerController, RecordYieldsController, RecordRepaymentController,
 * CreateCooperativeController, EditCooperativeController,
 * BulkUploadFarmersController, RegisterController and EditProfileController.
 *
 * The Dart controllers each held `File?` fields plus a parallel `String? ...Url`
 * and uploaded inline during submit. Here a picked asset carries its own
 * upload state, so a form can upload as soon as a file is chosen and submit
 * only URLs.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';

import { uploadFile } from '../../features/auth/api/authApi';
import type { UploadKind } from '../api/endpoints';
import { showApiError, showError } from '../utils/toast';

/** Dart used `imageQuality: 80`. */
const IMAGE_QUALITY = 0.8;

export interface PickedAsset {
  uri: string;
  fileName: string;
  mimeType?: string;
  /** Set once uploaded. */
  url?: string;
  uploading?: boolean;
  /**
   * Size in bytes, when the picker reports it. The document picker does; the
   * image picker does not. Used to show "12.4 KB" beside a selected CSV.
   */
  size?: number;
}

/** An existing remote file (edit forms) alongside newly picked ones. */
export interface ExistingAsset {
  url: string;
}

async function ensureLibraryPermission(): Promise<boolean> {
  const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!granted) {
    showError('Photo library permission is required to attach images.');
  }
  return granted;
}

async function ensureCameraPermission(): Promise<boolean> {
  const { granted } = await ImagePicker.requestCameraPermissionsAsync();
  if (!granted) {
    showError('Camera permission is required to take a photo.');
  }
  return granted;
}

function toAsset(a: ImagePicker.ImagePickerAsset): PickedAsset {
  return {
    uri: a.uri,
    fileName: a.fileName ?? a.uri.split('/').pop() ?? 'image.jpg',
    mimeType: a.mimeType ?? 'image/jpeg',
  };
}

/** Opens the gallery for a single image. */
export async function pickImage(): Promise<PickedAsset | null> {
  if (!(await ensureLibraryPermission())) return null;

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: IMAGE_QUALITY,
    allowsMultipleSelection: false,
  });

  if (res.canceled || !res.assets?.[0]) return null;
  return toAsset(res.assets[0]);
}

/** Opens the gallery for several images — Dart `pickMultiImage()`. */
export async function pickImages(): Promise<PickedAsset[]> {
  if (!(await ensureLibraryPermission())) return [];

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: IMAGE_QUALITY,
    allowsMultipleSelection: true,
  });

  if (res.canceled || !res.assets) return [];
  return res.assets.map(toAsset);
}

/** Opens the camera — Dart `takePhotoInstead()`. */
export async function takePhoto(): Promise<PickedAsset | null> {
  if (!(await ensureCameraPermission())) return null;

  const res = await ImagePicker.launchCameraAsync({
    quality: IMAGE_QUALITY,
    cameraType: ImagePicker.CameraType.front,
  });

  if (res.canceled || !res.assets?.[0]) return null;
  return toAsset(res.assets[0]);
}

/** CSV picker for bulk import — Dart `FileType.custom, allowedExtensions: ['csv']`. */
export async function pickCsv(): Promise<PickedAsset | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/csv'],
    copyToCacheDirectory: true,
  });

  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return {
    uri: a.uri,
    fileName: a.name ?? 'farmers.csv',
    mimeType: a.mimeType ?? 'text/csv',
    size: a.size,
  };
}

/**
 * Holds one image field (farmer photo, ID card, land doc, receipt…) and
 * uploads it as soon as it is picked.
 */
export function useImageField(kind: UploadKind, initialUrl?: string | null) {
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (picked: PickedAsset) => {
      setAsset(picked);
      setUploading(true);
      try {
        const uploaded = await uploadFile({
          uri: picked.uri,
          kind,
          fileName: picked.fileName,
          mimeType: picked.mimeType,
        });
        setUrl(uploaded);
        setAsset({ ...picked, url: uploaded });
        return uploaded;
      } catch (err) {
        showApiError(err);
        // Keep the local preview so the agent can retry without re-picking.
        return null;
      } finally {
        setUploading(false);
      }
    },
    [kind],
  );

  const chooseFromLibrary = useCallback(async () => {
    const picked = await pickImage();
    if (picked) await upload(picked);
  }, [upload]);

  const chooseFromCamera = useCallback(async () => {
    const picked = await takePhoto();
    if (picked) await upload(picked);
  }, [upload]);

  const clear = useCallback(() => {
    setAsset(null);
    setUrl(null);
  }, []);

  return {
    /** Local preview URI, or the remote URL on an edit form. */
    previewUri: asset?.uri ?? url ?? null,
    /** The uploaded URL to submit. */
    url,
    uploading,
    hasValue: Boolean(asset || url),
    chooseFromLibrary,
    chooseFromCamera,
    clear,
    /** Uploads an already-picked asset (shared camera screens). */
    uploadAsset: upload,
  };
}

/** Holds a multi-image field (farm photos, harvest photos). */
export function useImageListField(kind: UploadKind, initialUrls: string[] = []) {
  const [urls, setUrls] = useState<string[]>(initialUrls);
  const [pending, setPending] = useState<PickedAsset[]>([]);
  const [uploading, setUploading] = useState(false);

  const add = useCallback(async () => {
    const picked = await pickImages();
    if (picked.length === 0) return;

    setPending(picked);
    setUploading(true);
    try {
      // Uploaded in parallel, as RecordYieldsController did with `Future.wait`.
      const results = await Promise.allSettled(
        picked.map((p) =>
          uploadFile({
            uri: p.uri,
            kind,
            fileName: p.fileName,
            mimeType: p.mimeType,
          }),
        ),
      );

      const uploaded = results
        .filter(
          (r): r is PromiseFulfilledResult<string> =>
            r.status === 'fulfilled' && Boolean(r.value),
        )
        .map((r) => r.value);

      setUrls((prev) => [...prev, ...uploaded]);

      const failed = results.length - uploaded.length;
      if (failed > 0) {
        showError(
          `${failed} of ${results.length} photo${results.length === 1 ? '' : 's'} failed to upload. Tap to try again.`,
        );
      }
    } finally {
      setPending([]);
      setUploading(false);
    }
  }, [kind]);

  const removeAt = useCallback((index: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    urls,
    /** Local previews still uploading. */
    pending,
    uploading,
    count: urls.length + pending.length,
    add,
    removeAt,
    clear: () => setUrls([]),
  };
}
