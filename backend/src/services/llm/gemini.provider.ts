import { FatalError, LlmAuthError, RetryableError, withTimeout } from '../../utils/async.js';
import { logger } from '../../utils/logger.js';
import type { LlmCompletionRequest, LlmCompletionResponse, LlmProvider } from './types.js';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Google Gemini, over plain REST.
 *
 * No SDK on purpose. The request shape here is stable and public, `fetch` ships
 * with Node 18+, and this drops a transitive dependency tree from the install
 * along with an entire class of SDK-version drift.
 */

interface GeminiPart {
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
}

/** Status codes where retrying is the right move. Everything else is our fault. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
      generationConfig: {
        temperature: request.temperature ?? 0,
        responseMimeType: 'application/json',
        ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
        // Gemini 2.5+ spends output tokens thinking before it emits a single
        // character of JSON. Left unbounded on a mechanical copy task that is
        // pure cost; on a capped budget it can consume the whole allowance and
        // return an empty candidate. Callers set this per phase.
        ...(request.thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget: request.thinkingBudget } }
          : {}),
      },
      // Lead data routinely trips the default safety filters — a "BAD_LEAD" note
      // reading "abusive on call" is not harmful content, it's a CRM record.
      safetySettings: [
        'HARM_CATEGORY_HARASSMENT',
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_DANGEROUS_CONTENT',
      ].map((category) => ({ category, threshold: 'BLOCK_NONE' })),
    };

    const response = await withTimeout(
      fetch(`${API_ROOT}/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      }),
      this.timeoutMs,
      `gemini:${this.model}`,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      if (response.status === 429) {
        const retryAfterMs = parseRetryDelay(detail, response.headers.get('retry-after'));

        const exhausted = /free_tier_input_token_count|free_tier_requests/i.test(detail);
        const message = exhausted
          ? `Gemini free-tier quota exceeded for "${this.model}".` +
            (retryAfterMs ? ` Provider asked to wait ${Math.round(retryAfterMs / 1000)}s.` : '') +
            ` Lower BATCH_CONCURRENCY, or switch GEMINI_MODEL to gemini-2.5-flash-lite.`
          : 'Gemini rate limit hit.';

        throw new RetryableError(message, retryAfterMs);
      }

      if (RETRYABLE_STATUS.has(response.status)) {
        throw new RetryableError(`Gemini HTTP ${response.status}.`);
      }

      // A rejected key surfaces as 401, 403, or — confusingly — a 400 whose body
      // says API_KEY_INVALID. All three mean the same thing: fix your config.
      if (
        response.status === 401 ||
        response.status === 403 ||
        /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(detail)
      ) {
        throw new LlmAuthError(
          'The AI provider rejected the API key. Check GEMINI_API_KEY in the backend environment.',
        );
      }

      // Any other 4xx is a malformed request. Retrying changes nothing.
      // The provider's raw body may echo prompt content, so it stays in the log.
      logger.warn('Gemini rejected the request', { status: response.status, detail: truncate(detail) });
      throw new FatalError(`Gemini rejected the request (HTTP ${response.status}).`);
    }

    const payload = (await response.json()) as GeminiResponse;

    if (payload.error) {
      throw new RetryableError(`Gemini error: ${payload.error.message ?? 'unknown'}`);
    }

    if (payload.promptFeedback?.blockReason) {
      throw new FatalError(`Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`);
    }

    const candidate = payload.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    if (!text.trim()) {
      const finish = candidate?.finishReason ?? 'none';

      // A thinking model that hits MAX_TOKENS mid-reasoning returns a candidate
      // with no parts at all. Silently retrying that forever is the failure mode;
      // naming it is how you find it.
      const hint =
        finish === 'MAX_TOKENS'
          ? ' — the output budget was consumed before any JSON was written. Lower BATCH_SIZE or set thinkingBudget to 0.'
          : '';

      throw new RetryableError(`Gemini returned no content (finishReason: ${finish})${hint}`);
    }

    return {
      text,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Pull the wait Google asked for out of a 429.
 *
 * The body carries `error.details[]` with a `google.rpc.RetryInfo` entry whose
 * `retryDelay` is a duration string like `"37s"` or `"1.5s"`. A standard
 * `Retry-After` header (seconds) is honoured as a fallback.
 * Returns `undefined` when neither is present or parseable.
 */
function parseRetryDelay(body: string, retryAfterHeader: string | null): number | undefined {
  try {
    const details = (JSON.parse(body) as GeminiResponse & {
      error?: { details?: Array<{ '@type'?: string; retryDelay?: string }> };
    }).error?.details;

    const retryInfo = details?.find((d) => d['@type']?.includes('RetryInfo'));
    const match = /^([\d.]+)s$/.exec(retryInfo?.retryDelay ?? '');
    if (match?.[1]) return Math.ceil(Number(match[1]) * 1000);
  } catch {
    // Not JSON, or a shape we don't recognise. Fall through to the header.
  }

  const seconds = Number(retryAfterHeader);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}
