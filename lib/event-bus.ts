// lib/event-bus.ts — per-session pub/sub with replay buffer.
//
// Architecture:
//   - Adapter pattern for swapping in-memory <-> Redis-backed storage.
//   - All public API (emit, subscribe, createSession, close, getSession) goes
//     *through* the adapter. Swapping adapters is a one-line change below.
//   - The in-memory adapter is sync under the hood; async adapters (Upstash)
//     synthesize the StreamEvent synchronously with a locally-generated id
//     and fire the network write in the background (fire-and-forget, with
//     errors surfaced via console.error).
//
// To switch to Redis:
//   1. Install @upstash/redis
//   2. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars
//   3. Uncomment the UpstashEventBusAdapter block and swap the default adapter
//      at the bottom of this file.

import type { StreamEvent } from '@/types/events';

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface EventBusAdapter {
  createSession(id: string): void;
  getSession(id: string): Promise<SessionMetadata | null>;
  /**
   * Append an event to the session. Returns the fully-populated StreamEvent
   * (with id and ts assigned). MUST return synchronously so call-sites can
   * emit-and-continue without awaiting.
   */
  emit(sessionId: string, partial: Omit<StreamEvent, 'id' | 'ts'>): StreamEvent;
  getEvents(sessionId: string, fromSeq?: number): Promise<StreamEvent[]>;
  subscribe(sessionId: string, callback: (e: StreamEvent) => void): () => void;
  close(sessionId: string): void;
}

export interface SessionMetadata {
  id: string;
  createdAt: number;
  closed: boolean;
  eventCount: number;
  lastEventAt: number | null;
}

// ---------------------------------------------------------------------------
// In-Memory Adapter (Default)
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  events: StreamEvent[];
  listeners: Set<(e: StreamEvent) => void>;
  closed: boolean;
  seq: number;
  createdAt: number;
}

const MAX_BUFFER = 2_000;

// Store the sessions Map on `globalThis` so its state survives Next.js dev-mode
// HMR reloads of this module. Without this, any hot-reload (triggered when a
// *different* route compiles for the first time) resets the Map and orphans
// in-flight sessions — producing "Unknown session" errors on the SSE stream
// moments after POST /api/agent returns 202. Safe in production because the
// module is loaded once per server instance.
const globalStore = globalThis as unknown as {
  __gemAgentSessions?: Map<string, Session>;
};
const sessions: Map<string, Session> =
  globalStore.__gemAgentSessions ?? new Map<string, Session>();
globalStore.__gemAgentSessions = sessions;

class InMemoryEventBusAdapter implements EventBusAdapter {
  createSession(id: string): void {
    const s: Session = {
      id,
      events: [],
      listeners: new Set(),
      closed: false,
      seq: 0,
      createdAt: Date.now(),
    };
    sessions.set(id, s);
  }

  async getSession(id: string): Promise<SessionMetadata | null> {
    const s = sessions.get(id);
    if (!s) return null;
    return {
      id: s.id,
      createdAt: s.createdAt,
      closed: s.closed,
      eventCount: s.events.length,
      lastEventAt: s.events.length > 0 ? s.events[s.events.length - 1].ts : null,
    };
  }

  emit(sessionId: string, partial: Omit<StreamEvent, 'id' | 'ts'>): StreamEvent {
    const s = sessions.get(sessionId);
    if (!s) throw new Error(`Unknown session: ${sessionId}`);

    const event: StreamEvent = { ...partial, id: `${s.seq++}`, ts: Date.now() };
    s.events.push(event);
    if (s.events.length > MAX_BUFFER) s.events.shift();

    for (const l of s.listeners) {
      try { l(event); } catch { /* listener errors must not break producer */ }
    }
    return event;
  }

  async getEvents(sessionId: string, fromSeq?: number): Promise<StreamEvent[]> {
    const s = sessions.get(sessionId);
    if (!s) return [];

    if (fromSeq === undefined) return [...s.events];

    const startIdx = s.events.findIndex((e) => parseInt(e.id, 10) > fromSeq);
    if (startIdx === -1) return [];
    return s.events.slice(startIdx);
  }

