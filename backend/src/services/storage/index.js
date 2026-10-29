'use strict';

const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../../config/supabase');
const logger = require('../../utils/logger');

/**
 * Upload a buffer to a Supabase storage bucket and return its public URL
 * (or a signed URL for private buckets).
 *
 *   uploadFile({ bucket, folder, file, isPublic })
 *
 * `file` must have { buffer, mimetype, originalname } (multer memory storage).
 */
/**
 * Default lifetime for a signed URL stored on a record.
 *
 * FIXED — the default was `60 * 60 * 24 * 365 * 10`, i.e. TEN YEARS. Every
 * private upload (farmer ID documents, land titles, selfies, receipt images)
 * had its ten-year URL written into a database column, so anyone who ever saw
 * one of those rows — or any later export, PDF or screenshot of it — held a
 * working, effectively permanent link to the document, outside any
 * authorisation check this API performs. One year is still long enough for the
 * URL to live on a record for a full lending cycle; `getSignedUrl` exists for
 * minting short-lived links on demand.
 */
const DEFAULT_SIGNED_URL_SECONDS = 60 * 60 * 24 * 365; // 1 year

async function uploadFile({ bucket, folder = '', file, isPublic = false, signedExpirySeconds = DEFAULT_SIGNED_URL_SECONDS }) {
  if (!file || !file.buffer) throw new Error('No file buffer provided');

  const ext = (String(file.originalname || '').match(/\.[a-z0-9]+$/i) || ['.bin'])[0].toLowerCase();
  const path = `${folder ? folder.replace(/^\/|\/$/g, '') + '/' : ''}${uuidv4()}${ext}`;

  const sb = supabaseAdmin();
  const { error } = await sb.storage.from(bucket).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) {
    logger.error({ err: error, bucket, path }, 'upload failed');
    throw new Error(`Upload failed: ${error.message}`);
  }

  if (isPublic) {
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    // FIXED — `data` was dereferenced without checking. `getPublicUrl` returns
    // `{ data: null }` for a bucket that is not public, which threw a bare
    // TypeError that the upload handler reported as a storage failure with a
    // misleading message.
    if (!data?.publicUrl) {
      throw new Error(`Could not resolve a public URL for bucket "${bucket}" — is the bucket public?`);
    }
    return { path, url: data.publicUrl, bucket };
  }

  const { data, error: signErr } = await sb.storage
    .from(bucket)
    .createSignedUrl(path, signedExpirySeconds);
  if (signErr) throw new Error(`Sign URL failed: ${signErr.message}`);
  if (!data?.signedUrl) throw new Error('Sign URL failed: no URL returned');

  return { path, url: data.signedUrl, bucket };
}

async function getSignedUrl(bucket, path, expirySeconds = 60 * 60) {
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expirySeconds);
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error('No signed URL returned');
  return data.signedUrl;
}

// FIXED — `deleteFile` was exported but called from nowhere. Removed: nothing
// in this codebase ever deletes a stored object, so keeping a
// swallow-the-error delete helper around only invited someone to use it
// believing failures would be reported.

module.exports = { uploadFile, getSignedUrl, DEFAULT_SIGNED_URL_SECONDS };
