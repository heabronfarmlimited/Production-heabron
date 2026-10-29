/**
 * The four image fields a farmer form owns, in one hook.
 *
 * `AddFarmerController` and `EditFarmerController` each kept eight fields for
 * this (`File?` plus a parallel `String? …Url` per slot) and a
 * `Map<File, String?>` for the farm photos, then uploaded everything inline
 * during submit. `useImageField` / `useImageListField` upload as soon as a file
 * is picked, so submit only sends URLs — and a failed upload no longer loses
 * the whole form.
 */
import { useImageField, useImageListField } from '../../../core/hooks/useMediaPicker';
import { uploadKinds } from '../model/uploadKinds';

export interface FarmerFormUploadsInitial {
  farmerPhotoUrl?: string | null;
  idImageUrl?: string | null;
  landDocumentUrl?: string | null;
  farmPhotoUrls?: string[];
}

export function useFarmerFormUploads(initial: FarmerFormUploadsInitial = {}) {
  const farmerPhoto = useImageField(uploadKinds.farmerPhoto, initial.farmerPhotoUrl);
  const idCard = useImageField(uploadKinds.farmerId, initial.idImageUrl);
  const landDocument = useImageField(uploadKinds.landDoc, initial.landDocumentUrl);
  const farmPhotos = useImageListField(uploadKinds.farmPhoto, initial.farmPhotoUrls ?? []);

  return {
    farmerPhoto,
    idCard,
    landDocument,
    farmPhotos,
    /** True while any slot is still uploading — submit is blocked. */
    uploading:
      farmerPhoto.uploading ||
      idCard.uploading ||
      landDocument.uploading ||
      farmPhotos.uploading,
  };
}

/** The receipt / signature fields the Record Yields form owns. */
export function useYieldFormUploads(initial: {
  harvestPhotoUrls?: string[];
  warehouseReceiptUrl?: string | null;
  buyerReceiptUrl?: string | null;
  agentSignatureUrl?: string | null;
} = {}) {
  const harvestPhotos = useImageListField(
    uploadKinds.harvestPhoto,
    initial.harvestPhotoUrls ?? [],
  );
  const warehouseReceipt = useImageField(
    uploadKinds.warehouseReceipt,
    initial.warehouseReceiptUrl,
  );
  const buyerReceipt = useImageField(uploadKinds.buyerReceipt, initial.buyerReceiptUrl);
  const agentSignature = useImageField(
    uploadKinds.agentSignature,
    initial.agentSignatureUrl,
  );

  return {
    harvestPhotos,
    warehouseReceipt,
    buyerReceipt,
    agentSignature,
    uploading:
      harvestPhotos.uploading ||
      warehouseReceipt.uploading ||
      buyerReceipt.uploading ||
      agentSignature.uploading,
  };
}
