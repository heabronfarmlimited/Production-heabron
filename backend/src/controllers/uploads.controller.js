'use strict';

const { uploadFile, getSignedUrl } = require('../services/storage');
const { ok, created, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

const BUCKETS = {
  selfie: { bucket: 'agent-documents', folder: 'selfies', isPublic: false },
  farmer_id: { bucket: 'farmer-documents', folder: 'ids', isPublic: false },
  farmer_photo: { bucket: 'farmer-documents', folder: 'photos', isPublic: false },
  land_doc: { bucket: 'farmer-documents', folder: 'land-docs', isPublic: false },
  farm_photo: { bucket: 'farmer-documents', folder: 'farm-photos', isPublic: false },
  delivery_proof: { bucket: 'delivery-proofs', folder: '', isPublic: false },
  transaction_receipt: { bucket: 'transaction-receipts', folder: '', isPublic: false },
  // Yield-verification evidence (field agent uploads on the production screen).
  // These reuse the existing private farmer-documents / agent-documents buckets
  // — no new storage buckets required.
  harvest_photo: { bucket: 'farmer-documents', folder: 'harvest-photos', isPublic: false },
  warehouse_receipt: { bucket: 'farmer-documents', folder: 'warehouse-receipts', isPublic: false },
  buyer_receipt: { bucket: 'farmer-documents', folder: 'buyer-receipts', isPublic: false },
  agent_signature: { bucket: 'agent-documents', folder: 'signatures', isPublic: false },
  partner_logo: { bucket: 'partner-logos', folder: '', isPublic: true },
  cooperative_logo: { bucket: 'partner-logos', folder: 'cooperatives', isPublic: true },
  avatar: { bucket: 'agent-documents', folder: 'avatars', isPublic: false },
};

async function uploadGeneric(req, res) {
  const kind = req.params.kind;
  const spec = BUCKETS[kind];
  if (!spec) return badRequest(res, `Unknown upload kind: ${kind}`);
  if (!req.file) return badRequest(res, 'No file uploaded (use field name "file")');

  try {
    const result = await uploadFile({
      bucket: spec.bucket,
      folder: spec.folder,
      file: req.file,
      isPublic: spec.isPublic,
    });
    return created(res, { kind, ...result });
  } catch (e) {
    // Surface the real cause so we know if it's a missing bucket vs an
    // RLS policy vs a bad service-role key. The previous generic 500
    // ("Something went wrong") made these impossible to diagnose remotely.
    logger.error({
      err: e.message,
      bucket: spec.bucket,
      kind,
      hint:
        /row-level security|violates/.test(e.message || '')
          ? 'Bucket likely missing or RLS policy is blocking. Run migration 007_storage_buckets.sql.'
          : /bucket not found/i.test(e.message || '')
          ? `Bucket "${spec.bucket}" does not exist. Run migration 007_storage_buckets.sql.`
          : undefined,
    }, 'upload failed');
    return res.status(500).json({
      success: false,
      error: {
        code: 'UPLOAD_FAILED',
        message: e.message || 'Upload failed',
        bucket: spec.bucket,
      },
    });
  }
}

/**
 * Restricted version used by the pre-activation /auth/uploads/:kind route.
 * Only kinds needed during signup (avatar, selfie) are allowed here so that
 * an account in pending/suspended state can't reach the broader upload set.
 */
const PRE_ACTIVATION_KINDS = new Set(['avatar', 'selfie']);
async function uploadPreActivation(req, res) {
  const kind = req.params.kind;
  if (!PRE_ACTIVATION_KINDS.has(kind)) {
    return badRequest(res, `Upload kind not allowed before activation: ${kind}`);
  }
  return uploadGeneric(req, res);
}

/** Every bucket this API actually uses. */
const ALLOWED_BUCKETS = new Set(Object.values(BUCKETS).map((b) => b.bucket));

/**
 * Mint a short-lived signed URL for a stored object.
 *
 * FIXED — AUTHORISATION HOLE. This took `bucket` and `path` straight from the
 * request body and signed whatever it was handed, with no validator on the
 * route at all. Any authenticated field agent could mint a readable URL for
 * ANY object in ANY bucket in the Supabase project: another agent's selfie,
 * any farmer's ID document or land title, any receipt image, and buckets
 * belonging to nothing in this feature.
 *
 * Two constraints now: the bucket must be one this API uses, and the path must
 * match the shape this API generates (`<folder>/<uuid>.<ext>`), which blocks
 * traversal and probing. The expiry is also pinned to one hour — the storage
 * service's own default is TEN YEARS, which is far too long for a link to an
 * identity document that may be forwarded on.
 *
 * RESIDUAL RISK (noted in AUDIT_BACKEND.md, not closable here): an agent who
 * has legitimately seen an object path can still re-sign it later. Fixing that
 * needs per-object ownership, which the storage layer does not record.
 */
const OBJECT_PATH_RE =
  /^(?:[a-z0-9][a-z0-9-]*\/)*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;
const MAX_SIGNED_URL_SECONDS = 60 * 60; // 1 hour

async function signUrl(req, res) {
  const { bucket, path } = req.body;
  if (!bucket || !path) return badRequest(res, 'bucket and path required');

  if (!ALLOWED_BUCKETS.has(bucket)) {
    logger.warn({ bucket, userId: req.user?.userId }, 'sign-url rejected: bucket not in allow-list');
    return badRequest(res, `Unknown bucket: ${bucket}`);
  }
  if (!OBJECT_PATH_RE.test(String(path))) {
    logger.warn({ bucket, path, userId: req.user?.userId }, 'sign-url rejected: malformed object path');
    return badRequest(res, 'Malformed object path');
  }

  const url = await getSignedUrl(bucket, path, MAX_SIGNED_URL_SECONDS);
  return ok(res, { url });
}

module.exports = { uploadGeneric, uploadPreActivation, signUrl, BUCKETS };
