import { describe, it, expect } from 'vitest';
import { RealtimeHub, type Sendable } from '../../src/realtime/hub.js';

function fakeSocket(readyState = 1): { socket: Sendable; sent: string[] } {
  const sent: string[] = [];
  return { socket: { send: (d: string) => sent.push(d), readyState }, sent };
}

describe('RealtimeHub (REQ 11)', () => {
  it('publishes only to an account\u2019s own subscribers (tenant isolation)', () => {
    const hub = new RealtimeHub();
    const a = fakeSocket();
    const b = fakeSocket();
    const other = fakeSocket();
    hub.subscribe('acct-1', a.socket);
    hub.subscribe('acct-1', b.socket);
    hub.subscribe('acct-2', other.socket);

    expect(hub.countSubscribers('acct-1')).toBe(2);
    const delivered = hub.publish('acct-1', { type: 'match', sourceIdentifier: 'X' });
    expect(delivered).toBe(2);
    expect(a.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0]!)).toMatchObject({ type: 'match', sourceIdentifier: 'X' });
    expect(other.sent).toHaveLength(0);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new RealtimeHub();
    const a = fakeSocket();
    hub.subscribe('acct-1', a.socket);
    hub.unsubscribe('acct-1', a.socket);
    expect(hub.countSubscribers('acct-1')).toBe(0);
    expect(hub.publish('acct-1', { type: 'match' })).toBe(0);
  });

  it('skips sockets that are not open', () => {
    const hub = new RealtimeHub();
    const closed = fakeSocket(3);
    hub.subscribe('acct-1', closed.socket);
    expect(hub.publish('acct-1', { type: 'match' })).toBe(0);
    expect(closed.sent).toHaveLength(0);
  });
});
