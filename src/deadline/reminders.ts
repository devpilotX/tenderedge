const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Returns the reminder offsets (in days) that are due to fire now, given the tracked
 * deadline, the configured offsets, and the offsets already sent (REQ 8.2–8.4).
 *
 * A reminder at offset D is due when the deadline is within D days (remaining <= D
 * days) and still in the future, and it hasn't already been sent. This fires each
 * threshold exactly once and never misses one even if a scan is skipped. Pure.
 */
export function computeDueReminders(
  deadlineMs: number,
  offsetsDays: readonly number[],
  nowMs: number,
  alreadySent: readonly number[],
): number[] {
  const remaining = deadlineMs - nowMs;
  if (remaining <= 0) return [];
  const sent = new Set(alreadySent);
  return offsetsDays
    .filter((d) => d > 0 && !sent.has(d) && remaining <= d * DAY_MS)
    .sort((a, b) => b - a);
}

/**
 * True when a tracked tender's deadline has passed by more than the grace period and
 * it should be auto-closed (REQ 8.5). Pure.
 */
export function isPastGracePeriod(deadlineMs: number, nowMs: number, graceHours: number): boolean {
  return nowMs > deadlineMs + graceHours * HOUR_MS;
}
