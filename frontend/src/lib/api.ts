import type { CrmRecord, ImportResult, ProgressEvent } from './types';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(
  /\/+$/,
  '',
);

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function toApiError(response: Response): Promise<ApiClientError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // A proxy timeout or a crash yields HTML, not JSON. Fall through to the default.
  }

  return new ApiClientError(
    body.error?.code ?? 'HTTP_ERROR',
    body.error?.message ?? `Request failed with status ${response.status}.`,
    response.status,
  );
}

/**
 * Stream an import, yielding progress events as the backend emits them.
 *
 * `EventSource` is the obvious tool for SSE and is useless here: it can only
 * issue a GET, and we need to POST a multipart file. So we read the response
 * body ourselves and re-implement the (very small) SSE framing: events are
 * separated by a blank line, `data:` lines carry the payload, `:` lines are
 * comments/heartbeats.
 */
export async function* streamImport(
  file: File,
  signal?: AbortSignal,
): AsyncGenerator<ProgressEvent, void, undefined> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/api/import/stream`, {
    method: 'POST',
    body: formData,
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiClientError('NO_BODY', 'The server returned an empty response.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Normalize the whole buffer, not just the new chunk: a CRLF can straddle
      // the boundary between two reads.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');

      // Events are delimited by a blank line. A partial event stays in the buffer.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const event = parseSseChunk(chunk);
        if (event) yield event;
      }
    }
  } finally {
    // Aborting mid-stream leaves the reader locked unless we release it.
    reader.releaseLock();
  }
}

function parseSseChunk(chunk: string): ProgressEvent | null {
  const dataLines = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null; // a `: ping` heartbeat or an `event:`-only frame

  try {
    return JSON.parse(dataLines.join('\n')) as ProgressEvent;
  } catch {
    return null;
  }
}

/** Non-streaming import. Kept for parity with the documented API; unused by the UI. */
export async function importCsv(file: File, signal?: AbortSignal): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/api/import`, {
    method: 'POST',
    body: formData,
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as ImportResult;
}

/** Ask the backend to serialize records back to CSV, then trigger a browser download. */
export async function downloadCsv(records: CrmRecord[], filename?: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records, ...(filename ? { filename } : {}) }),
  });

  if (!response.ok) throw await toApiError(response);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename ?? 'groweasy_crm_import.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, { cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}
