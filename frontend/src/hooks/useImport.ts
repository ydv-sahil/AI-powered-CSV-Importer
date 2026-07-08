'use client';

import { useCallback, useRef, useState } from 'react';
import { ApiClientError, streamImport } from '@/lib/api';
import { CsvParseError, parseCsvPreview } from '@/lib/csv';
import type { FieldMapping, ImportPhase, ImportResult, PreviewData } from '@/lib/types';

/**
 * The whole import flow as one state machine:
 *
 *   idle ──selectFile──▶ preview ──confirm──▶ processing ──▶ complete
 *     ▲                     │                      │            │
 *     └──────reset──────────┴──────────────────────┴────────────┘
 *                                  │
 *                                  └──▶ error ──retry──▶ processing
 *
 * Every transition lives here, so no component can put the UI into a state the
 * flow doesn't allow — the "Confirm" button cannot fire during processing, and a
 * stale SSE stream from an aborted run cannot overwrite a fresh result.
 */

export interface Progress {
  /** 0–100. Interpolated across mapping (0–15%) and batches (15–100%). */
  percent: number;
  batchesCompleted: number;
  batchesTotal: number;
  imported: number;
  skipped: number;
  /** Set while a batch is being retried, cleared when it succeeds. */
  retrying: { batch: number; attempt: number; maxAttempts: number } | null;
  stage: 'uploading' | 'mapping' | 'extracting' | 'finalizing';
}

const INITIAL_PROGRESS: Progress = {
  percent: 0,
  batchesCompleted: 0,
  batchesTotal: 0,
  imported: 0,
  skipped: 0,
  retrying: null,
  stage: 'uploading',
};

export interface ImportState {
  phase: ImportPhase;
  file: File | null;
  preview: PreviewData | null;
  progress: Progress;
  mapping: FieldMapping | null;
  result: ImportResult | null;
  error: { code: string; message: string } | null;
}

const INITIAL_STATE: ImportState = {
  phase: 'idle',
  file: null,
  preview: null,
  progress: INITIAL_PROGRESS,
  mapping: null,
  result: null,
  error: null,
};

/** Mapping is one call of unknown duration; give it a visible slice of the bar. */
const MAPPING_WEIGHT = 15;

export function useImport() {
  const [state, setState] = useState<ImportState>(INITIAL_STATE);

  /** Lets `reset()` and unmount cancel an in-flight stream. */
  const abortRef = useRef<AbortController | null>(null);
  /** Guards against a late event from a cancelled run clobbering fresh state. */
  const runIdRef = useRef(0);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current += 1;
    setState(INITIAL_STATE);
  }, []);

  const selectFile = useCallback(async (file: File) => {
    runIdRef.current += 1;
    const runId = runIdRef.current;

    setState({ ...INITIAL_STATE, phase: 'idle', file });

    try {
      const preview = await parseCsvPreview(file);
      if (runId !== runIdRef.current) return;

      setState((prev) => ({ ...prev, phase: 'preview', preview, error: null }));
    } catch (error) {
      if (runId !== runIdRef.current) return;

      setState({
        ...INITIAL_STATE,
        phase: 'error',
        error: {
          code: error instanceof CsvParseError ? 'CSV_PARSE_ERROR' : 'UNKNOWN',
          message: error instanceof Error ? error.message : 'Could not read that file.',
        },
      });
    }
  }, []);

  const confirm = useCallback(async () => {
    const file = state.file;
    if (!file || state.phase === 'processing') return;

    runIdRef.current += 1;
    const runId = runIdRef.current;

    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({
      ...prev,
      phase: 'processing',
      progress: { ...INITIAL_PROGRESS, stage: 'uploading' },
      result: null,
      error: null,
    }));

    /** Ignore anything arriving after a reset or a newer run started. */
    const isStale = () => runId !== runIdRef.current;

    try {
      for await (const event of streamImport(file, controller.signal)) {
        if (isStale()) return;

        switch (event.type) {
          case 'parsed':
            setState((prev) => ({
              ...prev,
              progress: { ...prev.progress, stage: 'mapping', percent: 5 },
            }));
            break;

          case 'mapping':
            setState((prev) => ({
              ...prev,
              mapping: event.mapping,
              progress: { ...prev.progress, stage: 'extracting', percent: MAPPING_WEIGHT },
            }));
            break;

          case 'batch': {
            const ratio = event.total > 0 ? event.completed / event.total : 0;
            setState((prev) => ({
              ...prev,
              progress: {
                ...prev.progress,
                stage: event.completed === event.total ? 'finalizing' : 'extracting',
                percent: MAPPING_WEIGHT + ratio * (100 - MAPPING_WEIGHT),
                batchesCompleted: event.completed,
                batchesTotal: event.total,
                imported: event.imported,
                skipped: event.skipped,
                retrying: null,
              },
            }));
            break;
          }

          case 'retry':
            setState((prev) => ({
              ...prev,
              progress: {
                ...prev.progress,
                retrying: {
                  batch: event.batch,
                  attempt: event.attempt,
                  maxAttempts: event.maxAttempts,
                },
              },
            }));
            break;

          case 'done':
            setState((prev) => ({
              ...prev,
              phase: 'complete',
              result: event.result,
              mapping: event.result.fieldMapping,
              progress: { ...prev.progress, percent: 100, retrying: null, stage: 'finalizing' },
            }));
            break;

          case 'error':
            setState((prev) => ({
              ...prev,
              phase: 'error',
              error: { code: event.code, message: event.message },
            }));
            break;
        }
      }
    } catch (error) {
      if (isStale() || controller.signal.aborted) return;

      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: {
          code: error instanceof ApiClientError ? error.code : 'NETWORK_ERROR',
          message:
            error instanceof ApiClientError
              ? error.message
              : 'Could not reach the server. Is the backend running?',
        },
      }));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [state.file, state.phase]);

  /** Back to the preview table without re-reading the file. */
  const backToPreview = useCallback(() => {
    abortRef.current?.abort();
    runIdRef.current += 1;

    setState((prev) =>
      prev.preview
        ? { ...prev, phase: 'preview', error: null, result: null, progress: INITIAL_PROGRESS }
        : INITIAL_STATE,
    );
  }, []);

  return { state, selectFile, confirm, reset, backToPreview };
}
