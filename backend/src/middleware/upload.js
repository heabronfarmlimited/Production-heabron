'use strict';

const multer = require('multer');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_DOC_BYTES = 15 * 1024 * 1024; // 15 MB

const imageFilter = (req, file, cb) => {
  if (/^image\/(jpeg|png|webp|jpg)$/i.test(file.mimetype)) return cb(null, true);
  cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
};

const docFilter = (req, file, cb) => {
  if (/^(image\/(jpeg|png|webp|jpg)|application\/pdf)$/i.test(file.mimetype)) return cb(null, true);
  cb(new Error('Only images or PDF documents are allowed'));
};

const csvFilter = (req, file, cb) => {
  if (/csv|excel|spreadsheet/i.test(file.mimetype) || /\.csv$/i.test(file.originalname)) {
    return cb(null, true);
  }
  cb(new Error('Only CSV files are allowed'));
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
