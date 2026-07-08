import { parse } from 'csv-parse/sync';
import { ApiError } from '../middleware/errors.js';
import { env } from '../config/env.js';

/** One source row, keyed by its original (de-duplicated) header. */
export type CsvRow = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
  /** Rows present in the file but dropped before the AI ever saw them (entirely blank). */
  blankRowNumbers: number[];
}

/** UTF-8 BOM, which Excel prepends and which otherwise corrupts the first header. */
const BOM = '﻿';

/**
 * Turn an uploaded buffer into rows.
 *
 * Deliberately permissive: `relax_column_count` means a row with a stray extra
 * comma yields an extra column rather than killing the whole import. Real
 * exports are ragged, and a hard failure on row 4,000 of 5,000 is a worse
 * outcome than a slightly odd row 4,000.
 */
export function parseCsv(buffer: Buffer): ParsedCsv {
  const text = stripBom(buffer.toString('utf8'));

  if (!text.trim()) {
    throw new ApiError(400, 'EMPTY_FILE', 'The uploaded CSV is empty.');
  }

  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
      // We take the header row ourselves so we can de-duplicate collisions.
      columns: false,
    }) as string[][];
  } catch (error) {
    throw new ApiError(
      400,
      'MALFORMED_CSV',
      `Could not parse the CSV: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const [headerRow, ...dataRows] = records;

  if (!headerRow || headerRow.length === 0) {
    throw new ApiError(400, 'NO_HEADER_ROW', 'The CSV has no header row.');
  }

  if (dataRows.length === 0) {
    throw new ApiError(400, 'NO_DATA_ROWS', 'The CSV has a header row but no data rows.');
  }

  if (dataRows.length > env.MAX_ROWS) {
    throw new ApiError(
      413,
      'TOO_MANY_ROWS',
      `The CSV has ${dataRows.length} rows; the limit is ${env.MAX_ROWS}.`,
    );
  }

  const headers = normalizeHeaders(headerRow);
  const rows: CsvRow[] = [];
  const blankRowNumbers: number[] = [];

  dataRows.forEach((cells, index) => {
    const rowNumber = index + 1; // 1-based, header excluded

    if (cells.every((cell) => cell.trim() === '')) {
      blankRowNumbers.push(rowNumber);
      return;
    }

    const row: CsvRow = {};
    headers.forEach((header, columnIndex) => {
      row[header] = (cells[columnIndex] ?? '').trim();
    });

    // Ragged overflow columns still carry data. Keep them under a synthetic header.
    for (let i = headers.length; i < cells.length; i++) {
      const cell = (cells[i] ?? '').trim();
      if (cell) row[`extra_column_${i + 1}`] = cell;
    }

    rows.push(row);
  });

  if (rows.length === 0) {
    throw new ApiError(400, 'NO_DATA_ROWS', 'Every row in the CSV is blank.');
  }

  return { headers, rows, blankRowNumbers };
}

/**
 * Headers must be unique and non-empty — they become object keys, and a
 * duplicate would silently overwrite a column's data.
 */
function normalizeHeaders(headerRow: string[]): string[] {
  const seen = new Map<string, number>();

  return headerRow.map((raw, index) => {
    const base = stripBom(raw).trim() || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function stripBom(value: string): string {
  return value.startsWith(BOM) ? value.slice(1) : value;
}

/**
 * A representative sample for the mapping phase.
 *
 * Takes rows from the head, middle, and tail rather than the first N. The first
 * few rows of an export are often the least representative — blank optional
 * columns, a test record the sales lead typed in themselves.
 */
export function sampleRows(rows: CsvRow[], count = 8): CsvRow[] {
  if (rows.length <= count) return rows;

  const step = rows.length / count;
  return Array.from({ length: count }, (_, i) => rows[Math.floor(i * step)] as CsvRow);
}

/** Split rows into fixed-size batches, preserving their original indices. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
