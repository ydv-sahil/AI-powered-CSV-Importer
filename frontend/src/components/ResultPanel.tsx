'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RotateCcw, Rows3, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { Cell, DataTable, type Column } from '@/components/DataTable';
import { MappingPanel } from '@/components/MappingPanel';
import { downloadCsv } from '@/lib/api';
import { cn } from '@/lib/cn';
import { CRM_FIELDS, CRM_FIELD_LABELS, type CrmRecord, type ImportResult, type SkippedRecord } from '@/lib/types';

type Tab = 'imported' | 'skipped';

/** Per-column widths, so the table doesn't give `crm_note` the same 160px as `country_code`. */
const COLUMN_WIDTHS: Partial<Record<(typeof CRM_FIELDS)[number], number>> = {
  created_at: 165,
  name: 160,
  email: 220,
  country_code: 80,
  mobile_without_country_code: 140,
  company: 160,
  city: 130,
  state: 130,
  country: 110,
  lead_owner: 190,
  crm_status: 150,
  crm_note: 300,
  data_source: 150,
  possession_time: 140,
  description: 240,
};

export function ResultPanel({
  result,
  fileName,
  onReset,
}: {
  result: ImportResult;
  fileName: string;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<Tab>('imported');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { records, skipped, summary, fieldMapping } = result;

  const recordColumns = useMemo<Column<CrmRecord>[]>(
    () =>
      CRM_FIELDS.map((field) => ({
        key: field,
        label: CRM_FIELD_LABELS[field],
        width: COLUMN_WIDTHS[field] ?? 150,
        render: (row) =>
          field === 'crm_status' ? (
            <StatusBadge status={row.crm_status} />
          ) : (
            <Cell value={row[field]} />
          ),
      })),
    [],
  );

  const skippedColumns = useMemo<Column<SkippedRecord>[]>(
    () => [
      {
        key: 'rowNumber',
        label: 'CSV Row',
        width: 90,
        align: 'right',
        render: (row) => (
          <span className="font-mono text-xs tabular-nums text-[var(--text-muted)]">
            {row.rowNumber}
          </span>
        ),
      },
      {
        key: 'reason',
        label: 'Why it was skipped',
        width: 300,
        render: (row) => (
          <span className="text-amber-700 dark:text-amber-400" title={row.reason}>
            {row.reason}
          </span>
        ),
      },
      {
        key: 'raw',
        label: 'Original row',
        width: 520,
        render: (row) => {
          const preview = Object.entries(row.raw)
            .filter(([, value]) => value)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ');
          return <Cell value={preview || '(empty row)'} />;
        },
      },
    ],
    [],
  );

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const base = fileName.replace(/\.csv$/i, '').replace(/[^\w-]/g, '_').slice(0, 60);
      await downloadCsv(records, `${base || 'leads'}_groweasy.csv`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  const successRate =
    summary.totalRows > 0 ? Math.round((summary.totalImported / summary.totalRows) * 100) : 0;

  return (
    <div className="animate-in space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Rows3}
          label="Total rows"
          value={summary.totalRows}
          tone="neutral"
        />
        <StatCard
          icon={CheckCircle2}
          label="Imported"
          value={summary.totalImported}
          tone="success"
        />
        <StatCard
          icon={SkipForward}
          label="Skipped"
          value={summary.totalSkipped}
          tone={summary.totalSkipped > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          icon={CheckCircle2}
          label="Success rate"
          value={`${successRate}%`}
          tone={successRate >= 90 ? 'success' : successRate >= 60 ? 'warning' : 'danger'}
        />
      </div>

      {summary.failedBatches > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {summary.failedBatches} batch{summary.failedBatches === 1 ? '' : 'es'} could not be
            processed after retrying. Those rows are listed under <strong>Skipped</strong> — you can
            re-upload just those, or try again.
          </p>
        </div>
      )}

      <MappingPanel mapping={fieldMapping} />

      {/* Tabs */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Import results"
            className="inline-flex rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-0.5"
          >
            <TabButton
              active={tab === 'imported'}
              onClick={() => setTab('imported')}
              count={summary.totalImported}
            >
              Imported
            </TabButton>
            <TabButton
              active={tab === 'skipped'}
              onClick={() => setTab('skipped')}
              count={summary.totalSkipped}
              disabled={summary.totalSkipped === 0}
            >
              Skipped
            </TabButton>
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onReset}>
              <RotateCcw className="size-3.5" aria-hidden />
              Import another
            </Button>
            <Button
              size="sm"
              onClick={handleDownload}
              loading={downloading}
              disabled={records.length === 0}
            >
              <Download className="size-3.5" aria-hidden />
              Download CSV
            </Button>
          </div>
        </div>

        {downloadError && (
          <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-400">
            {downloadError}
          </p>
        )}

        <div role="tabpanel">
          {tab === 'imported' ? (
            <DataTable
              columns={recordColumns}
              rows={records}
              rowNumbers
              maxHeight={520}
              emptyMessage="No records could be extracted from this file."
            />
          ) : (
            <DataTable
              columns={skippedColumns}
              rows={skipped}
              maxHeight={520}
              emptyMessage="Nothing was skipped — every row made it through."
            />
          )}
        </div>

        <p className="mt-2.5 text-xs text-[var(--text-muted)]">
          {tab === 'imported'
            ? 'Scroll horizontally to see all 15 CRM fields. Hover a truncated cell to read it in full.'
            : 'A row is skipped when it has neither an email address nor a mobile number.'}
        </p>
      </div>
    </div>
  );
}

const STAT_TONES = {
  neutral: 'text-[var(--text-secondary)] bg-[var(--bg-subtle)]',
  success: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-400',
  warning: 'text-amber-600 bg-amber-50 dark:bg-amber-950/60 dark:text-amber-400',
  danger: 'text-red-600 bg-red-50 dark:bg-red-950/60 dark:text-red-400',
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Rows3;
  label: string;
  value: number | string;
  tone: keyof typeof STAT_TONES;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2.5">
        <span className={cn('grid size-8 place-items-center rounded-lg', STAT_TONES[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      </div>

      <p className="mt-2.5 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function TabButton({
  active,
  disabled,
  count,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
        disabled && 'cursor-not-allowed opacity-40 hover:text-[var(--text-muted)]',
      )}
    >
      {children}
      <span className="tabular-nums opacity-60">{count.toLocaleString()}</span>
    </button>
  );
}
