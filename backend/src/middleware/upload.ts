import multer from 'multer';
import { extname } from 'node:path';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';

/**
 * CSV upload handling.
 *
 * Memory storage, not disk: the file is size-capped, read exactly once, and
 * never needs to outlive the request. Writing it to `/tmp` would only buy us a
 * cleanup problem and a read-only-filesystem failure on most PaaS hosts.
 */

/** Browsers are inconsistent about CSV MIME types; every one of these means "csv". */
const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'text/x-csv',
  'application/x-csv',
  'text/comma-separated-values',
  'application/octet-stream', // what curl sends, and some drag-and-drop paths
]);

export const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 8,
  },
  fileFilter(_req, file, callback) {
    const hasCsvExtension = extname(file.originalname).toLowerCase() === '.csv';
    const hasCsvMime = CSV_MIME_TYPES.has(file.mimetype.toLowerCase());

    // The extension is the authority. A `.xlsx` sent as `text/csv` is still not a CSV,
    // and a `.csv` sent as `application/octet-stream` still is.
    if (!hasCsvExtension) {
      callback(
        new ApiError(
          415,
          'UNSUPPORTED_FILE_TYPE',
          `Only .csv files are supported — received "${file.originalname}".`,
        ),
      );
      return;
    }

    if (!hasCsvMime) {
      callback(
        new ApiError(
          415,
          'UNSUPPORTED_FILE_TYPE',
          `"${file.originalname}" does not look like a CSV (reported type: ${file.mimetype}).`,
        ),
      );
      return;
    }

    callback(null, true);
  },
}).single('file');

/** Narrows `req.file` for handlers, and turns "no file" into a real API error. */
export function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) {
    throw new ApiError(400, 'NO_FILE', 'No CSV file was uploaded. Attach it as the "file" field.');
  }
  if (file.size === 0) {
    throw new ApiError(400, 'EMPTY_FILE', 'The uploaded file is empty.');
  }
  return file;
}
