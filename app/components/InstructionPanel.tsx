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
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight">Build Instruction</h2>
        <span className="chip border-teal text-teal bg-teal-glow">
          <span className="w-1.5 h-1.5 rounded-full bg-teal" />
          GEM AGENT · v0.1
        </span>
      </div>

      <div>
        <label className="label" htmlFor="instr">Instruction</label>
        <textarea
          id="instr"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={`e.g. Build a Next.js 14 landing page for Nexus Financial with a Bitcoin live-price hero, TypeScript strict, Tailwind, dark theme. Add a /api/price route fetching from CoinGecko. Ensure \`npm run build\` and \`npm run lint\` pass.`}
          rows={5}
          className="input resize-y font-mono text-xs leading-relaxed"
          disabled={running}
        />
      </div>

      <div className="grid grid-cols-2 gap-1 p-1 bg-bg-elevated border border-bg-border rounded">
        {(['template', 'repo'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={running}
            className={`text-2xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-sm transition-colors ${
              mode === m
                ? 'bg-bg-panel text-teal border border-teal/40'
                : 'text-fg-secondary hover:text-fg-primary border border-transparent'
            }`}
          >
            {m === 'template' ? 'From Template' : 'From Repo'}
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
            className="input font-mono text-xs"
            disabled={running}
          >
            <option value="next14-ts">Next.js 14 · TypeScript</option>
            <option value="vite-react-ts">Vite + React · TypeScript</option>
            <option value="node-api">Node API (blank)</option>
            <option value="blank">Blank workspace</option>
          </select>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-1">
            <label className="label" htmlFor="owner">Owner</label>
            <input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)}
                   className="input font-mono text-xs" placeholder="gem" disabled={running} />
          </div>
          <div className="col-span-1">
            <label className="label" htmlFor="repo">Repo</label>
            <input id="repo" value={repo} onChange={(e) => setRepo(e.target.value)}
                   className="input font-mono text-xs" placeholder="nexus-financial" disabled={running} />
          </div>
          <div className="col-span-1">
            <label className="label" htmlFor="branch">Branch</label>
            <input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)}
                   className="input font-mono text-xs" placeholder="main" disabled={running} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 pt-1">
        <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer select-none">
          <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)}
                 className="accent-teal" disabled={running} />
          Auto-fix on test failure
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer select-none">
          <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)}
                 className="accent-teal" disabled={running} />
          Deploy on green
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-2xs font-mono uppercase tracking-wider text-fg-secondary">
            Max iters
          </label>
          <input
            type="number"
            min={1} max={25}
            value={maxIterations}
            onChange={(e) => setMaxIterations(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
            className="input w-16 font-mono text-xs py-1"
            disabled={running}
          />
        </div>
      </div>

      <button onClick={submit} disabled={!canSubmit} className="btn-primary w-full">
        {running ? (
          <>
            <span className="w-2 h-2 rounded-full bg-bg-base pulse-dot" />
            Building…
          </>
        ) : (
          <>▸ Execute Build</>
        )}
      </button>
    </div>
  );
}
