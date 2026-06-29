import { query } from '../db/pool.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: boolean };
  uptimeSeconds: number;
}

/** Liveness/readiness report. Database failure yields a degraded status, not a throw. */
export async function checkHealth(): Promise<HealthReport> {
  let database = false;
  try {
    await query('SELECT 1');
    database = true;
  } catch {
    database = false;
  }
  return {
    status: database ? 'ok' : 'degraded',
    checks: { database },
    uptimeSeconds: Math.round(process.uptime()),
  };
}
