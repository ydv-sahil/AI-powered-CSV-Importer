import express, { type Express } from 'express';
import cors from 'cors';
import { corsOrigins, env } from './config/env.js';
import { CRM_FIELDS, CRM_STATUSES, DATA_SOURCES } from './domain/crm.js';
import { importRouter } from './routes/import.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { getLlmProvider } from './services/llm/index.js';

export function createApp(): Express {
  const app = express();

  // Behind Render/Railway/Vercel this is what makes req.ip and rate limiting honest.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 86_400,
    }),
  );

  // Only the export endpoint takes a JSON body, and CRM records can be large.
  app.use(express.json({ limit: '10mb' }));

  /** Liveness probe, plus enough config to debug a bad deploy without shell access. */
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      llm: { provider: env.LLM_PROVIDER, model: getLlmProvider().model },
      limits: {
        maxFileSizeBytes: env.MAX_FILE_SIZE_BYTES,
        maxRows: env.MAX_ROWS,
        batchSize: env.BATCH_SIZE,
        batchConcurrency: env.BATCH_CONCURRENCY,
      },
    });
  });

  /** The CRM contract, so the frontend never hardcodes an enum that can drift. */
  app.get('/api/schema', (_req, res) => {
    res.json({
      fields: CRM_FIELDS,
      crmStatuses: CRM_STATUSES,
      dataSources: DATA_SOURCES,
    });
  });

  app.use('/api', importRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
