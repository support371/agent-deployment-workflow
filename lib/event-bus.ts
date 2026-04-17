// lib/event-bus.ts — per-session pub/sub with replay buffer.
// 
// Architecture:
//   - Uses adapter pattern to allow swapping between in-memory and Redis backends.
//   - In-memory (default): Single Node process assumption, fast, no external deps.
//   - Redis (production): Swap adapter for horizontal scaling across Vercel functions.
//
// To switch to Redis:
//   1. Install @upstash/redis
//   2. Create an Upstash Redis database
//   3. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars
//   4. Uncomment the UpstashEventBusAdapter import and swap the default adapter

import type { StreamEvent } from '@/types/events';

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface EventBusAdapter {
  createSession(id: string): Promise<void>;
  getSession(id: string): Promise<SessionMetadata | null>;
  emit(sessionId: string, event: StreamEvent): Promise<void>;
  getEvents(sessionId: string, fromSeq?: number): Promise<StreamEvent[]>;
  subscribe(sessionId: string, callback: (e: StreamEvent) => void): () => void;
  close(sessionId: string): Promise<void>;
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
const sessions = new Map<string, Session>();

class InMemoryEventBusAdapter implements EventBusAdapter {
  async createSession(id: string): Promise<void> {
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

  async emit(sessionId: string, event: StreamEvent): Promise<void> {
    const s = sessions.get(sessionId);
    if (!s) throw new Error(`Unknown session: ${sessionId}`);
    
    s.events.push(event);
    if (s.events.length > MAX_BUFFER) s.events.shift();
    
    for (const l of s.listeners) {
      try { l(event); } catch { /* listener errors must not break producer */ }
    }
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

  async close(sessionId: string): Promise<void> {
    const s = sessions.get(sessionId);
    if (!s) return;
    
    s.closed = true;
    const closeEvent: StreamEvent = {
      id: `${s.seq++}`,
      ts: Date.now(),
      phase: 'done',
      kind: 'done',
      message: 'stream_closed',
    };
    
    for (const l of s.listeners) {
      try { l(closeEvent); } catch {}
    }
    s.listeners.clear();
    
    // retain buffer briefly so late reconnects can replay
    setTimeout(() => sessions.delete(sessionId), 60_000);
  }
}

// ---------------------------------------------------------------------------
// Redis Adapter (Upstash) - Uncomment to enable horizontal scaling
// ---------------------------------------------------------------------------

// import { Redis } from '@upstash/redis';
//
// class UpstashEventBusAdapter implements EventBusAdapter {
//   private redis: Redis;
//   private subscribers = new Map<string, Set<(e: StreamEvent) => void>>();
//
//   constructor() {
//     this.redis = Redis.fromEnv();
//   }
//
//   async createSession(id: string): Promise<void> {
//     await this.redis.hset(`session:${id}`, {
//       createdAt: Date.now(),
//       closed: 'false',
//       seq: 0,
//     });
//     await this.redis.expire(`session:${id}`, 3600); // 1 hour TTL
//   }
//
//   async getSession(id: string): Promise<SessionMetadata | null> {
//     const data = await this.redis.hgetall(`session:${id}`);
//     if (!data || Object.keys(data).length === 0) return null;
//     const events = await this.redis.llen(`events:${id}`);
//     return {
//       id,
//       createdAt: Number(data.createdAt),
//       closed: data.closed === 'true',
//       eventCount: events,
//       lastEventAt: null, // Would need to fetch last event
//     };
//   }
//
//   async emit(sessionId: string, event: StreamEvent): Promise<void> {
//     await this.redis.rpush(`events:${sessionId}`, JSON.stringify(event));
//     await this.redis.ltrim(`events:${sessionId}`, -MAX_BUFFER, -1);
//     await this.redis.publish(`channel:${sessionId}`, JSON.stringify(event));
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
//     // Note: For production, you'd use a Redis pub/sub subscription here
//     // This is a simplified implementation
//     if (!this.subscribers.has(sessionId)) {
//       this.subscribers.set(sessionId, new Set());
//     }
//     this.subscribers.get(sessionId)!.add(callback);
//     return () => this.subscribers.get(sessionId)?.delete(callback);
//   }
//
//   async close(sessionId: string): Promise<void> {
//     await this.redis.hset(`session:${sessionId}`, { closed: 'true' });
//     await this.redis.expire(`session:${sessionId}`, 60);
//     await this.redis.expire(`events:${sessionId}`, 60);
//   }
// }

// ---------------------------------------------------------------------------
// Default Adapter Instance
// ---------------------------------------------------------------------------

const adapter: EventBusAdapter = new InMemoryEventBusAdapter();
// const adapter: EventBusAdapter = new UpstashEventBusAdapter(); // Uncomment for Redis

// ---------------------------------------------------------------------------
// Public API (maintains backward compatibility)
// ---------------------------------------------------------------------------

export function createSession(id: string): void {
  adapter.createSession(id);
}

export function getSession(id: string): Promise<SessionMetadata | null> {
  return adapter.getSession(id);
}

export function emit(
  sessionId: string,
  e: Omit<StreamEvent, 'id' | 'ts'>,
): StreamEvent {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`Unknown session: ${sessionId}`);
  
  const event: StreamEvent = { ...e, id: `${s.seq++}`, ts: Date.now() };
  adapter.emit(sessionId, event);
  return event;
}

export function close(sessionId: string): void {
  adapter.close(sessionId);
}

export async function* subscribe(
  sessionId: string,
  fromId?: string,
): AsyncGenerator<StreamEvent> {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`Unknown session: ${sessionId}`);

  // Replay anything the client missed.
  const fromSeq = fromId ? parseInt(fromId, 10) : undefined;
  const events = await adapter.getEvents(sessionId, fromSeq);
  for (const e of events) yield e;
  if (s.closed) return;

  // Stream live.
  const queue: StreamEvent[] = [];
  let resolver: ((v: void) => void) | null = null;
  
  const unsubscribe = adapter.subscribe(sessionId, (e: StreamEvent) => {
    queue.push(e);
    resolver?.();
    resolver = null;
  });

  try {
    while (!s.closed) {
      if (queue.length === 0) {
        await new Promise<void>((r) => { resolver = r; });
      }
      while (queue.length > 0) yield queue.shift()!;
    }
  } finally {
    unsubscribe();
  }
}

// Export adapter for testing
export { adapter };
