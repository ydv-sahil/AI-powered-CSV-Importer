import { cn } from '@/lib/cn';
import type { CrmStatus } from '@/lib/types';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] ring-[var(--line)]',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900',
  danger: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5',
        'text-[11px] font-medium whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<CrmStatus, Tone> = {
  SALE_DONE: 'success',
  GOOD_LEAD_FOLLOW_UP: 'info',
  DID_NOT_CONNECT: 'warning',
  BAD_LEAD: 'danger',
};

const STATUS_LABEL: Record<CrmStatus, string> = {
  SALE_DONE: 'Sale Done',
  GOOD_LEAD_FOLLOW_UP: 'Good Lead',
  DID_NOT_CONNECT: 'Not Connected',
  BAD_LEAD: 'Bad Lead',
};

/** Renders a CRM status chip, or an em-dash when the AI left it blank. */
export function StatusBadge({ status }: { status: string }) {
  if (!status) {
    return <span className="text-[var(--text-muted)]" aria-label="No status">—</span>;
  }

  const known = status in STATUS_TONE ? (status as CrmStatus) : null;

  return (
    <Badge tone={known ? STATUS_TONE[known] : 'neutral'}>
      {known ? STATUS_LABEL[known] : status}
    </Badge>
  );
}
