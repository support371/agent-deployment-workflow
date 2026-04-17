'use client';

import type { StreamEvent } from '@/types/events';

/**
 * Single-event renderer.
 * Each `kind` has its own visual affordance so the operator can parse
 * agent thought vs. shell output vs. tool scaffolding at a glance.
 */
export function LogLine({ e }: { e: StreamEvent }) {
  const time = new Date(e.ts).toISOString().slice(11, 19);

  const toneClass = (() => {
    if (e.kind === 'error') return 'text-status-err';
    if (e.stream === 'stderr') return 'text-status-err/80';
    if (e.kind === 'thought') return 'text-fg-primary';
    if (e.kind === 'status') return 'text-teal';
    if (e.kind === 'tool_call') return 'text-status-info';
    if (e.kind === 'tool_result') return 'text-fg-secondary';
    if (e.kind === 'url') return 'text-teal';
    if (e.kind === 'diff') return 'text-status-warn';
    return 'text-fg-secondary';
  })();

  const label = (() => {
    switch (e.kind) {
      case 'status': return 'STATUS';
      case 'thought': return 'AGENT';
      case 'tool_call': return 'TOOL';
      case 'tool_result': return 'RESULT';
      case 'log': return e.stream === 'stderr' ? 'ERR' : 'OUT';
      case 'diff': return 'EDIT';
      case 'url': return 'URL';
      case 'error': return 'FAIL';
      case 'done': return 'DONE';
      default: return (e.kind as string).toUpperCase();
    }
  })();

  return (
    <div className="flex gap-3 py-0.5 font-mono text-xs leading-relaxed hover:bg-bg-elevated/40 px-3">
      <span className="text-fg-muted shrink-0 select-none">{time}</span>
      <span className="text-fg-muted shrink-0 w-14 select-none">[{label}]</span>
      <span className={`${toneClass} whitespace-pre-wrap break-words min-w-0`}>
        {e.message}
      </span>
    </div>
  );
}
