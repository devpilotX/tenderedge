import { describe, it, expect } from 'vitest';
import {
  normalizeListing,
  normalizeRegion,
  normalizeCategory,
  scrubContactDetails,
} from '../../src/radar/normalize.js';
import { parseRobots } from '../../src/radar/robots.js';
import { pollAllPortals } from '../../src/radar/scheduler.js';
import type { SourceAdapter } from '../../src/radar/types.js';
import type { SourcePortalConfig } from '../../src/config/portals.js';

describe('normalization — vocabularies (REQ 3.6)', () => {
  it('maps region/category aliases to canonical vocabulary, null when unmappable', () => {
    expect(normalizeRegion('PATNA')).toBe('Patna');
    expect(normalizeRegion('bodhgaya')).toBe('Gaya'); // alias
    expect(normalizeRegion('Atlantis')).toBeNull();
    expect(normalizeCategory('couplings')).toBe('Mechanical Couplings'); // alias
    expect(normalizeCategory('Industrial Valves')).toBe('Industrial Valves');
    expect(normalizeCategory('unobtanium')).toBeNull();
  });
});

describe('normalization — unknown handling (REQ 3.5)', () => {
  it('marks missing or zero estimated value and missing deadline as unknown', () => {
    const n = normalizeListing('PortalA', {
      sourceIdentifier: 'X-1',
      title: 'Supply',
      estimatedValue: 0,
      deadline: null,
    });
    expect(n.estimatedValue).toBeNull();
    expect(n.estimatedValueStatus).toBe('unknown');
    expect(n.deadline).toBeNull();
    expect(n.deadlineStatus).toBe('unknown');
  });

  it('keeps known value/deadline and quantizes value to 2 decimals', () => {
    const n = normalizeListing('PortalA', {
      sourceIdentifier: 'X-2',
      title: 'Pipes',
      estimatedValue: '1,234.567',
      deadline: '2027-01-15T00:00:00Z',
    });
    expect(n.estimatedValue).toBe(1234.57);
    expect(n.estimatedValueStatus).toBe('known');
    expect(n.deadlineStatus).toBe('known');
  });
});

describe('contact detail exclusion (REQ 4.5)', () => {
  it('redacts emails and phone numbers from free text', () => {
    const out = scrubContactDetails('Call Ramesh at +91 98765 43210 or ramesh@acme.example today');
    expect(out).not.toMatch(/ramesh@acme\.example/);
    expect(out).not.toMatch(/98765/);
    expect(out).toContain('[redacted]');
  });
});

describe('robots policy (REQ 4.3)', () => {
  it('disallows configured paths and allows others', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public');
    expect(policy.isAllowed('/tenders.json')).toBe(true);
    expect(policy.isAllowed('/private/secret')).toBe(false);
    expect(policy.isAllowed('/private/public/list')).toBe(true); // longer Allow wins
  });
});

describe('per-portal failure isolation (REQ 3.4, 17.2)', () => {
  it('continues polling other portals when one fails', async () => {
    const polled: string[] = [];
    const adapter: SourceAdapter = {
      async fetchListings(portal) {
        polled.push(portal.name);
        if (portal.name === 'Bad') throw new Error('unreachable');
        return [];
      },
    };
    const portals: SourcePortalConfig[] = [
      { name: 'Bad', baseUrl: 'https://bad.example', rateLimitRpm: 60, publicFlag: true, accessPolicyPath: '/robots.txt', pollIntervalMinutes: 15, rateLimitFallbackApplied: false },
      { name: 'Good', baseUrl: 'https://good.example', rateLimitRpm: 60, publicFlag: true, accessPolicyPath: '/robots.txt', pollIntervalMinutes: 15, rateLimitFallbackApplied: false },
    ];
    // recordPortalPollResult writes to the DB; this test only asserts both portals are attempted.
    await pollAllPortals(adapter, portals);
    expect(polled).toEqual(['Bad', 'Good']);
  });
});
