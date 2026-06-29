import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { childLogger } from '../core/logger.js';
import type { EnqueueOptions, JobHandler, JobQueue, RepeatOptions } from './types.js';

const log = childLogger({ component: 'redis-queue' });

/**
 * Production job queue backed by BullMQ on Redis. Durable and distributable
 * across API/worker nodes. One BullMQ Queue + Worker pair per job name.
 */
export class RedisQueue implements JobQueue {
  readonly driver = 'redis' as const;
  private readonly connection: ConnectionOptions;
  private readonly client: IORedis;
  private handlers = new Map<string, JobHandler>();
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private started = false;

  constructor(redisUrl: string) {
    // maxRetriesPerRequest must be null for BullMQ blocking commands.
    this.client = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.connection = { url: redisUrl } as unknown as ConnectionOptions;
  }

  register<T>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler as JobHandler);
    if (!this.queues.has(jobName)) {
      this.queues.set(jobName, new Queue(jobName, { connection: this.connection }));
    }
  }

  private getQueue(jobName: string): Queue {
    let q = this.queues.get(jobName);
    if (!q) {
      q = new Queue(jobName, { connection: this.connection });
      this.queues.set(jobName, q);
    }
    return q;
  }

  async enqueue<T>(jobName: string, payload: T, opts: EnqueueOptions = {}): Promise<void> {
    await this.getQueue(jobName).add(jobName, payload, {
      delay: opts.delayMs,
      jobId: opts.jobId,
      attempts: opts.attempts ?? 1,
      backoff: opts.backoffMs ? { type: 'fixed', delay: opts.backoffMs } : undefined,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async scheduleRepeating<T>(jobName: string, payload: T, opts: RepeatOptions): Promise<void> {
    await this.getQueue(jobName).add(jobName, payload, {
      repeat: { every: opts.everyMs },
      jobId: opts.jobId,
      removeOnComplete: true,
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    for (const [jobName, handler] of this.handlers) {
      const worker = new Worker(
        jobName,
        async (job) => {
          await handler(job.data);
        },
        { connection: this.connection },
      );
      worker.on('failed', (job, err) =>
        log.error({ jobName, jobId: job?.id, err }, 'job failed'),
      );
      this.workers.set(jobName, worker);
    }
    this.started = true;
    log.info({ jobs: [...this.handlers.keys()] }, 'redis queue started');
  }

  async stop(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.workers.clear();
    await this.client.quit();
    this.started = false;
  }
}
