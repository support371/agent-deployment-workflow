// lib/event-bus.ts — per-session pub/sub with replay buffer.
// Single Node process assumption; swap for Redis/KV on horizontal scale.
import type { StreamEvent } from '@/types/events';

interface Session {
  id: string;
  events: StreamEvent[];          // ring buffer for reconnect / replay
  listeners: Set<(e: StreamEvent) => void>;
  closed: boolean;
  seq: number;
}

const MAX_BUFFER = 2_000;
const sessions = new Map<string, Session>();

export function createSession(id: string): Session {
  const s: Session = { id, events: [], listeners: new Set(), closed: false, seq: 0 };
  sessions.set(id, s);
  return s;
}

export function getSession(id: string): Session | null {
  return sessions.get(id) ?? null;
}

export function emit(
  sessionId: string,
  e: Omit<StreamEvent, 'id' | 'ts'>,
): StreamEvent {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`Unknown session: ${sessionId}`);
  const event: StreamEvent = { ...e, id: `${s.seq++}`, ts: Date.now() };
  s.events.push(event);
  if (s.events.length > MAX_BUFFER) s.events.shift();
  for (const l of s.listeners) {
    try { l(event); } catch { /* listener errors must not break producer */ }
  }
  return event;
}

export function close(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.closed = true;
  for (const l of s.listeners) {
    try { l({ id: `${s.seq++}`, ts: Date.now(), phase: 'done', kind: 'done', message: 'stream_closed' }); } catch {}
  }
  s.listeners.clear();
  // retain buffer briefly so late reconnects can replay
  setTimeout(() => sessions.delete(sessionId), 60_000);
}

export async function* subscribe(
  sessionId: string,
  fromId?: string,
): AsyncGenerator<StreamEvent> {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`Unknown session: ${sessionId}`);

  // Replay anything the client missed.
  const startIdx = fromId
    ? s.events.findIndex((e) => e.id === fromId) + 1
    : 0;
  for (const e of s.events.slice(Math.max(0, startIdx))) yield e;
  if (s.closed) return;

  // Stream live.
  const queue: StreamEvent[] = [];
  let resolver: ((v: void) => void) | null = null;
  const listener = (e: StreamEvent) => {
    queue.push(e);
    resolver?.();
    resolver = null;
  };
  s.listeners.add(listener);

  try {
    while (!s.closed) {
      if (queue.length === 0) {
        await new Promise<void>((r) => { resolver = r; });
      }
      while (queue.length > 0) yield queue.shift()!;
    }
  } finally {
    s.listeners.delete(listener);
  }
}
