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
async function uploadFile({ bucket, folder = '', file, isPublic = false, signedExpirySeconds = 60 * 60 * 24 * 365 * 10 }) {
  if (!file || !file.buffer) throw new Error('No file buffer provided');

  const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || ['.bin'])[0].toLowerCase();
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
    return { path, url: data.publicUrl, bucket };
  }

  const { data, error: signErr } = await sb.storage
    .from(bucket)
    .createSignedUrl(path, signedExpirySeconds);
  if (signErr) throw new Error(`Sign URL failed: ${signErr.message}`);

  return { path, url: data.signedUrl, bucket };
}

async function getSignedUrl(bucket, path, expirySeconds = 60 * 60) {
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expirySeconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

async function deleteFile(bucket, path) {
  const sb = supabaseAdmin();
  const { error } = await sb.storage.from(bucket).remove([path]);
  if (error) {
    logger.warn({ err: error, bucket, path }, 'delete failed');
  }
}

module.exports = { uploadFile, getSignedUrl, deleteFile };
