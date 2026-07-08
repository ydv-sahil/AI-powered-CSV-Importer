import { z } from 'zod';
import { env } from '../config/env.js';
import {
  CRM_FIELDS,
  RawLlmRecordSchema,
  isCrmField,
  type CrmRecord,
  type FieldMapping,
  type FieldMappingEntry,
  type ImportResult,
  type SkippedRecord,
} from '../domain/crm.js';
import { normalizeRecord } from '../domain/normalize.js';
import { getLlmProvider } from './llm/index.js';
import {
  EXTRACTION_SYSTEM_PROMPT,
  MAPPING_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildMappingPrompt,
} from './llm/prompts.js';
import { chunk, sampleRows, type CsvRow, type ParsedCsv } from './csv.service.js';
import { FatalError, mapWithConcurrency, withRetry } from '../utils/async.js';
import { parseLlmJson } from '../utils/json.js';
import { logger } from '../utils/logger.js';

/**
 * The extraction pipeline.
 *
 *   parse → infer mapping (1 LLM call) → extract in parallel batches (N calls) →
 *   align by row index → normalize → partition into imported / skipped
 *
 * Two properties matter most here:
 *
 *   **Nothing silently disappears.** Every input row ends up in exactly one of
 *   `records` or `skipped`. A batch whose LLM calls all fail doesn't vanish — its
 *   rows are reported as skipped with the reason attached.
 *
 *   **Rows are matched by index, not by position.** Models drop rows, merge rows,
 *   and reorder them. Echoing `__row` back and joining on it means a model that
 *   returns 24 records for a 25-row batch loses one row, rather than shifting
 *   every subsequent record onto the wrong lead.
 */

// ---------------------------------------------------------------------------
// Progress events, consumed by the SSE endpoint.
// ---------------------------------------------------------------------------

export type ProgressEvent =
  | { type: 'parsed'; totalRows: number; headers: string[] }
  | { type: 'mapping'; mapping: FieldMapping }
  | { type: 'batch'; completed: number; total: number; imported: number; skipped: number }
  | { type: 'retry'; batch: number; attempt: number; maxAttempts: number }
  | { type: 'done'; result: ImportResult }
  | { type: 'error'; code: string; message: string };

export type ProgressCallback = (event: ProgressEvent) => void;

const noop: ProgressCallback = () => {};

// ---------------------------------------------------------------------------
// LLM response schemas.
// ---------------------------------------------------------------------------

const MappingResponseSchema = z.object({
  entries: z.array(
    z.object({
      sourceColumn: z.string(),
      crmField: z.string().nullish(),
      confidence: z.enum(['high', 'medium', 'low']).catch('low'),
      reason: z.string().nullish(),
    }),
  ),
});

const ExtractionResponseSchema = z.object({
  records: z.array(RawLlmRecordSchema.extend({ __row: z.coerce.number().int().nonnegative() })),
});

// ---------------------------------------------------------------------------
// Phase 1 — field mapping.
// ---------------------------------------------------------------------------

/**
 * Ask the model what each column means. One call for the whole file.
 *
 * A failure here is survivable: extraction can proceed with an empty mapping and
 * infer field-by-field from the values. Worse output, but still output — so this
 * never fails the request.
 */
