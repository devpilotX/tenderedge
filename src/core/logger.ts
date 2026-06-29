import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'tenderedge' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings) as Logger;
}
