import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is validated once, at boot. A missing API key should crash the
 * process on startup with a readable message — not surface as a 500 on the
 * first upload of the day.
 */

const intFromString = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intFromString(4000),

  /** Comma-separated list, or `*` to allow any origin. */
  CORS_ORIGIN: z.string().default('*'),

  LLM_PROVIDER: z.enum(['gemini', 'openai', 'anthropic', 'mock']).default('gemini'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5'),

  /** Rows sent to the model per request. Smaller = more parallelism, more tokens. */
  BATCH_SIZE: intFromString(25),
  /** Batches in flight at once. Bounded to stay inside free-tier rate limits. */
  BATCH_CONCURRENCY: intFromString(3),
  /** Attempts per batch, including the first. */
  MAX_RETRIES: intFromString(3),
  /** Per-request timeout against the LLM. */
  LLM_TIMEOUT_MS: intFromString(60_000),

  MAX_FILE_SIZE_BYTES: intFromString(5 * 1024 * 1024),
  MAX_ROWS: intFromString(5_000),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  const requiredKey: Record<Env['LLM_PROVIDER'], keyof Env | null> = {
    gemini: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    mock: null,
  };

  const keyName = requiredKey[env.LLM_PROVIDER];
  if (keyName && !env[keyName]) {
    throw new Error(
      `LLM_PROVIDER is "${env.LLM_PROVIDER}" but ${keyName} is not set.\n` +
        `Add it to backend/.env — see backend/.env.example.`,
    );
  }

  return env;
}

export const env = load();

export const corsOrigins: string[] | '*' =
  env.CORS_ORIGIN === '*'
    ? '*'
    : env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
