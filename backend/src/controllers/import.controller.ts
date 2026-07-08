import type { Request, Response } from 'express';
import { z } from 'zod';
import { CRM_FIELDS, type CrmRecord } from '../domain/crm.js';
import { parseCsv } from '../services/csv.service.js';
import { extractCrmRecords, type ProgressEvent } from '../services/extraction.service.js';
import { toCsv } from '../services/export.service.js';
import { requireFile } from '../middleware/upload.js';
import { logger } from '../utils/logger.js';

/**
 * HTTP concerns only. Parsing, AI, and validation live in services; this layer
 * turns a request into a service call and a service result into a response.
 */

/** `POST /api/import` — the canonical, synchronous endpoint. */
export async function importCsv(req: Request, res: Response): Promise<void> {
  const file = requireFile(req.file);

  logger.info('Import requested', { filename: file.originalname, bytes: file.size });

  const csv = parseCsv(file.buffer);
  const result = await extractCrmRecords(csv);

  res.status(200).json(result);
}

/**
 * `POST /api/import/stream` — same work, streamed.
 *
 * Server-Sent Events, not WebSockets: the channel is one-way, it's plain HTTP so
 * it survives every proxy and PaaS load balancer untouched, and the browser
 * `EventSource`/fetch-reader story is trivial. The client gets per-batch progress
 * instead of a 40-second spinner.
 */
export async function importCsvStream(req: Request, res: Response): Promise<void> {
  const file = requireFile(req.file);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tell nginx (and Render/Railway's ingress) not to buffer the stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  /**
   * Disconnect must be watched on the *response*, not the request.
   *
   * `req`'s 'close' fires when the request stream ends — and multer has already
   * drained the body by the time this handler runs, so it would fire on our very
   * first `await` and silence every event after `parsed`. `res`'s 'close' fires
   * only when the socket actually goes away (or after we call `end()` ourselves,
   * which is harmless because nothing is sent after that).
   */
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
  });

  const send = (event: ProgressEvent): void => {
    if (clientGone || res.writableEnded) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  // Some proxies hold a response open until the first byte arrives.
  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    if (!clientGone && !res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  try {
    const csv = parseCsv(file.buffer);
    await extractCrmRecords(csv, send);
  } catch (error) {
    const isApiError =
      typeof error === 'object' && error !== null && 'code' in error && 'status' in error;

    send({
      type: 'error',
      code: isApiError ? String((error as { code: unknown }).code) : 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Import failed.',
    });

    logger.error('Streamed import failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

/** `POST /api/export` — hand back the reviewed records as a downloadable CSV. */
const ExportBodySchema = z.object({
  records: z
    .array(z.object(Object.fromEntries(CRM_FIELDS.map((f) => [f, z.string()]))))
    .min(1, 'Provide at least one record to export.'),
  filename: z
    .string()
    .regex(/^[\w.-]{1,80}$/, 'Filename may contain letters, numbers, dots, dashes and underscores.')
    .optional(),
});

export function exportCsv(req: Request, res: Response): void {
  const { records, filename } = ExportBodySchema.parse(req.body);

  const safeName = filename ?? `groweasy_crm_import_${new Date().toISOString().slice(0, 10)}.csv`;
  const body = toCsv(records as CrmRecord[]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Length', Buffer.byteLength(body).toString());
  res.status(200).send(body);
}
