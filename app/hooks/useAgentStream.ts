'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentPhase, StreamEvent } from '@/types/events';

interface State {
  events: StreamEvent[];
  phase: AgentPhase | null;
  previewUrl: string | null;
  sandboxId: string | null;
  deployJobId: string | null;
  changelog: string | null;
  failed: boolean;
  done: boolean;
}

const INITIAL: State = {
  events: [],
  phase: null,
  previewUrl: null,
  sandboxId: null,
  deployJobId: null,
  changelog: null,
  failed: false,
  done: false,
};

/**
 * Subscribes to /api/agent/stream?sessionId=... and reduces events into
 * a denormalized UI state. Reconnects with Last-Event-ID on drops.
 */
export function useAgentStream(sessionId: string | null) {
  const [state, setState] = useState<State>(INITIAL);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setState(INITIAL);
      return;
    }

    const es = new EventSource(`/api/agent/stream?sessionId=${sessionId}`);
    esRef.current = es;

    const onMessage = (raw: MessageEvent) => {
      try {
        const e = JSON.parse(raw.data) as StreamEvent;
        setState((prev) => reduce(prev, e));
      } catch { /* ignore malformed */ }
    };

    // Attach per-event-type listeners (SSE `event:` field).
    const kinds = ['status', 'thought', 'tool_call', 'tool_result', 'log', 'diff', 'url', 'error', 'done'];
    kinds.forEach((k) => es.addEventListener(k, onMessage as EventListener));
    es.onmessage = onMessage; // fallback

    es.onerror = () => {
      // Browser auto-reconnects with Last-Event-ID.
      // We close explicitly once a `done` event has been processed.
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [sessionId]);

  return state;
}

function reduce(state: State, e: StreamEvent): State {
  const next: State = { ...state, events: [...state.events, e], phase: e.phase ?? state.phase };

  if (e.kind === 'error') next.failed = true;
  if (e.kind === 'done') next.done = true;

  if (e.kind === 'url' && typeof e.data?.url === 'string') {
    next.previewUrl = e.data.url as string;
    if (typeof e.data?.sandboxId === 'string') next.sandboxId = e.data.sandboxId as string;
  }
  if (e.kind === 'status' && typeof e.data?.sandboxId === 'string') {
    next.sandboxId = e.data.sandboxId as string;
  }
  if (e.phase === 'deploying' && typeof e.data?.jobId === 'string') {
    next.deployJobId = e.data.jobId as string;
  }
  if (e.phase === 'done' && typeof e.data?.changelog === 'string') {
    next.changelog = e.data.changelog as string;
  }

  return next;
}
