'use client';

import { useState } from 'react';
import { ArrowRight, ChevronDown, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { CRM_FIELD_LABELS, type FieldMapping } from '@/lib/types';

const CONFIDENCE_TONE = {
  high: 'success',
  medium: 'info',
  low: 'warning',
} as const;

/**
 * Shows what the AI decided each column meant.
 *
 * This is the difference between "the import worked" and "I trust the import".
 * A user who sees `Reach → email (medium)` can catch a bad mapping before it
 * reaches their CRM, instead of discovering it three weeks later.
 */
export function MappingPanel({ mapping }: { mapping: FieldMapping }) {
  const [open, setOpen] = useState(false);

  const mapped = mapping.entries.filter((entry) => entry.crmField !== null);
  const unmapped = mapping.entries.filter((entry) => entry.crmField === null);

  if (mapping.entries.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-[var(--bg-subtle)]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-950/60">
            <Wand2 className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--text-primary)]">
              How the AI read your columns
            </span>
            <span className="block truncate text-xs text-[var(--text-muted)]">
              {mapped.length} mapped to CRM fields
              {unmapped.length > 0 && ` · ${unmapped.length} folded into notes`}
            </span>
          </span>
        </span>

        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="border-t border-[var(--line)] bg-[var(--bg-inset)] p-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {mapping.entries.map((entry) => (
              <li
                key={entry.sourceColumn}
                className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <code className="max-w-[45%] truncate rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]">
                      {entry.sourceColumn}
                    </code>

                    <ArrowRight className="size-3 shrink-0 text-[var(--text-muted)]" aria-hidden />

                    {entry.crmField ? (
                      <span className="font-medium text-[var(--text-primary)]">
                        {CRM_FIELD_LABELS[entry.crmField]}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)] italic">notes</span>
                    )}
                  </div>

                  {entry.reason && (
                    <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                      {entry.reason}
                    </p>
                  )}
                </div>

                {entry.crmField && (
                  <Badge tone={CONFIDENCE_TONE[entry.confidence]}>{entry.confidence}</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
