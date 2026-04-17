'use client';

import { useCallback, useState } from 'react';
import type { AgentRequest } from '@/types/events';
import { InstructionPanel } from './components/InstructionPanel';
import { PhaseStepper } from './components/PhaseStepper';
import { Transcript } from './components/Transcript';
import { PreviewPane } from './components/PreviewPane';
import { useAgentStream } from './hooks/useAgentStream';

export default function Page() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const stream = useAgentStream(sessionId);
  const running = Boolean(sessionId && !stream.done && !stream.failed);

  const startBuild = useCallback(async (req: AgentRequest) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // If the deployment injects a token (e.g. via server-rendered layout),
      // we attach it; otherwise the request goes out unauthenticated and the
      // server either accepts (auth disabled) or rejects with 401.
      const token =
        typeof window !== 'undefined'
          ? (window as { __GEM_AGENT_TOKEN__?: string }).__GEM_AGENT_TOKEN__
          : undefined;
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${res.status}: ${t}`);
      }
      const json = (await res.json()) as { sessionId: string };
      setSessionId(json.sessionId);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, []);

  const deployNow = useCallback(async () => {
    try {
      const token =
        typeof window !== 'undefined'
          ? (window as { __GEM_AGENT_TOKEN__?: string }).__GEM_AGENT_TOKEN__
          : undefined;
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      alert(`Deploy failed: ${(err as Error).message}`);
    }
  }, []);

  return (
    <main className="min-h-screen flex flex-col">
      {/* --- Header --- */}
      <header className="border-b border-bg-border bg-bg-panel shrink-0">
        <div className="px-4 lg:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 lg:gap-3 min-w-0">
            <div className="w-7 h-7 rounded bg-teal-glow border border-teal/40 flex items-center justify-center shrink-0">
              <span className="text-teal font-display font-bold text-sm">G</span>
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-sm lg:text-base font-bold tracking-tight leading-none truncate">
                GEM Agent Builder
              </h1>
              <p className="text-2xs font-mono text-fg-muted mt-0.5 hidden sm:block">
                Instruction → sandbox → test → deploy
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="chip border-bg-border text-fg-secondary">
              <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-teal pulse-dot' : stream.failed ? 'bg-status-err' : stream.done ? 'bg-teal' : 'bg-fg-muted'}`} />
              <span className="hidden sm:inline">{running ? 'RUNNING' : stream.failed ? 'FAILED' : stream.done ? 'READY' : 'IDLE'}</span>
            </span>
            <button onClick={deployNow} className="btn-ghost text-xs lg:text-sm" disabled={!stream.done}>
              <span className="hidden sm:inline">▸ Deploy Now</span>
              <span className="sm:hidden">▸ Deploy</span>
            </button>
          </div>
        </div>
        <div className="px-4 lg:px-6 pb-3 overflow-x-auto">
          <PhaseStepper current={stream.phase} failed={stream.failed} />
        </div>
      </header>

      {/* --- Body: responsive dashboard (stacked on mobile, 3-col on desktop) --- */}
      <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-3 p-3 min-h-0 overflow-auto">
        {/* Left: instruction */}
        <aside className="lg:col-span-3 min-w-0 flex flex-col gap-3 shrink-0">
          <InstructionPanel onSubmit={startBuild} running={running || submitting} />
          {submitError && (
            <div className="panel p-3 border-status-err/60">
              <div className="text-2xs font-mono uppercase tracking-wider text-status-err mb-1">
                Submit failed
              </div>
              <div className="font-mono text-xs text-fg-secondary break-words">
                {submitError}
              </div>
            </div>
          )}
          <div className="panel p-3">
            <div className="label">Session</div>
            <div className="font-mono text-2xs text-fg-secondary break-all">
              {sessionId ?? '—'}
            </div>
          </div>
        </aside>

        {/* Middle: transcript */}
        <section className="lg:col-span-5 min-w-0 flex-1 lg:flex-none min-h-[300px] lg:min-h-0">
          <Transcript events={stream.events} />
        </section>

        {/* Right: preview */}
        <section className="lg:col-span-4 min-w-0 flex-1 lg:flex-none min-h-[300px] lg:min-h-0">
          <PreviewPane
            previewUrl={stream.previewUrl}
            sandboxId={stream.sandboxId}
            deployJobId={stream.deployJobId}
            changelog={stream.changelog}
          />
        </section>
      </div>
    </main>
  );
}
