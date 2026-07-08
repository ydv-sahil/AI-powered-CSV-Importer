'use client';

import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MAX_FILE_SIZE_BYTES, formatBytes } from '@/lib/csv';

interface DropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

/**
 * Drag-and-drop plus a file picker, in one accessible control.
 *
 * The whole card is a `<label>` bound to a visually-hidden `<input type="file">`,
 * so a keyboard user tabs to it and presses Enter, a screen reader announces it
 * as a file input, and a mouse user drags onto it — without any of the
 * `role="button"` + `onKeyDown` re-implementation that usually goes with a
 * div-based dropzone.
 */
export function Dropzone({ onFile, disabled = false }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputId = useId();

  /** dragenter/dragleave fire for every child element; count them instead of toggling. */
  const dragDepth = useRef(0);

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      if (disabled) return;
      dragDepth.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      // Without this the browser navigates to the file instead of dropping it.
      event.preventDefault();
      if (!disabled) event.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      if (disabled) return;

      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [disabled, onFile],
  );

  return (
    <label
      htmlFor={inputId}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center justify-center',
        'rounded-2xl border-2 border-dashed px-6 py-14 text-center',
        'transition-all duration-200',
        isDragging
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 scale-[1.01]'
          : 'border-[var(--line-strong)] bg-[var(--bg-inset)] hover:border-brand-400 hover:bg-[var(--bg-subtle)]',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <input
        id={inputId}
        type="file"
        accept=".csv,text/csv"
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          // Reset so selecting the same file twice re-fires `change`.
          event.target.value = '';
        }}
      />

      <div
        className={cn(
          'mb-4 grid size-14 place-items-center rounded-xl border transition-colors',
          isDragging
            ? 'border-brand-300 bg-white text-brand-500 dark:bg-brand-950'
            : 'border-[var(--line)] bg-[var(--bg-surface)] text-[var(--text-muted)] group-hover:text-brand-500',
        )}
      >
        {isDragging ? (
          <FileSpreadsheet className="size-6" aria-hidden />
        ) : (
          <Upload className="size-6" aria-hidden />
        )}
      </div>

      <p className="text-base font-semibold text-[var(--text-primary)]">
        {isDragging ? 'Drop it here' : 'Drop your CSV file here'}
      </p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">or click to browse files</p>

      <p className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--text-muted)]">
        <FileSpreadsheet className="size-3.5" aria-hidden />
        Supported: .csv (max {formatBytes(MAX_FILE_SIZE_BYTES)})
      </p>

      <p className="mt-4 max-w-md text-xs leading-relaxed text-[var(--text-muted)]">
        Any column layout works — Facebook exports, Google Ads downloads, Excel sheets, or a
        spreadsheet you typed yourself. The AI figures out which column is which.
      </p>
    </label>
  );
}
