/**
 * Per-key minimum-interval rate limiter (REQ 4.2). Spaces calls for a given key so
 * they do not exceed the configured requests-per-minute. A non-positive rpm is
 * caller responsibility to avoid — the portal loader already substitutes the
 * platform minimum for a zero/negative configured limit (ERR5).
 */
export class RateLimiter {
  private lastAt = new Map<string, number>();

  async acquire(key: string, rpm: number): Promise<void> {
    const safeRpm = rpm > 0 ? rpm : 1;
    const minIntervalMs = 60_000 / safeRpm;
    const now = Date.now();
    const prev = this.lastAt.get(key) ?? 0;
    const waitMs = Math.max(0, prev + minIntervalMs - now);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    this.lastAt.set(key, Date.now());
  }

  /** Test/diagnostic helper: time (ms) a call would need to wait, without waiting. */
  peekWait(key: string, rpm: number): number {
    const safeRpm = rpm > 0 ? rpm : 1;
    const minIntervalMs = 60_000 / safeRpm;
    const prev = this.lastAt.get(key) ?? 0;
    return Math.max(0, prev + minIntervalMs - Date.now());
  }
}
