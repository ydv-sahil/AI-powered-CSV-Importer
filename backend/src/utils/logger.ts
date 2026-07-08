/**
 * Structured console logger. Deliberately tiny — no transport, no dependency.
 * In production it emits one JSON object per line, which is what every log
 * aggregator (Railway, Render, Fly, CloudWatch) wants. In development it emits
 * something a human can read.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const isProduction = process.env.NODE_ENV === 'production';
const minLevel: Level = process.env.NODE_ENV === 'test' ? 'error' : 'debug';

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  if (isProduction) {
    process.stdout.write(
      `${JSON.stringify({ level, time: new Date().toISOString(), message, ...context })}\n`,
    );
    return;
  }

  const tag = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const suffix = context && Object.keys(context).length ? ` ${JSON.stringify(context)}` : '';
  process.stdout.write(`${tag} ${message}${suffix}\n`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
