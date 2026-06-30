import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { HttpSourceAdapter } from '../../src/radar/http-adapter.js';
import { ingestListings } from '../../src/radar/aggregation.js';
import { countTenders, getTender } from '../../src/db/repositories/tenders.js';

/**
 * Integration test for Source_Portal connectivity (REQ 4.1). Stands up a local HTTP
 * server that serves /robots.txt and /tenders.json, then drives the real
 * HttpSourceAdapter (fetch + robots policy + JSON parse) through to ingestion.
 */
let server: Server;
let baseUrl = '';
let robotsBody = 'User-agent: *\nAllow: /\n';

const tendersJson = JSON.stringify([
  { sourceIdentifier: 'GOV-1', title: 'Supply of Mechanical Couplings', category: 'couplings', region: 'Patna', estimatedValue: 6200000, deadline: '2027-02-01T00:00:00.000Z', contactEmail: 'officer@portal.example' },
  { sourceIdentifier: 'GOV-2', title: 'DI Pipe Fittings', category: 'di pipe fittings', region: 'Gaya', estimatedValue: 3850000, deadline: '2027-03-01T00:00:00.000Z' },
]);

beforeEach(async () => {
  await resetData();
  robotsBody = 'User-agent: *\nAllow: /\n';
  server = createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(robotsBody);
    } else if (req.url === '/tenders.json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(tendersJson);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Integration — Source_Portal connectivity (REQ 4.1)', () => {
  it('fetches public listings over HTTP and ingests them (contact details stripped)', async () => {
    const adapter = new HttpSourceAdapter();
    const portal = { name: 'StubPortal', baseUrl, rateLimitRpm: 600, accessPolicyPath: '/robots.txt' };
    const raws = await adapter.fetchListings(portal);
    expect(raws).toHaveLength(2);

    const summary = await ingestListings('StubPortal', raws);
    expect(summary.created).toBe(2);

    const t = await withSystem((c) => getTender(c, 'StubPortal', 'GOV-1'));
    expect(t?.product_category).toBe('Mechanical Couplings');
    expect(t?.region).toBe('Patna');
  });

  it('honors a robots.txt disallow and skips the resource (REQ 4.3)', async () => {
    robotsBody = 'User-agent: *\nDisallow: /tenders.json\n';
    const adapter = new HttpSourceAdapter();
    const raws = await adapter.fetchListings({ name: 'StubPortal', baseUrl, rateLimitRpm: 600, accessPolicyPath: '/robots.txt' });
    expect(raws).toHaveLength(0);
    const count = await withSystem((c) => countTenders(c));
    expect(count).toBe(0);
  });
});
