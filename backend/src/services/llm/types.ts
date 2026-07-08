/**
 * The seam between "we need a language model" and "which language model".
 *
 * Everything above this interface — batching, retry, validation, normalization —
 * is provider-agnostic. Swapping Gemini for OpenAI or Claude means adding one
 * file and one line in the factory.
 */

export interface LlmCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Providers that support constrained decoding use this; others ignore it. */
  jsonSchema?: Record<string, unknown>;
  /** 0 for extraction work. We want determinism, not creativity. */
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface LlmCompletionResponse {
  /** Raw model output. Expected to be JSON, but not guaranteed to be — parse defensively. */
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}
