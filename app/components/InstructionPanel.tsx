'use client';

import { useState } from 'react';
import type { AgentRequest } from '@/types/events';

interface Props {
  onSubmit: (req: AgentRequest) => void;
  running: boolean;
}

export function InstructionPanel({ onSubmit, running }: Props) {
  const [instruction, setInstruction] = useState('');
  const [mode, setMode] = useState<'template' | 'repo'>('template');
  const [template, setTemplate] = useState<NonNullable<AgentRequest['template']>>('next14-ts');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [autoFix, setAutoFix] = useState(true);
  const [maxIterations, setMaxIterations] = useState(12);

  const canSubmit = !running && instruction.trim().length >= 4 &&
    (mode === 'template' || (owner.trim() && repo.trim()));

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      instruction: instruction.trim(),
      repo: mode === 'repo' ? { owner: owner.trim(), name: repo.trim(), branch: branch.trim() || 'main' } : null,
      template: mode === 'template' ? template : undefined,
      autoDeploy,
      autoFix,
      maxIterations,
    });
  }

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base lg:text-lg font-semibold tracking-tight">Build Instruction</h2>
        <span className="chip border-teal text-teal bg-teal-glow text-[10px] lg:text-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-teal" />
          <span className="hidden sm:inline">GEM AGENT ·</span> v0.1
        </span>
      </div>

      <div>
        <label className="label" htmlFor="instr">Instruction</label>
        <textarea
          id="instr"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. Build a Next.js 14 landing page with TypeScript, Tailwind, dark theme..."
          rows={4}
          className="input resize-y font-mono text-sm lg:text-xs leading-relaxed min-h-[100px]"
          disabled={running}
        />
      </div>

      <div className="grid grid-cols-2 gap-1 p-1 bg-bg-elevated border border-bg-border rounded-lg">
        {(['template', 'repo'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={running}
            className={`text-xs lg:text-2xs font-mono uppercase tracking-wider px-3 py-2.5 lg:py-1.5 rounded-md lg:rounded-sm transition-colors ${
              mode === m
                ? 'bg-bg-panel text-teal border border-teal/40'
                : 'text-fg-secondary hover:text-fg-primary border border-transparent'
            }`}
          >
            {m === 'template' ? 'Template' : 'Repository'}
          </button>
        ))}
      </div>

      {mode === 'template' ? (
        <div>
          <label className="label" htmlFor="tpl">Template</label>
          <select
            id="tpl"
            value={template}
            onChange={(e) => setTemplate(e.target.value as NonNullable<AgentRequest['template']>)}
            className="input font-mono text-sm lg:text-xs py-3 lg:py-2"
            disabled={running}
          >
            <option value="next14-ts">Next.js 14 + TypeScript</option>
            <option value="vite-react-ts">Vite + React + TypeScript</option>
            <option value="node-api">Node API (blank)</option>
            <option value="blank">Blank workspace</option>
          </select>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="owner">Owner</label>
              <input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)}
                     className="input font-mono text-sm lg:text-xs py-3 lg:py-2" placeholder="gem" disabled={running} />
            </div>
            <div>
              <label className="label" htmlFor="repo">Repo</label>
              <input id="repo" value={repo} onChange={(e) => setRepo(e.target.value)}
                     className="input font-mono text-sm lg:text-xs py-3 lg:py-2" placeholder="nexus-financial" disabled={running} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="branch">Branch</label>
            <input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)}
                   className="input font-mono text-sm lg:text-xs py-3 lg:py-2" placeholder="main" disabled={running} />
          </div>
        </div>
      )}

      <div className="space-y-3 lg:space-y-0 lg:flex lg:items-center lg:gap-4 pt-1">
        <label className="flex items-center gap-3 lg:gap-2 text-sm lg:text-xs text-fg-secondary cursor-pointer select-none py-1">
          <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)}
                 className="accent-teal w-5 h-5 lg:w-4 lg:h-4" disabled={running} />
          Auto-fix on test failure
        </label>
        <label className="flex items-center gap-3 lg:gap-2 text-sm lg:text-xs text-fg-secondary cursor-pointer select-none py-1">
          <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)}
                 className="accent-teal w-5 h-5 lg:w-4 lg:h-4" disabled={running} />
          Deploy on green
        </label>
        <div className="flex items-center gap-2 lg:ml-auto pt-2 lg:pt-0">
          <label className="text-xs lg:text-2xs font-mono uppercase tracking-wider text-fg-secondary">
            Max iters
          </label>
          <input
            type="number"
            min={1} max={25}
            value={maxIterations}
            onChange={(e) => setMaxIterations(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
            className="input w-20 lg:w-16 font-mono text-sm lg:text-xs py-2 lg:py-1"
            disabled={running}
          />
        </div>
      </div>

      <button onClick={submit} disabled={!canSubmit} className="btn-primary w-full py-3.5 lg:py-2 text-base lg:text-sm">
        {running ? (
          <>
            <span className="w-2 h-2 rounded-full bg-bg-base pulse-dot" />
            Building...
          </>
        ) : (
          <>Execute Build</>
        )}
      </button>
    </div>
  );
}
