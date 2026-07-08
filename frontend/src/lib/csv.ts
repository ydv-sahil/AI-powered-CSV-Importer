import Papa from 'papaparse';
import type { PreviewData } from './types';

/**
 * Client-side CSV parsing, for the preview step only.
 *
 * The backend re-parses the file authoritatively; this exists so the user sees
 * their data instantly, without a round trip and without spending a single AI
 * token — which is exactly what the brief asks for ("No AI processing yet").
 *
 * Parsing is *incremental*: Papa streams the file and we abort once we have
 * enough rows for the preview, so a 5MB CSV doesn't lock the main thread while
 * we build 40,000 objects we're never going to render.
 */

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Rows held in memory for the preview table. The virtualizer renders ~20 at a time. */
const PREVIEW_ROW_LIMIT = 500;

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

export function validateFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new CsvParseError(`"${file.name}" is not a .csv file.`);
  }
  if (file.size === 0) {
    throw new CsvParseError(`"${file.name}" is empty.`);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new CsvParseError(
      `"${file.name}" is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
    );
  }
}

export function parseCsvPreview(file: File): Promise<PreviewData> {
  validateFile(file);

  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    let headers: string[] = [];
    let totalRows = 0;
    let aborted = false;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      worker: false,
      transformHeader: (header, index) => header.trim() || `column_${index + 1}`,

      step(results, parser) {
        if (headers.length === 0 && results.meta.fields) {
          headers = results.meta.fields;
        }

        totalRows += 1;

        if (rows.length < PREVIEW_ROW_LIMIT) {
          rows.push(normalizeRow(results.data));
        } else if (!aborted) {
          // We have all we'll show. Stop reading — the backend gets the whole file.
          aborted = true;
          parser.abort();
        }
      },

      complete() {
        if (headers.length === 0) {
          reject(new CsvParseError('The CSV has no header row.'));
          return;
        }
        if (rows.length === 0) {
          reject(new CsvParseError('The CSV has a header row but no data rows.'));
          return;
        }

        resolve({
          fileName: file.name,
          fileSize: file.size,
          headers,
          rows,
          // When we aborted early we only know "at least this many".
          totalRows: aborted ? Math.max(totalRows, rows.length) : totalRows,
        });
      },

      error(error: Error) {
        reject(new CsvParseError(`Could not read the CSV: ${error.message}`));
      },
    });
  });
}

/** Papa hands back `undefined` for short rows and `null` for some blanks. */
function normalizeRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value == null ? '' : String(value).trim();
  }
  return out;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