  subscribe(sessionId: string, callback: (e: StreamEvent) => void): () => void {
    const s = sessions.get(sessionId);
    if (!s) throw new Error(`Unknown session: ${sessionId}`);

    s.listeners.add(callback);
    return () => s.listeners.delete(callback);
  }

  close(sessionId: string): void {
    const s = sessions.get(sessionId);
    if (!s) return;

    // Emit the terminal 'done' event through the normal path so subscribers
    // see it in order with everything else. This replaces the previous
    // hand-rolled close event which race-ordered ahead of in-flight emits.
    if (!s.closed) {
      const closeEvent: StreamEvent = {
        id: `${s.seq++}`,
        ts: Date.now(),
        phase: 'done',
        kind: 'done',
        message: 'stream_closed',
      };
      s.events.push(closeEvent);
      for (const l of s.listeners) {
        try { l(closeEvent); } catch {}
      }
    }

    s.closed = true;
    s.listeners.clear();

    // Retain buffer briefly so late reconnects can replay.
    setTimeout(() => sessions.delete(sessionId), 60_000);
  }
}

// ---------------------------------------------------------------------------
// Redis Adapter (Upstash) - Uncomment to enable horizontal scaling
// ---------------------------------------------------------------------------

// import { Redis } from '@upstash/redis';
//
// class UpstashEventBusAdapter implements EventBusAdapter {
//   private redis = Redis.fromEnv();
//   // Per-process listener registry. For true horizontal scale, pair this with
//   // Redis pub/sub or a pg LISTEN/NOTIFY bridge so events fan out across
//   // function instances. For single-region low-QPS use, the replay buffer in
//   // `getEvents` is enough: SSE clients reconnect with Last-Event-ID and catch up.
//   private subscribers = new Map<string, Set<(e: StreamEvent) => void>>();
//   // Local seq counter per sessionId; synchronized via Redis INCR below.
//   // Falls back to this if INCR fails — we prefer continuity over strict
//   // monotonicity across replicas.
//   private seqFallback = new Map<string, number>();
//
//   createSession(id: string): void {
//     void this.redis.hset(`session:${id}`, {
//       createdAt: Date.now(),
//       closed: 0,
//     });
//     void this.redis.expire(`session:${id}`, 3600);
//   }
//
//   async getSession(id: string): Promise<SessionMetadata | null> {
//     const data = await this.redis.hgetall<Record<string, string>>(`session:${id}`);
//     if (!data || !data.createdAt) return null;
//     const eventCount = await this.redis.llen(`events:${id}`);
//     return {
//       id,
//       createdAt: Number(data.createdAt),
//       closed: data.closed === '1',
//       eventCount,
//       lastEventAt: null, // Populate via ZRANGE on a scored stream if needed.
//     };
//   }
//
//   emit(sessionId: string, partial: Omit<StreamEvent, 'id' | 'ts'>): StreamEvent {
//     // Generate id/ts synchronously so call-sites can continue immediately.
//     // Redis write + pub/sub fanout happens in the background.
//     const local = (this.seqFallback.get(sessionId) ?? 0);
//     this.seqFallback.set(sessionId, local + 1);
//     const event: StreamEvent = { ...partial, id: `${local}`, ts: Date.now() };
//
//     // Fan out to local subscribers immediately (same-instance SSE).
//     const locals = this.subscribers.get(sessionId);
//     if (locals) for (const l of locals) { try { l(event); } catch {} }
//
//     // Persist + publish out-of-band.
//     void (async () => {
//       try {
//         await this.redis.rpush(`events:${sessionId}`, JSON.stringify(event));
//         await this.redis.ltrim(`events:${sessionId}`, -MAX_BUFFER, -1);
//         await this.redis.publish(`channel:${sessionId}`, JSON.stringify(event));
//       } catch (err) {
//         console.error('[event-bus] redis emit failed', err);
//       }
//     })();
//
//     return event;
//   }
//
//   async getEvents(sessionId: string, fromSeq?: number): Promise<StreamEvent[]> {
//     const raw = await this.redis.lrange(`events:${sessionId}`, 0, -1);
//     const events = raw.map((r) => JSON.parse(r as string) as StreamEvent);
//     if (fromSeq === undefined) return events;
//     return events.filter((e) => parseInt(e.id, 10) > fromSeq);
//   }
//
//   subscribe(sessionId: string, callback: (e: StreamEvent) => void): () => void {
//     let set = this.subscribers.get(sessionId);
//     if (!set) { set = new Set(); this.subscribers.set(sessionId, set); }
//     set.add(callback);
//     // For true multi-instance fanout, open a Redis pub/sub client here and
//     // forward incoming channel messages into `callback`. Returned cleanup
//     // must close the pub/sub client in addition to removing from the set.
//     return () => set!.delete(callback);
//   }
//
//   close(sessionId: string): void {
//     const closeEvent: StreamEvent = {
//       id: `${(this.seqFallback.get(sessionId) ?? 0)}`,
//       ts: Date.now(),
//       phase: 'done',
//       kind: 'done',
//       message: 'stream_closed',
//     };
//     const locals = this.subscribers.get(sessionId);
//     if (locals) for (const l of locals) { try { l(closeEvent); } catch {} }
//     this.subscribers.delete(sessionId);
//     this.seqFallback.delete(sessionId);
//
//     void (async () => {
//       try {
//         await this.redis.hset(`session:${sessionId}`, { closed: 1 });
//         await this.redis.rpush(`events:${sessionId}`, JSON.stringify(closeEvent));
//         await this.redis.expire(`session:${sessionId}`, 60);
//         await this.redis.expire(`events:${sessionId}`, 60);
//       } catch (err) {
//         console.error('[event-bus] redis close failed', err);
//       }
//     })();
//   }
// }

