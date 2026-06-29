import { describe, it, expect } from 'vitest';
import { normalizePortal } from '../../src/config/portals.js';
import { TIERS, getTier } from '../../src/config/platform.js';
import { MemoryQueue } from '../../src/queue/memory-queue.js';

describe('platform config — subscription tiers', () => {
  it('defines Basic/Premium/Enterprise with correct region & Bid Brain entitlements', () => {
    expect(getTier('basic')).toMatchObject({ maxRegions: 5, bidBrainEnabled: false });
    expect(getTier('premium')).toMatchObject({ maxRegions: 20, bidBrainEnabled: true });
    expect(getTier('enterprise').maxRegions).toBeGreaterThanOrEqual(100);
    expect(getTier('enterprise').bidBrainEnabled).toBe(true);
    expect(Object.keys(TIERS)).toEqual(['basic', 'premium', 'enterprise']);
  });
});

describe('portal config — zero rate-limit fallback (ERR5)', () => {
  it('replaces a zero/negative configured rate limit with the minimum default', () => {
    const p = normalizePortal(
      { name: 'X', baseUrl: 'https://x.example.com/', rateLimitRpm: 0, publicFlag: true, accessPolicyPath: '/robots.txt' },
      6,
      15,
    );
    expect(p.rateLimitRpm).toBe(6);
    expect(p.rateLimitFallbackApplied).toBe(true);
    expect(p.baseUrl).toBe('https://x.example.com'); // trailing slash trimmed
    expect(p.pollIntervalMinutes).toBe(15); // default applied
  });

  it('keeps a valid rate limit and does not flag a fallback', () => {
    const p = normalizePortal(
      { name: 'Y', baseUrl: 'https://y.example.com', rateLimitRpm: 30, publicFlag: true, accessPolicyPath: '/robots.txt', pollIntervalMinutes: 10 },
      6,
      15,
    );
    expect(p.rateLimitRpm).toBe(30);
    expect(p.rateLimitFallbackApplied).toBe(false);
    expect(p.pollIntervalMinutes).toBe(10);
  });
});

describe('memory queue driver', () => {
  it('delivers an enqueued job to its handler', async () => {
    const q = new MemoryQueue();
    await q.start();
    const seen: number[] = [];
    q.register<{ n: number }>('add', async (p) => {
      seen.push(p.n);
    });
    await q.enqueue('add', { n: 42 });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([42]);
    await q.stop();
  });

  it('retries a failing job up to the configured attempts', async () => {
    const q = new MemoryQueue();
    await q.start();
    let calls = 0;
    q.register('flaky', async () => {
      calls += 1;
      throw new Error('boom');
    });
    await q.enqueue('flaky', {}, { attempts: 3, backoffMs: 1 });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toBe(3);
    await q.stop();
  });
});
