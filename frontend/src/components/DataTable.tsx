'use client';

import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  label: string;
  /** Fixed px width. Fixed widths are what make horizontal scrolling predictable. */
  width?: number;
  render?: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Sticky leading column showing the row number. */
  rowNumbers?: boolean;
  /** Below this many rows, skip virtualization — the DOM cost is trivial and layout is simpler. */
  virtualizeThreshold?: number;
  maxHeight?: number;
  emptyMessage?: string;
  className?: string;
}

const ROW_HEIGHT = 44;
const OVERSCAN = 8;
const DEFAULT_WIDTH = 160;

/**
 * A scrollable, sticky-headed, optionally virtualized table.
 *
 * Virtualization inside a real `<table>` is done with two spacer rows rather
 * than absolutely positioned divs. That keeps `<thead>`/`<tbody>` semantics —
 * so screen readers announce it as a table and `position: sticky` on the header
 * behaves — while still rendering only the ~20 rows in view. A 5,000-row import
 * mounts 20 rows, not 5,000.
 */
export function DataTable<T>({
  columns,
  rows,
  rowNumbers = false,
  virtualizeThreshold = 100,
  maxHeight = 480,
  emptyMessage = 'Nothing to show.',
  className,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = rows.length > virtualizeThreshold;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    enabled: shouldVirtualize,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Spacers stand in for the rows above and below the window.
  const paddingTop = shouldVirtualize && virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    shouldVirtualize && virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  const visible = shouldVirtualize
    ? virtualRows.map((virtualRow) => ({ row: rows[virtualRow.index] as T, index: virtualRow.index }))
    : rows.map((row, index) => ({ row, index }));

  const totalColumns = columns.length + (rowNumbers ? 1 : 0);

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-[var(--line)]',
          'bg-[var(--bg-inset)] py-12 text-sm text-[var(--text-muted)]',
          className,
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-surface)]',
        className,
      )}
    >
      <div
        ref={scrollRef}
        className="scrollbar-thin overflow-auto overscroll-x-contain"
        style={{ maxHeight }}
        // The scroll container is the interactive element; make it focusable
        // so keyboard users can scroll it without a pointer.
        tabIndex={0}
        role="region"
        aria-label="Data table"
      >
        <table className="w-full border-collapse text-left text-sm" style={{ minWidth: 'max-content' }}>
          <thead className="sticky-head">
            <tr className="border-b border-[var(--line)]">
              {rowNumbers && (
                <th
                  scope="col"
                  className={cn(
                    'sticky left-0 z-10 bg-[var(--bg-subtle)]',
                    'w-14 px-3 py-2.5 text-[11px] font-semibold tracking-wider',
                    'text-[var(--text-muted)] uppercase',
                  )}
                >
                  #
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={{ width: column.width ?? DEFAULT_WIDTH, minWidth: column.width ?? DEFAULT_WIDTH }}
                  className={cn(
                    'px-3 py-2.5 text-[11px] font-semibold tracking-wider whitespace-nowrap',
                    'text-[var(--text-muted)] uppercase',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden style={{ height: paddingTop }}>
                <td colSpan={totalColumns} />
              </tr>
            )}

            {visible.map(({ row, index }) => (
              <tr
                key={index}
                style={{ height: ROW_HEIGHT }}
                className={cn(
                  'group border-b border-[var(--line)] last:border-b-0',
                  'transition-colors hover:bg-[var(--bg-subtle)]',
                )}
              >
                {rowNumbers && (
                  <td
                    className={cn(
                      'sticky left-0 z-[1] bg-[var(--bg-surface)]',
                      'px-3 font-mono text-xs text-[var(--text-muted)] tabular-nums',
                      // Match the row hover, which the sticky cell would otherwise cover.
                      'group-hover:bg-[var(--bg-subtle)]',
                    )}
                  >
                    {index + 1}
                  </td>
                )}

                {columns.map((column) => (
                  <td
                    key={column.key}
                    style={{ maxWidth: column.width ?? DEFAULT_WIDTH }}
                    className={cn(
                      'truncate px-3 text-[var(--text-primary)]',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                    )}
                  >
                    {column.render ? column.render(row, index) : null}
                  </td>
                ))}
              </tr>
            ))}

            {paddingBottom > 0 && (
              <tr aria-hidden style={{ height: paddingBottom }}>
                <td colSpan={totalColumns} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Renders a cell value, showing a muted em-dash for blanks so gaps read as intentional. */
export function Cell({ value, title }: { value: string; title?: string }) {
  if (!value) {
    return <span className="text-[var(--text-muted)]">—</span>;
  }
  return (
    <span className="block truncate" title={title ?? value}>
      {value}
    </span>
  );
}
