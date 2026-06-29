import { env } from '../config/env.js';
import { MemoryQueue } from './memory-queue.js';
import { RedisQueue } from './redis-queue.js';
import type { JobQueue } from './types.js';

export type { JobQueue, JobHandler, EnqueueOptions, RepeatOptions } from './types.js';

let instance: JobQueue | null = null;

/** Build a queue for the configured driver (does not start it). */
export function createQueue(): JobQueue {
  return env.QUEUE_DRIVER === 'redis' ? new RedisQueue(env.REDIS_URL) : new MemoryQueue();
}

/** Process-wide queue singleton. */
export function getQueue(): JobQueue {
  if (!instance) instance = createQueue();
  return instance;
}

/** Test helper to inject a queue or reset between suites. */
export function setQueue(q: JobQueue | null): void {
  instance = q;
}
