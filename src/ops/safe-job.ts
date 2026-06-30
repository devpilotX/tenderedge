import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'safe-job' });

/**
 * Wraps a scheduled job so a failure is caught and logged rather than propagating
 * (graceful degradation, REQ 17.2). One subsystem's failure never crashes the process
 * or stops the other scheduled jobs from running on their next tick.
 */
export function safeJob(name: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      log.error({ job: name, err }, 'scheduled job failed; isolated (other subsystems continue)');
    }
  };
}
