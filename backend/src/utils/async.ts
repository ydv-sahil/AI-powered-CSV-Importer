import { logger } from './logger.js';

/** Retry, backoff, and bounded concurrency. No dependency, no framework. */

export class RetryableError extends Error {
  override readonly name: string = 'RetryableError';

  /**
   * How long the provider asked us to wait, if it said.
   *
   * Gemini's 429 body carries a `RetryInfo` detail with the exact delay. Ignoring
   * it and backing off a jittered 500ms–8s against a *per-minute* token quota
   * means every attempt lands inside the same exhausted window and the batch is
   * lost. Obeying it lets the request simply succeed a moment later.
   */
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * Signals that retrying is pointless — a 400, a bad API key, a malformed request.
 *
 * `name` is typed as `string` rather than the literal, so subclasses can narrow it.
 */
export class FatalError extends Error {
  override readonly name: string = 'FatalError';
}

/**
 * The provider rejected our credentials.
 *
 * Distinct from a generic `FatalError` because it is neither the server's fault
 * nor the user's file's fault — it is a deployment misconfiguration, and it
 * deserves a message that says so instead of a stack trace or a bare 500.
 */
export class LlmAuthError extends FatalError {
  override readonly name = 'LlmAuthError';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  attempts: number;
  /** Base delay; doubles each attempt. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Ceiling for a provider-requested delay. Guards against a hostile `Retry-After: 3600`. */
  maxRetryAfterMs?: number;
  label?: string;
}

/**
 * Run `task` until it succeeds or attempts are exhausted.
 *
 * Backs off exponentially with full jitter — the standard fix for the
 * thundering herd you get when N parallel batches all hit a 429 at once and
 * all retry on the same schedule.
 *
 * A `FatalError` short-circuits: there is no point retrying an invalid API key.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  {
    attempts,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    maxRetryAfterMs = 65_000,
    label = 'task',
  }: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;

      if (error instanceof FatalError) throw error;
      if (attempt === attempts) break;

      // The provider knows better than our exponential curve does. Believe it,
      // but never let it park the request open indefinitely.
      const requested =
        error instanceof RetryableError && error.retryAfterMs !== undefined
          ? Math.min(error.retryAfterMs, maxRetryAfterMs)
          : undefined;

      const ceiling = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = requested ?? Math.round(Math.random() * ceiling);

      logger.warn(`${label} failed, retrying`, {
        attempt,
        of: attempts,
        delayMs: delay,
        honoringProviderDelay: requested !== undefined,
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after ${attempts} attempts`);
}

/**
 * Map over `items` with at most `limit` promises in flight.
 *
 * Results keep input order. Rejections propagate — callers that need
 * per-item failure isolation should resolve to a result object instead of throwing.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index] as T, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/** Reject with a `RetryableError` if the promise outlives `ms`. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RetryableError(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
