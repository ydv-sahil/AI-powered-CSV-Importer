import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info('Server listening', {
    port: env.PORT,
    env: env.NODE_ENV,
    provider: env.LLM_PROVIDER,
  });
});

/**
 * Graceful shutdown. Render and Railway send SIGTERM and then SIGKILL a few
 * seconds later; draining in-flight uploads first avoids a truncated SSE stream
 * on every redeploy.
 */
function shutdown(signal: string): void {
  logger.info('Shutting down', { signal });

  server.close((error) => {
    if (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('Forced shutdown after 10s drain timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});
