'use client';

import { AlertCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Turns an error code into something a human can act on. */
const REMEDY: Record<string, string> = {
  LLM_AUTH_ERROR:
    'The server is running but its AI key was rejected. Set a valid GEMINI_API_KEY in the backend environment — get one free at aistudio.google.com/apikey.',
  NETWORK_ERROR:
    'The backend did not respond. Check that it is running and that NEXT_PUBLIC_API_BASE_URL points at it.',
  FILE_TOO_LARGE: 'Split the file into smaller chunks and import them one at a time.',
  TOO_MANY_ROWS: 'Split the file into smaller chunks and import them one at a time.',
  UNSUPPORTED_FILE_TYPE: 'Export your spreadsheet as .csv and try again.',
  MALFORMED_CSV:
    'Open the file in a spreadsheet app and re-export it — a stray quote usually causes this.',
  NO_DATA_ROWS: 'The file has headers but no data. Check you exported the rows too.',
  EMPTY_FILE: 'The file has no content.',
  CSV_PARSE_ERROR: 'Check the file opens correctly in a spreadsheet app.',
  INTERNAL_ERROR: 'This is on us. Try again in a moment.',
};

export function ErrorPanel({
  code,
  message,
  onRetry,
  onReset,
}: {
  code: string;
  message: string;
  onRetry?: () => void;
  onReset: () => void;
}) {
  const remedy = REMEDY[code];

  return (
    <div
      role="alert"
      className="animate-in rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/30 sm:p-8"
    >
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
          <AlertCircle className="size-6" aria-hidden />
        </div>

        <h2 className="text-base font-semibold text-red-900 dark:text-red-200">
          Something went wrong
        </h2>

        <p className="mt-1.5 text-sm leading-relaxed text-red-800 dark:text-red-300">{message}</p>

        {remedy && (
          <p className="mt-3 text-xs leading-relaxed text-red-700/80 dark:text-red-400/80">
            {remedy}
          </p>
        )}

        <code className="mt-4 rounded bg-red-100 px-2 py-1 font-mono text-[11px] text-red-700 dark:bg-red-950 dark:text-red-400">
          {code}
        </code>

        <div className="mt-6 flex gap-3">
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              <RefreshCw className="size-4" aria-hidden />
              Try again
            </Button>
          )}
          <Button variant="danger" onClick={onReset}>
            <RotateCcw className="size-4" aria-hidden />
            Start over
          </Button>
        </div>
      </div>
    </div>
  );
}
