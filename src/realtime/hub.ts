import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { validateSession } from '../auth/service.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'realtime-hub' });

/** Minimal socket surface so the hub is unit-testable without real WebSockets. */
export interface Sendable {
  send(data: string): void;
  readonly readyState: number;
}

export interface RealtimeEvent {
  type: 'connected' | 'match' | 'tender_status' | 'notification';
  [key: string]: unknown;
}

const OPEN = 1;

/**
 * In-process realtime hub (REQ 11). Tracks a set of live sockets per Business_Account
 * and pushes events to them. New matches and tender status changes are published here
 * and delivered within milliseconds (well under the 5-second target). On a dropped
 * connection the client reconnects and re-fetches the dashboard summary (resync).
 *
 * Single-node by design; for multi-node fan-out, publish() would also forward to a
 * Redis pub/sub channel that each node subscribes to (the queue layer already has a
 * Redis driver). The interface here stays the same.
 */
export class RealtimeHub {
  private connections = new Map<string, Set<Sendable>>();

  subscribe(accountId: string, socket: Sendable): void {
    let set = this.connections.get(accountId);
    if (!set) {
      set = new Set();
      this.connections.set(accountId, set);
    }
    set.add(socket);
  }

  unsubscribe(accountId: string, socket: Sendable): void {
    const set = this.connections.get(accountId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.connections.delete(accountId);
  }

  countSubscribers(accountId: string): number {
    return this.connections.get(accountId)?.size ?? 0;
  }

  /** Pushes an event to all of an account's live sockets. Returns how many received it. */
  publish(accountId: string, event: RealtimeEvent): number {
    const set = this.connections.get(accountId);
    if (!set || set.size === 0) return 0;
    const payload = JSON.stringify({ ...event, ts: new Date().toISOString() });
    let sent = 0;
    for (const socket of set) {
      if (socket.readyState === OPEN) {
        try {
          socket.send(payload);
          sent += 1;
        } catch (err) {
          log.warn({ err, accountId }, 'failed to push realtime event');
        }
      }
    }
    return sent;
  }

  /**
   * Attaches a WebSocket server to the HTTP server at /ws. Authenticates the bearer
   * token from the query string against an active session, then subscribes the socket
   * to its account. (REQ 11.1–11.3)
   */
  attach(server: Server): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const { url } = req;
      if (!url || !url.startsWith('/ws')) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void this.onConnection(ws, url);
      });
    });

    return wss;
  }

  private async onConnection(ws: WebSocket, url: string): Promise<void> {
    try {
      const token = new URL(url, 'http://localhost').searchParams.get('token') ?? '';
      const auth = await validateSession(token);
      const accountId = auth.businessAccountId;
      this.subscribe(accountId, ws);
      ws.on('close', () => this.unsubscribe(accountId, ws));
      ws.on('error', () => this.unsubscribe(accountId, ws));
      ws.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));
    } catch {
      // Invalid/expired token: reject the connection (1008 = policy violation).
      try {
        ws.close(1008, 'authentication failed');
      } catch {
        /* ignore */
      }
    }
  }
}

let instance: RealtimeHub | null = null;

export function getRealtimeHub(): RealtimeHub {
  if (!instance) instance = new RealtimeHub();
  return instance;
}
