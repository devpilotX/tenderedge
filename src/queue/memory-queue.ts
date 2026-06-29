import { childLogger } from '../core/logger.js';
import type { EnqueueOptions, JobHandler, JobQueue, RepeatOptions } from './types.js';

const log = childLogger({ component: 'memory-queue' });

interface PendingJob {
  jobName: string;
  payload: unknown;
  attempts: number;
  backoffMs: number;
  attempt: number;
}

/**
 * In-process job queue for dev/test (no Redis). Honors delay, attempts, backoff,
 * and repeating schedules with the same observable semantics as the Redis driver.
 */
export class MemoryQueue implements JobQueue {
  readonly driver = 'memory' as const;
  private handlers = new Map<string, JobHandler>();
  private timers = new Set<NodeJS.Timeout>();
  private repeating = new Map<string, NodeJS.Timeout>();
  private running = false;

  register<T>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler as JobHandler);
  }

  async enqueue<T>(jobName: string, payload: T, opts: EnqueueOptions = {}): Promise<void> {
    const job: PendingJob = {
      jobName,
      payload,
      attempts: Math.max(1, opts.attempts ?? 1),
      backoffMs: opts.backoffMs ?? 0,
      attempt: 0,
    };
    this.scheduleOnce(job, opts.delayMs ?? 0);
  }

  async scheduleRepeating<T>(jobName: string, payload: T, opts: RepeatOptions): Promise<void> {
    const existing = this.repeating.get(opts.jobId);
    if (existing) clearInterval(existing);
    const timer = setInterval(() => {
      void this.run({ jobName, payload, attempts: 1, backoffMs: 0, attempt: 0 });
    }, opts.everyMs);
    // Do not keep the event loop alive solely for repeating jobs.
    timer.unref?.();
    this.repeating.set(opts.jobId, timer);
  }

  private scheduleOnce(job: PendingJob, delayMs: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.run(job);
    }, delayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async run(job: PendingJob): Promise<void> {
    if (!this.running) return;
    const handler = this.handlers.get(job.jobName);
    if (!handler) {
      log.warn({ jobName: job.jobName }, 'no handler registered; dropping job');
      return;
    }
    job.attempt += 1;
    try {
      await handler(job.payload);
    } catch (err) {
      if (job.attempt < job.attempts) {
        const delay = job.backoffMs * job.attempt;
        log.warn({ jobName: job.jobName, attempt: job.attempt, err }, 'job failed; retrying');
        this.scheduleOnce(job, delay);
      } else {
        log.error({ jobName: job.jobName, attempts: job.attempt, err }, 'job failed permanently');
      }
    }
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const t of this.repeating.values()) clearInterval(t);
    this.repeating.clear();
  }
}
