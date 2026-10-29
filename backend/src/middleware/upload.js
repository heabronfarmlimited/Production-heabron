'use strict';

const multer = require('multer');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_DOC_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * FIXED — a rejected file produced a bare `Error`, which the global error
 * handler could not distinguish from a crash, so an agent who picked a HEIC
 * photo got "Something went wrong" (500) instead of being told the format is
 * unsupported. Tagging the error with a code lets `error.js` return a 400
 * carrying the real reason.
 */
const rejectFile = (cb, message) => {
  cb(Object.assign(new Error(message), { code: 'INVALID_FILE_TYPE' }));
};

const imageFilter = (req, file, cb) => {
  if (/^image\/(jpeg|png|webp|jpg)$/i.test(file.mimetype)) return cb(null, true);
  rejectFile(cb, 'Only JPEG, PNG, or WEBP images are allowed');
};

const docFilter = (req, file, cb) => {
  if (/^(image\/(jpeg|png|webp|jpg)|application\/pdf)$/i.test(file.mimetype)) return cb(null, true);
  rejectFile(cb, 'Only images or PDF documents are allowed');
};

const csvFilter = (req, file, cb) => {
  if (/csv|excel|spreadsheet/i.test(file.mimetype) || /\.csv$/i.test(file.originalname)) {
    return cb(null, true);
  }
  rejectFile(cb, 'Only CSV files are allowed');
};

const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFilter,
  limits: { fileSize: MAX_IMAGE_BYTES },
});

const docUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: docFilter,
  limits: { fileSize: MAX_DOC_BYTES },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: csvFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { imageUpload, docUpload, csvUpload };
