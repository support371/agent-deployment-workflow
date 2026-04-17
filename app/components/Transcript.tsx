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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2.5 border-b border-bg-border">
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <span className="chip border-bg-border text-fg-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-teal pulse-dot" />
            TRANSCRIPT
          </span>
          <span className="text-2xs font-mono text-fg-muted">{events.length} events</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 -mx-1 px-1">
          {(['all', 'agent', 'shell', 'errors'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs sm:text-2xs font-mono uppercase tracking-wider px-2.5 sm:px-2 py-1.5 sm:py-1 rounded-md sm:rounded-sm border transition-colors whitespace-nowrap ${
                filter === f
                  ? 'border-teal text-teal bg-teal-glow'
                  : 'border-bg-border text-fg-secondary hover:border-fg-muted'
              }`}
            >
              {f}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs sm:text-2xs font-mono text-fg-secondary ml-1 sm:ml-2 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(ev) => setAutoScroll(ev.target.checked)}
              className="accent-teal w-4 h-4 sm:w-3 sm:h-3"
            />
            FOLLOW
          </label>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {visible.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <div className="text-fg-muted font-mono text-sm sm:text-xs mb-1">
              Awaiting events...
            </div>
            <div className="text-fg-muted/60 text-xs">
              Start a build to see real-time logs
            </div>
          </div>
        ) : (
          visible.map((e) => <LogLine key={e.id} e={e} />)
        )}
      </div>
    </div>
  );
}
