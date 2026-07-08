import { Router } from 'express';
import { exportCsv, importCsv, importCsvStream } from '../controllers/import.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { uploadCsv } from '../middleware/upload.js';

export const importRouter: Router = Router();

/**
 * POST /api/import
 *   multipart/form-data, field `file`
 *   → 200 ImportResult
 *
 * The plain request/response contract. Use this from scripts, curl, or any
 * client that doesn't need progress.
 */
importRouter.post('/import', uploadCsv, asyncHandler(importCsv));

/**
 * POST /api/import/stream
 *   multipart/form-data, field `file`
 *   → 200 text/event-stream
 *
 * Same work, but emits `parsed`, `mapping`, `batch`, `retry`, and finally `done`
 * (or `error`). What the frontend actually calls.
 */
importRouter.post('/import/stream', uploadCsv, asyncHandler(importCsvStream));

/**
 * POST /api/export
 *   application/json { records: CrmRecord[], filename?: string }
 *   → 200 text/csv
 */
importRouter.post('/export', asyncHandler(exportCsv));
