/*
 * Upload handling. Files are read into memory (size-limited) and handed to
 * modules/storage.js, which puts them on local disk or in an S3-compatible
 * bucket depending on STORAGE_DRIVER. Nothing here touches the disk itself.
 */
import multer from 'multer';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED.has(file.mimetype)) return cb(new Error('Upload a JPEG, PNG or WebP image'));
  cb(null, true);
};

/* A product photo: one file, up to 5 MB (a phone photo, not a print-res original). */
export const uploadProductImage = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
}).single('image');

/* Menu photos are read once by the AI service and never kept. A phone photo is
   resized by the app before upload, so 8 MB per photo is generous. */
export const uploadMenuPhotos = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024, files: 5 }
}).array('images', 5);

/* A business logo for receipts: one small image. */
export const uploadLogo = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }
}).single('logo');
