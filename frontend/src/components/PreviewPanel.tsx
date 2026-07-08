'use client';

import { useMemo } from 'react';
import { FileSpreadsheet, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Cell, DataTable, type Column } from '@/components/DataTable';
import { formatBytes } from '@/lib/csv';
import type { PreviewData } from '@/lib/types';

interface PreviewPanelProps {
  preview: PreviewData;
  onConfirm: () => void;
  onCancel: () => void;
}

type Row = Record<string, string>;

/**
 * Step 2 of the brief: show the parsed CSV *before* any AI runs.
 *
 * Everything here is local — the file has not left the browser yet. The Confirm
 * button is the only thing that spends a token.
 */
export function PreviewPanel({ preview, onConfirm, onCancel }: PreviewPanelProps) {
  const columns = useMemo<Column<Row>[]>(
    () =>
      preview.headers.map((header) => ({
        key: header,
        label: header,
        width: 180,
        render: (row) => <Cell value={row[header] ?? ''} />,
      })),
    [preview.headers],
  );

  const hiddenRows = preview.totalRows - preview.rows.length;

  return (
    <div className="animate-in space-y-5">
      {/* File chip */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <FileSpreadsheet className="size-5" aria-hidden />
          </div>

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {preview.fileName}
            </p>
            <p className="text-xs text-[var(--text-muted)] tabular-nums">
              {formatBytes(preview.fileSize)} · {preview.totalRows.toLocaleString()} rows ·{' '}
              {preview.headers.length} columns
            </p>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Remove file and start over">
          <X className="size-4" aria-hidden />
          Remove
        </Button>
      </div>

      {/* Preview table */}
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Preview</h2>
          <p className="text-xs text-[var(--text-muted)]">
            {hiddenRows > 0
              ? `Showing the first ${preview.rows.length.toLocaleString()} rows`
              : 'Showing every row'}
            {' · scroll horizontally for more columns'}
          </p>
        </div>

        <DataTable columns={columns} rows={preview.rows} rowNumbers maxHeight={440} />

        {hiddenRows > 0 && (
          <p className="mt-2.5 text-xs text-[var(--text-muted)]">
            All {preview.totalRows.toLocaleString()} rows will be sent for extraction —
            only the first {preview.rows.length.toLocaleString()} are previewed here.
          </p>
        )}
      </div>

      {/* Confirm */}
      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-[var(--line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-[var(--text-muted)] sm:max-w-md">
          Nothing has been sent to the AI yet. Confirming will map your columns onto GrowEasy CRM
          fields and extract every row.
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button onClick={onConfirm} size="lg" className="flex-1 sm:flex-none">
            <Sparkles className="size-4" aria-hidden />
            Confirm &amp; Extract
          </Button>
        </div>
      </div>
    </div>
  );
}
