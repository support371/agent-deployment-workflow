'use client';

import { useEffect, useRef, useState } from 'react';
import type { StreamEvent } from '@/types/events';
import { LogLine } from './LogLine';

type Filter = 'all' | 'agent' | 'shell' | 'errors';

export function Transcript({ events }: { events: StreamEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events, autoScroll]);

  const visible = events.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'agent') return e.kind === 'thought' || e.kind === 'status';
    if (filter === 'shell') return e.kind === 'log' || e.kind === 'tool_call' || e.kind === 'tool_result';
    if (filter === 'errors') return e.kind === 'error' || e.stream === 'stderr';
    return true;
  });

  return (
    <div className="panel flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border">
        <div className="flex items-center gap-2">
          <span className="chip border-bg-border text-fg-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-teal pulse-dot" />
            TRANSCRIPT
          </span>
          <span className="text-2xs font-mono text-fg-muted">{events.length} events</span>
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'agent', 'shell', 'errors'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-2xs font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                filter === f
                  ? 'border-teal text-teal bg-teal-glow'
                  : 'border-bg-border text-fg-secondary hover:border-fg-muted'
              }`}
            >
              {f}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-2xs font-mono text-fg-secondary ml-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(ev) => setAutoScroll(ev.target.checked)}
              className="accent-teal"
            />
            FOLLOW
          </label>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {visible.length === 0 ? (
          <div className="px-3 py-6 text-fg-muted font-mono text-xs">
            Awaiting events…
          </div>
        ) : (
          visible.map((e) => <LogLine key={e.id} e={e} />)
        )}
      </div>
    </div>
  );
}
