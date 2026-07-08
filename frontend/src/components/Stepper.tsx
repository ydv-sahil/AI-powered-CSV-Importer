'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ImportPhase } from '@/lib/types';

const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'preview', label: 'Preview' },
  { id: 'process', label: 'AI Extract' },
  { id: 'review', label: 'Review' },
] as const;

/** Which step is "current" for each phase of the flow. `error` keeps the last position. */
const PHASE_STEP: Record<ImportPhase, number> = {
  idle: 0,
  preview: 1,
  processing: 2,
  complete: 3,
  error: 2,
};

export function Stepper({ phase }: { phase: ImportPhase }) {
  const activeIndex = PHASE_STEP[phase];

  return (
    <nav aria-label="Import progress">
      <ol className="flex items-center gap-1 sm:gap-2">
        {STEPS.map((step, index) => {
          const isComplete = index < activeIndex;
          const isCurrent = index === activeIndex;

          return (
            <li key={step.id} className="flex flex-1 items-center gap-1 sm:gap-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
                    'ring-1 transition-colors duration-300',
                    isComplete && 'bg-brand-500 text-white ring-brand-500',
                    isCurrent &&
                      'bg-brand-50 text-brand-600 ring-brand-500 dark:bg-brand-950 dark:text-brand-300',
                    !isComplete &&
                      !isCurrent &&
                      'bg-[var(--bg-subtle)] text-[var(--text-muted)] ring-[var(--line)]',
                  )}
                >
                  {isComplete ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>

                <span
                  className={cn(
                    'hidden text-xs font-medium whitespace-nowrap sm:block',
                    isCurrent
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)]',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {step.label}
                </span>
              </div>

              {index < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'h-px flex-1 transition-colors duration-300',
                    isComplete ? 'bg-brand-500' : 'bg-[var(--line)]',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
