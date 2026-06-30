import { describe, it, expect } from 'vitest';
import { computeDueReminders, isPastGracePeriod } from '../../src/deadline/reminders.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-06-30T00:00:00.000Z');

describe('computeDueReminders (REQ 8.2–8.4)', () => {
  it('fires no reminder when the deadline is far away', () => {
    expect(computeDueReminders(NOW + 30 * DAY, [7, 1], NOW, [])).toEqual([]);
  });

  it('fires the 7-day reminder when within 7 days but more than 1 day out', () => {
    expect(computeDueReminders(NOW + 5 * DAY, [7, 1], NOW, [])).toEqual([7]);
  });

  it('fires both reminders when within 1 day', () => {
    expect(computeDueReminders(NOW + 12 * HOUR, [7, 1], NOW, [])).toEqual([7, 1]);
  });

  it('does not re-fire an already-sent offset', () => {
    expect(computeDueReminders(NOW + 5 * DAY, [7, 1], NOW, [7])).toEqual([]);
  });

  it('fires nothing once the deadline has passed', () => {
    expect(computeDueReminders(NOW - HOUR, [7, 1], NOW, [])).toEqual([]);
  });

  it('honors custom intervals', () => {
    expect(computeDueReminders(NOW + 2 * DAY, [14, 3, 1], NOW, [])).toEqual([14, 3]);
  });
});

describe('isPastGracePeriod (REQ 8.5)', () => {
  it('is false before the grace window elapses', () => {
    expect(isPastGracePeriod(NOW - 10 * HOUR, NOW, 24)).toBe(false);
  });
  it('is true after the grace window elapses', () => {
    expect(isPastGracePeriod(NOW - 25 * HOUR, NOW, 24)).toBe(true);
  });
});
