import { FatalError, RetryableError, withTimeout } from '../../utils/async.js';
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
      const message = `Gemini HTTP ${response.status}: ${truncate(detail)}`;

      if (RETRYABLE_STATUS.has(response.status)) throw new RetryableError(message);
      // 401/403 = bad key. 400 = malformed request. Retrying changes nothing.
      throw new FatalError(message);
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
      // MAX_TOKENS on a batch means the batch was too big — worth one retry,
      // and the caller will halve the batch if it keeps happening.
      throw new RetryableError(
        `Gemini returned no content (finishReason: ${candidate?.finishReason ?? 'none'})`,
      );
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
