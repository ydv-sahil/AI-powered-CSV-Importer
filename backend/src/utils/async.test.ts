import { describe, expect, it, vi } from 'vitest';
import { FatalError, RetryableError, mapWithConcurrency, withRetry, withTimeout } from './async.js';

describe('withRetry', () => {
  it('returns the first successful result without sleeping', async () => {
    const task = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(task, { attempts: 3 })).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('retries a failing task up to `attempts` times, then rethrows', async () => {
    const task = vi.fn().mockRejectedValue(new RetryableError('boom'));

    await expect(withRetry(task, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow('boom');
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('succeeds on a later attempt', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('transient'))
      .mockResolvedValue('recovered');

    await expect(withRetry(task, { attempts: 3, baseDelayMs: 1 })).resolves.toBe('recovered');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('does not retry a FatalError — a bad API key will not fix itself', async () => {
    const task = vi.fn().mockRejectedValue(new FatalError('invalid key'));

    await expect(withRetry(task, { attempts: 5, baseDelayMs: 1 })).rejects.toThrow('invalid key');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('passes the attempt number to the task', async () => {
    const seen: number[] = [];
    const task = vi.fn(async (attempt: number) => {
      seen.push(attempt);
      if (attempt < 3) throw new RetryableError('again');
      return 'done';
    });

    await withRetry(task, { attempts: 3, baseDelayMs: 1 });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('honours a provider-requested retry delay over its own backoff', async () => {
    vi.useFakeTimers();
    try {
      const task = vi
        .fn()
        .mockRejectedValueOnce(new RetryableError('slow down', 30_000))
        .mockResolvedValue('ok');

      const promise = withRetry(task, { attempts: 2, baseDelayMs: 1, maxDelayMs: 8_000 });

      // The exponential curve would have waited <= 8s. The provider said 30s.
      await vi.advanceTimersByTimeAsync(8_000);
      expect(task).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(22_000);
      await expect(promise).resolves.toBe('ok');
      expect(task).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps a provider delay so a hostile Retry-After cannot park the request', async () => {
    vi.useFakeTimers();
    try {
      const task = vi
        .fn()
        .mockRejectedValueOnce(new RetryableError('wait an hour', 3_600_000))
        .mockResolvedValue('ok');

      const promise = withRetry(task, { attempts: 2, maxRetryAfterMs: 5_000 });

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(promise).resolves.toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const result = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });

    expect(result).toEqual([30, 10, 20]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });

  it('handles fewer items than the limit', async () => {
    await expect(mapWithConcurrency([1, 2], 10, async (n) => n * 2)).resolves.toEqual([2, 4]);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise wins', async () => {
    await expect(withTimeout(Promise.resolve('fast'), 1_000)).resolves.toBe('fast');
  });

  it('rejects with a RetryableError when the timeout wins', async () => {
    const never = new Promise(() => {});
    await expect(withTimeout(never, 10, 'llm')).rejects.toThrow(RetryableError);
    await expect(withTimeout(never, 10, 'llm')).rejects.toThrow(/llm timed out after 10ms/);
  });
});
