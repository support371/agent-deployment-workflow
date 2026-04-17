'use client';

import type { AgentPhase } from '@/types/events';

const PHASES: { key: AgentPhase; label: string }[] = [
  { key: 'planning', label: 'Plan' },
  { key: 'sandbox_provisioning', label: 'Boot' },
  { key: 'installing', label: 'Install' },
  { key: 'scaffolding', label: 'Scaffold' },
  { key: 'building', label: 'Build' },
  { key: 'testing', label: 'Test' },
  { key: 'pr_opening', label: 'PR' },
  { key: 'deploying', label: 'Deploy' },
  { key: 'done', label: 'Ready' },
];

export function PhaseStepper({
  current,
  failed,
}: {
  current: AgentPhase | null;
  failed: boolean;
}) {
  const idx = current ? PHASES.findIndex((p) => p.key === current) : -1;

  return (
    <div className="panel px-3 py-2.5 md:py-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        {PHASES.map((p, i) => {
          const state: 'past' | 'active' | 'future' =
            i < idx ? 'past' : i === idx ? 'active' : 'future';
          const isFailed = failed && i === idx;

          return (
            <div key={p.key} className="flex items-center gap-1 shrink-0">
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isFailed
                    ? 'bg-status-err'
                    : state === 'past'
                      ? 'bg-teal'
                      : state === 'active'
                        ? 'bg-teal pulse-dot'
                        : 'bg-bg-border'
                }`}
              />
              <span
                className={`text-[10px] md:text-2xs font-mono uppercase tracking-wider ${
                  isFailed
                    ? 'text-status-err'
                    : state === 'past'
                      ? 'text-fg-secondary'
                      : state === 'active'
                        ? 'text-teal'
                        : 'text-fg-muted'
                }`}
              >
                {p.label}
              </span>
              {i < PHASES.length - 1 && (
                <div
                  className={`w-3 md:w-4 h-px shrink-0 ${
                    state === 'past' ? 'bg-teal/40' : 'bg-bg-border'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
