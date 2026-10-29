/**
 * Upload buckets used by this module, named for readability at the call sites.
 *
 * All of these are in the `UploadKind` union in `core/api/endpoints.ts`, which
 * mirrors the backend's `BUCKETS` map in `uploads.controller.js`. The four
 * yield-verification kinds were missing from the union initially — and from the
 * Flutter `UploadService` doc comment — even though `RecordYieldsController`
 * uploaded to them. No casts are needed now.
 */
import type { UploadKind } from '../../../core/api/endpoints';

export const uploadKinds = {
  // Farmer records
  farmerPhoto: 'farmer_photo',
  farmerId: 'farmer_id',
  landDoc: 'land_doc',
  farmPhoto: 'farm_photo',

  // Transactions
  transactionReceipt: 'transaction_receipt',

  // Yield verification
  harvestPhoto: 'harvest_photo',
  warehouseReceipt: 'warehouse_receipt',
  buyerReceipt: 'buyer_receipt',
  agentSignature: 'agent_signature',
} as const satisfies Record<string, UploadKind>;
