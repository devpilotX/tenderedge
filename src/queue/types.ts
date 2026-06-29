/**
 * Job queue abstraction.
 *
 * Two drivers implement this interface:
 *  - RedisQueue  (production): BullMQ on Redis — durable, distributed, with retries; used for
 *                 scheduled polling, deadline scans, billing cycles, prediction & expiry jobs.
 *  - MemoryQueue (dev/test):   in-process timers — lets the platform run and the full test
 *                 suite pass with no Redis dependency. Same semantics, no durability.
 *
 * Selected at runtime via QUEUE_DRIVER (see config/env.ts).
 */
export type JobHandler<T = unknown> = (payload: T) => Promise<void>;

export interface EnqueueOptions {
  /** Delay before the job becomes eligible to run, in milliseconds. */
  delayMs?: number;
  /** Stable id for de-duplication / idempotent scheduling. */
  jobId?: string;
  /** Max delivery attempts on failure (default 1). */
  attempts?: number;
  /** Base backoff between attempts, in milliseconds. */
  backoffMs?: number;
}

export interface RepeatOptions {
  /** Fixed interval between runs, in milliseconds. */
  everyMs: number;
  /** Stable id so re-scheduling the same repeatable job does not duplicate it. */
  jobId: string;
}

export interface JobQueue {
  /** Register the handler that processes jobs of the given name. */
  register<T>(jobName: string, handler: JobHandler<T>): void;
  /** Enqueue a one-off job. */
  enqueue<T>(jobName: string, payload: T, opts?: EnqueueOptions): Promise<void>;
  /** Schedule a repeating job at a fixed interval. */
  scheduleRepeating<T>(jobName: string, payload: T, opts: RepeatOptions): Promise<void>;
  /** Begin processing. */
  start(): Promise<void>;
  /** Stop processing and release resources. */
  stop(): Promise<void>;
  /** Driver identifier, for diagnostics. */
  readonly driver: 'redis' | 'memory';
}