// ---------------------------------------------------------------------------
// Default Adapter Instance
// ---------------------------------------------------------------------------

const adapter: EventBusAdapter = new InMemoryEventBusAdapter();
// const adapter: EventBusAdapter = new UpstashEventBusAdapter(); // Uncomment for Redis

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createSession(id: string): void {
  adapter.createSession(id);
}

export function getSession(id: string): Promise<SessionMetadata | null> {
  return adapter.getSession(id);
}

/**
 * Append an event. Returns the fully-populated StreamEvent with id and ts.
 * Synchronous-return contract: call-sites fire events in tight loops and
 * don't want to await network I/O. Async adapters buffer + publish in the
 * background.
 */
export function emit(
  sessionId: string,
  e: Omit<StreamEvent, 'id' | 'ts'>,
): StreamEvent {
  return adapter.emit(sessionId, e);
}

export function close(sessionId: string): void {
  adapter.close(sessionId);
}

export async function* subscribe(
  sessionId: string,
  fromId?: string,
): AsyncGenerator<StreamEvent> {
  const initial = await adapter.getSession(sessionId);
  if (!initial) throw new Error(`Unknown session: ${sessionId}`);

  // Replay anything the client missed.
  const fromSeq = fromId ? parseInt(fromId, 10) : undefined;
  const replayed = await adapter.getEvents(sessionId, fromSeq);
  for (const e of replayed) {
    yield e;
    if (e.kind === 'done') return; // session already terminal in the replay window
  }
  if (initial.closed) return;

  // Stream live.
  const queue: StreamEvent[] = [];
  let resolver: ((v: void) => void) | null = null;
  let streamClosed = false;

  const unsubscribe = adapter.subscribe(sessionId, (e: StreamEvent) => {
    queue.push(e);
    if (e.kind === 'done') streamClosed = true;
    resolver?.();
    resolver = null;
  });

  try {
    while (!streamClosed) {
      if (queue.length === 0) {
        await new Promise<void>((r) => { resolver = r; });
      }
      while (queue.length > 0) {
        const e = queue.shift()!;
        yield e;
        if (e.kind === 'done') return;
      }
    }
    // Drain anything buffered after the final done.
    while (queue.length > 0) yield queue.shift()!;
  } finally {
    unsubscribe();
  }
}

// Export adapter for testing.
export { adapter };