export async function inferFieldMapping(csv: ParsedCsv): Promise<FieldMapping> {
  const provider = getLlmProvider();
  const samples = sampleRows(csv.rows);

  const empty: FieldMapping = { entries: [], unmappedColumns: [...csv.headers] };

  try {
    const response = await withRetry(
      () =>
        provider.complete({
          systemPrompt: MAPPING_SYSTEM_PROMPT,
          userPrompt: buildMappingPrompt(csv.headers, samples),
          temperature: 0,
        }),
      { attempts: env.MAX_RETRIES, label: 'field-mapping' },
    );

    const parsed = MappingResponseSchema.parse(parseLlmJson(response.text));
    return reconcileMapping(parsed.entries, csv.headers);
  } catch (error) {
    if (error instanceof FatalError) throw error; // bad API key — don't paper over it

    logger.warn('Field mapping failed; extracting without a mapping hint', {
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}

/**
 * Trust, but verify. The model is told to map at most one column per CRM field
 * and to echo headers verbatim; neither is guaranteed.
 *
 * - Entries naming a column that doesn't exist are dropped.
 * - Entries naming a field that isn't a CRM field are dropped.
 * - When two columns claim the same CRM field, the higher-confidence one wins and
 *   the loser becomes unmapped — its data survives in `crm_note`.
 * - Any header the model never mentioned is unmapped.
 */
function reconcileMapping(
  rawEntries: z.infer<typeof MappingResponseSchema>['entries'],
  headers: string[],
): FieldMapping {
  const headerSet = new Set(headers);
  const rank = { high: 3, medium: 2, low: 1 } as const;

  const claimed = new Map<string, FieldMappingEntry>();
  const entries: FieldMappingEntry[] = [];

  for (const raw of rawEntries) {
    if (!headerSet.has(raw.sourceColumn)) continue;

    const field = raw.crmField ?? '';
    const entry: FieldMappingEntry = {
      sourceColumn: raw.sourceColumn,
      crmField: isCrmField(field) ? field : null,
      confidence: raw.confidence,
      reason: raw.reason ?? '',
    };

    if (entry.crmField === null) {
      entries.push(entry);
      continue;
    }

    const incumbent = claimed.get(entry.crmField);
    if (!incumbent) {
      claimed.set(entry.crmField, entry);
      entries.push(entry);
      continue;
    }

    // Contested field: demote the weaker claim to unmapped.
    if (rank[entry.confidence] > rank[incumbent.confidence]) {
      incumbent.reason = `superseded by "${entry.sourceColumn}"; folded into crm_note`;
      incumbent.crmField = null;
      claimed.set(entry.crmField, entry);
      entries.push(entry);
    } else {
      entries.push({
        ...entry,
        crmField: null,
        reason: `"${incumbent.sourceColumn}" already maps to ${entry.crmField}; folded into crm_note`,
      });
    }
  }

  const mentioned = new Set(entries.map((e) => e.sourceColumn));
  for (const header of headers) {
    if (!mentioned.has(header)) {
      entries.push({
        sourceColumn: header,
        crmField: null,
        confidence: 'low',
        reason: 'not classified by the model',
      });
    }
  }

  return {
    entries,
    unmappedColumns: entries.filter((e) => e.crmField === null).map((e) => e.sourceColumn),
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — batched extraction.
// ---------------------------------------------------------------------------

interface IndexedRow {
  /** 0-based index into `csv.rows`. Echoed through the model as `__row`. */
  index: number;
  row: CsvRow;
}

interface BatchOutcome {
  /** Keyed by the row's 0-based index. */
  byIndex: Map<number, CrmRecord>;
  skipped: SkippedRecord[];
  failed: boolean;
}

async function extractBatch(
  batch: IndexedRow[],
  batchNumber: number,
  mapping: FieldMapping,
  onProgress: ProgressCallback,
): Promise<BatchOutcome> {
  const provider = getLlmProvider();
  const byIndex = new Map<number, CrmRecord>();
  const skipped: SkippedRecord[] = [];

  const firstIndex = batch[0]?.index ?? 0;

  try {
    const response = await withRetry(
      async (attempt) => {
        if (attempt > 1) {
          onProgress({ type: 'retry', batch: batchNumber, attempt, maxAttempts: env.MAX_RETRIES });
        }
        return provider.complete({
          systemPrompt: EXTRACTION_SYSTEM_PROMPT,
          userPrompt: buildExtractionPrompt(
            batch.map((b) => b.row),
            firstIndex,
            mapping,
          ),
          temperature: 0,
        });
      },
      { attempts: env.MAX_RETRIES, label: `batch-${batchNumber}` },
    );

    const parsed = ExtractionResponseSchema.parse(parseLlmJson(response.text));

    // Join on __row. Never on array position.
    const returned = new Map<number, (typeof parsed.records)[number]>();
    for (const record of parsed.records) {
      returned.set(record.__row, record);
    }

    for (const { index, row } of batch) {
      const raw = returned.get(index);

      if (!raw) {
        skipped.push({
          rowNumber: index + 1,
          reason: 'The AI did not return a record for this row',
          raw: row,
        });
        continue;
      }

      const outcome = normalizeRecord(raw);
      if (outcome.ok) {
        byIndex.set(index, outcome.record);
      } else {
        skipped.push({ rowNumber: index + 1, reason: outcome.reason, raw: row });
      }
    }

    return { byIndex, skipped, failed: false };
  } catch (error) {
    if (error instanceof FatalError) throw error; // bad key / blocked prompt — fail the request

    const reason = error instanceof Error ? error.message : String(error);
    logger.error('Batch exhausted its retries', { batch: batchNumber, reason });

    // The batch is lost, but its rows are accounted for. Nothing disappears.
    return {
      byIndex,
      skipped: batch.map(({ index, row }) => ({
        rowNumber: index + 1,
        reason: `AI extraction failed after ${env.MAX_RETRIES} attempts: ${reason}`,
        raw: row,
      })),
      failed: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

export async function extractCrmRecords(
  csv: ParsedCsv,
  onProgress: ProgressCallback = noop,
): Promise<ImportResult> {
  const startedAt = Date.now();

  onProgress({ type: 'parsed', totalRows: csv.rows.length, headers: csv.headers });

  const mapping = await inferFieldMapping(csv);
  onProgress({ type: 'mapping', mapping });

  logger.info('Field mapping inferred', {
    mapped: mapping.entries.filter((e) => e.crmField).length,
    unmapped: mapping.unmappedColumns.length,
  });

  const indexed: IndexedRow[] = csv.rows.map((row, index) => ({ index, row }));
  const batches = chunk(indexed, env.BATCH_SIZE);

  let completed = 0;
  let imported = 0;
  let skippedCount = 0;

  const outcomes = await mapWithConcurrency(
    batches,
    env.BATCH_CONCURRENCY,
    async (batch, batchIndex) => {
      const outcome = await extractBatch(batch, batchIndex + 1, mapping, onProgress);

      completed += 1;
      imported += outcome.byIndex.size;
      skippedCount += outcome.skipped.length;

      onProgress({
        type: 'batch',
        completed,
        total: batches.length,
        imported,
        skipped: skippedCount,
      });

      return outcome;
    },
  );

  // Reassemble in original CSV order — parallel batches finish out of order.
  const merged = new Map<number, CrmRecord>();
  const skipped: SkippedRecord[] = [];
  let failedBatches = 0;

  for (const outcome of outcomes) {
    for (const [index, record] of outcome.byIndex) merged.set(index, record);
    skipped.push(...outcome.skipped);
    if (outcome.failed) failedBatches += 1;
  }

  const records = [...merged.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, record]) => record);

  skipped.sort((a, b) => a.rowNumber - b.rowNumber);

  // Invariant: every parsed row is accounted for exactly once.
  const accounted = records.length + skipped.length;
  if (accounted !== csv.rows.length) {
    logger.error('Row accounting mismatch', {
      parsed: csv.rows.length,
      imported: records.length,
      skipped: skipped.length,
    });
  }

  const result: ImportResult = {
    records,
    skipped,
    fieldMapping: mapping,
    summary: {
      totalRows: csv.rows.length,
      totalImported: records.length,
      totalSkipped: skipped.length,
      failedBatches,
    },
  };

  logger.info('Import complete', {
    ...result.summary,
    batches: batches.length,
    durationMs: Date.now() - startedAt,
  });

  onProgress({ type: 'done', result });
  return result;
}

/** Column order for the CSV export endpoint. Exported so the route can't invent its own. */
export const EXPORT_COLUMNS = CRM_FIELDS;
