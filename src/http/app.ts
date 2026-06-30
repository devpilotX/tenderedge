import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../core/logger.js';
import { checkHealth } from '../core/health.js';
import { isAppError } from '../core/errors.js';
import './types.js';
import { authRouter } from './routes/auth.js';

/**
 * Builds the Express application. Route modules for each service are mounted
 * via `mountRouters` as they are implemented (Auth, Tenders, Documents, etc.).
 */
export function createApp(): Application {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req: Request, res: Response) => {
    const report = await checkHealth();
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  mountRouters(app);

  // Centralized error handler: maps typed AppErrors to stable responses.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    logger.error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error.' } });
  });

  return app;
}

/**
 * Mounts feature routers. Each service registers itself here as it is built so
 * the wiring stays in one place. Kept side-effect-free aside from app.use.
 */
function mountRouters(app: Application): void {
  app.use('/auth', authRouter());
}
