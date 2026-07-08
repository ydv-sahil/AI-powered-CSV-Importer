'use client';

import { Brain, CheckCircle2, Loader2, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Progress } from '@/hooks/useImport';

const STAGE_COPY: Record<Progress['stage'], { icon: typeof Upload; title: string; detail: string }> = {
  uploading: {
    icon: Upload,
    title: 'Uploading your file',
    detail: 'Sending the CSV to the server.',
  },
  mapping: {
    icon: Brain,
    title: 'Understanding your columns',
    detail: 'The AI is reading your headers and sample rows to work out what each column means.',
  },
  extracting: {
    icon: Sparkles,
    title: 'Extracting CRM records',
    detail: 'Rows are processed in parallel batches.',
  },
  finalizing: {
    icon: CheckCircle2,
    title: 'Finishing up',
    detail: 'Validating records and assembling the result.',
  },
};

export function ProcessingPanel({ progress }: { progress: Progress }) {
  const { icon: Icon, title, detail } = STAGE_COPY[progress.stage];
  const percent = Math.min(100, Math.round(progress.percent));

  return (
    <div className="animate-in rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-card)] sm:p-10">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div className="relative mb-5 grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/60">
          <Icon className={cn('size-7', progress.stage !== 'finalizing' && 'animate-pulse')} aria-hidden />
        </div>

        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{detail}</p>

        {/* Progress bar */}
        <div className="mt-7 w-full">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="AI extraction progress"
          >
            <div
              className="relative h-full rounded-full bg-brand-500 transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(percent, 2)}%` }}
            >
              <span className="shimmer absolute inset-0 rounded-full" aria-hidden />
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span className="tabular-nums">{percent}%</span>
            {progress.batchesTotal > 0 && (
              <span className="tabular-nums">
                Batch {progress.batchesCompleted} of {progress.batchesTotal}
              </span>
            )}
          </div>
        </div>

        {/* Live counters. Reassures the user something is actually landing. */}
        {(progress.imported > 0 || progress.skipped > 0) && (
          <div className="mt-6 flex items-center gap-6 text-sm" aria-live="polite">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {progress.imported}
              </span>
              <span className="text-[var(--text-muted)]">parsed</span>
            </span>

            {progress.skipped > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {progress.skipped}
                </span>
                <span className="text-[var(--text-muted)]">skipped</span>
              </span>
            )}
          </div>
        )}

        {/* A retry is normal on a free-tier rate limit — say so, don't alarm. */}
        {progress.retrying && (
          <p
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
            aria-live="polite"
          >
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            Batch {progress.retrying.batch} hit a snag — retrying (attempt{' '}
            {progress.retrying.attempt} of {progress.retrying.maxAttempts})
          </p>
        )}

        <p className="mt-7 inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Large files take a moment — you can leave this tab open.
        </p>
      </div>
    </div>
  );
}
