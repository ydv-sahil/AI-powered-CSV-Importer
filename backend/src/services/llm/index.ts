import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { GeminiProvider } from './gemini.provider.js';
import { MockProvider } from './mock.provider.js';
import type { LlmProvider } from './types.js';

export type { LlmProvider, LlmCompletionRequest, LlmCompletionResponse } from './types.js';

/**
 * Provider factory.
 *
 * Adding OpenAI or Claude is a new file implementing `LlmProvider` plus one case
 * here. Nothing else in the codebase knows which model is answering.
 */
function build(): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'gemini':
      return new GeminiProvider(env.GEMINI_MODEL, env.GEMINI_API_KEY as string, env.LLM_TIMEOUT_MS);

    case 'mock':
      return new MockProvider();

    // `env.ts` rejects these at boot rather than letting a request discover them.
    case 'openai':
    case 'anthropic':
      throw new Error(
        `LLM_PROVIDER="${env.LLM_PROVIDER}" is declared but no adapter is implemented yet. ` +
          `Implement src/services/llm/${env.LLM_PROVIDER}.provider.ts against the LlmProvider interface.`,
      );

    default: {
      const exhaustive: never = env.LLM_PROVIDER;
      throw new Error(`Unhandled LLM_PROVIDER: ${String(exhaustive)}`);
    }
  }
}

let cached: LlmProvider | undefined;

export function getLlmProvider(): LlmProvider {
  if (!cached) {
    cached = build();
    logger.info('LLM provider ready', { provider: cached.name, model: cached.model });
  }
  return cached;
}

/** Test seam — lets a suite inject a fake without touching the environment. */
export function setLlmProvider(provider: LlmProvider | undefined): void {
  cached = provider;
}
