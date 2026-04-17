'use client';

import { useCallback, useState } from 'react';
import type { AgentRequest } from '@/types/events';
import { InstructionPanel } from './components/InstructionPanel';
import { PhaseStepper } from './components/PhaseStepper';
import { Transcript } from './components/Transcript';
import { PreviewPane } from './components/PreviewPane';
import { useAgentStream } from './hooks/useAgentStream';

type MobileTab = 'build' | 'logs' | 'preview';

export default function Page() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('build');

  const stream = useAgentStream(sessionId);
  const running = Boolean(sessionId && !stream.done && !stream.failed);

  const startBuild = useCallback(async (req: AgentRequest) => {
    setSubmitting(true);
    setSubmitError(null);
    setMobileTab('logs'); // Switch to logs when build starts
    try {
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
      setMobileTab('build');
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

  const tabConfig: { key: MobileTab; label: string; badge?: number }[] = [
    { key: 'build', label: 'Build' },
    { key: 'logs', label: 'Logs', badge: stream.events.length || undefined },
    { key: 'preview', label: 'Preview' },
  ];

  return (
    <main className="h-dvh flex flex-col bg-bg-base">
      {/* --- Header --- */}
      <header className="border-b border-bg-border bg-bg-panel shrink-0">
        <div className="px-4 lg:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 lg:gap-3 min-w-0">
            <div className="w-8 h-8 lg:w-7 lg:h-7 rounded-lg lg:rounded bg-teal-glow border border-teal/40 flex items-center justify-center shrink-0">
              <span className="text-teal font-display font-bold text-base lg:text-sm">G</span>
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-base lg:text-base font-bold tracking-tight leading-none truncate">
                GEM Agent
              </h1>
              <p className="text-2xs font-mono text-fg-muted mt-0.5 hidden md:block">
                Build, test, deploy with AI
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="chip border-bg-border text-fg-secondary">
              <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-teal pulse-dot' : stream.failed ? 'bg-status-err' : stream.done ? 'bg-teal' : 'bg-fg-muted'}`} />
              <span className="text-[10px] lg:text-2xs">
                {running ? 'RUNNING' : stream.failed ? 'FAILED' : stream.done ? 'READY' : 'IDLE'}
              </span>
            </span>
            <button 
              onClick={deployNow} 
              className="btn-primary text-xs py-1.5 px-3" 
              disabled={!stream.done}
            >
              Deploy
            </button>
          </div>
        </div>
        
        {/* Phase stepper - hidden on mobile, visible on tablet+ */}
        <div className="hidden md:block px-4 lg:px-6 pb-3">
          <PhaseStepper current={stream.phase} failed={stream.failed} />
        </div>
      </header>

      {/* --- Mobile Tab Bar --- */}
      <nav className="md:hidden border-b border-bg-border bg-bg-panel shrink-0">
        <div className="flex">
          {tabConfig.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setMobileTab(tab.key)}
              className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                mobileTab === tab.key
                  ? 'text-teal'
                  : 'text-fg-secondary hover:text-fg-primary'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                {tab.label}
                {tab.badge ? (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-teal/20 text-teal text-[10px] font-mono">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                ) : null}
              </span>
              {mobileTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal" />
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* --- Body --- */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Desktop: 3-column grid */}
        <div className="hidden md:grid md:grid-cols-12 gap-3 p-3 h-full">
          {/* Left: instruction */}
          <aside className="col-span-3 min-w-0 flex flex-col gap-3 overflow-y-auto">
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
          <section className="col-span-5 min-w-0">
            <Transcript events={stream.events} />
          </section>

          {/* Right: preview */}
          <section className="col-span-4 min-w-0">
            <PreviewPane
              previewUrl={stream.previewUrl}
              sandboxId={stream.sandboxId}
              deployJobId={stream.deployJobId}
              changelog={stream.changelog}
            />
          </section>
        </div>

        {/* Mobile: tabbed view */}
        <div className="md:hidden h-full">
          {mobileTab === 'build' && (
            <div className="h-full overflow-y-auto p-3 space-y-3">
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
              {/* Mobile phase stepper */}
              <div className="panel p-3">
                <div className="label mb-2">Build Progress</div>
                <PhaseStepper current={stream.phase} failed={stream.failed} />
              </div>
              <div className="panel p-3">
                <div className="label">Session</div>
                <div className="font-mono text-2xs text-fg-secondary break-all">
                  {sessionId ?? '—'}
                </div>
              </div>
            </div>
          )}

          {mobileTab === 'logs' && (
            <div className="h-full">
              <Transcript events={stream.events} />
            </div>
          )}

          {mobileTab === 'preview' && (
            <div className="h-full">
              <PreviewPane
                previewUrl={stream.previewUrl}
                sandboxId={stream.sandboxId}
                deployJobId={stream.deployJobId}
                changelog={stream.changelog}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
